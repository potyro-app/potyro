// SQLite, in a worker, on real OPFS — the only place the browser allows it.
//
// ## Why this file exists
//
// `installOpfsSAHPoolVfs` needs `FileSystemFileHandle.createSyncAccessHandle`, and that method is
// **worker-only by specification**. It is absent on the main thread in every engine — Chrome and
// Firefox alike, headed and headless (measured). So the main-thread OPFS path could never succeed
// for anybody, and every device silently fell back to `idb-sqlite.ts`, which re-exports the WHOLE
// database and rewrites it into IndexedDB after every write.
//
// That fallback is O(everything the device has ever stored) per write. One database holds every
// synced app, its whole CRDT history and its photos, so ticking a checkbox in a five-line shopping
// list paid for the photo library of an unrelated app. Measured at phone-like CPU: 8ms per write at
// 0.2MB stored, 120ms at 11MB, and climbing in a straight line from there.
//
// In a worker the SAH-pool VFS installs and a write costs the write. That is the whole point.
//
// ## Shape
//
// One database per worker, named at construction. The protocol is a request id, an op, and a reply
// — deliberately small, because everything that crosses it is also everything that can go wrong
// across it. Messages are answered in the order they arrive, which is what lets the client wrap
// BEGIN/COMMIT around calls it makes in between (see `sqlite-worker-client.ts`).

/// <reference lib="webworker" />

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { ELSEWHERE, isStorageElsewhere, ownStorage, StorageElsewhereError, type LockManagerLike } from "./storage-owner.js";
import { isStorageStuck, looksStuck, putBack, setAside, STUCK, StorageStuckError, type RescueDir, type RescueStash } from "./storage-rescue.js";

interface Sqlite3Db {
  exec(sqlOrOpts: string | { sql: string; bind?: unknown[] }): unknown;
  selectObjects(sql: string, bind?: unknown[]): Record<string, unknown>[];
  selectValue(sql: string, bind?: unknown[]): unknown;
  close(): void;
  readonly pointer?: number;
}

export type WorkerRequest =
  | { id: number; op: "open"; db: string; takeover?: boolean }
  | { id: number; op: "run"; db: string; sql: string; params?: unknown[] }
  | { id: number; op: "query"; db: string; sql: string; params?: unknown[] }
  | { id: number; op: "get"; db: string; sql: string; params?: unknown[] }
  | { id: number; op: "close"; db: string }
  /** Close the database if it is open, and remove its file. Nothing to remove is not an error. */
  | { id: number; op: "delete"; db: string };

export type WorkerReply =
  | { id: number; ok: true; rows?: Record<string, unknown>[] }
  | { id: number; ok: false; error: string; code?: typeof ELSEWHERE | typeof STUCK };

/** Said without being asked: another tab took the storage, and this worker has let go of it. */
export type WorkerEvent = { event: "lost" };

/**
 * ONE pool, many databases.
 *
 * The SAH pool preallocates a set of sync access handles over its directory, and each app asking
 * for a pool of its own is how a device with a handful of apps ran out of them — an open that
 * cannot take a handle does not fail, it waits, so the app simply stopped part-way through saving.
 * A pool holds as many database FILES as you like, so every app's database lives in this one.
 */
interface Pool {
  OpfsSAHPoolDb: new (f: string) => Sqlite3Db;
  getFileNames(): string[];
  /** Remove a file from the pool. Answers whether there was one. */
  unlink(filename: string): boolean;
  /** Let go of every access handle, keeping the files. Throws while a database is open. */
  pauseVfs(): unknown;
  /** How many files the pool may hold, and how many it does. */
  getCapacity(): number;
  getFileCount(): number;
  /** More room: `n` files more, each a sync access handle opened now. */
  addCapacity(n: number): Promise<number>;
  /** Less room: up to `n` unused files removed, with their handles. Answers how many went. */
  reduceCapacity(n: number): Promise<number>;
}

/**
 * How many files the pool starts with, and how much room it keeps free.
 *
 * It used to start with 32, and every one of them is a sync access handle the pool opens on every
 * page load, before any app can open: a few milliseconds in Chrome, 50–70 ms each in Firefox —
 * two to three seconds of every start there, for files nobody used. A device opens a handful of
 * databases at once (the device's own, the launcher's history, the Studio's chats, the app) and
 * each may need one more file for its rollback journal while a transaction is open, so the pool
 * starts small, keeps room for those, and grows before an open that would otherwise fail. A pool
 * that is bigger than that from an earlier build is trimmed back once, after it opened.
 */
const POOL_START = 8;
/** Files kept free beyond what is in use, when trimming. */
const POOL_ROOM = 4;
let pool: Pool | null = null;
let installing: Promise<void> | null = null;

/**
 * The pool as builds before the rename (#248) installed it. The rename moved it from `/karta` to
 * `/potyro` and brought nothing across, so on every browser that had used the app each local app's
 * database, and the device's sync database, were still in `/karta` while the app opened new, empty
 * ones in `/potyro`.
 *
 * Installed only where that directory already exists, and used only for the files it holds: a
 * database the old pool has is opened THERE, in place, and everything else goes to the current
 * pool. Nothing is copied and nothing is removed, so the choice is the same on every start. Where
 * both pools hold the same name, the copy in `/potyro` was made after the rename by an app that
 * opened empty — it stays on disk untouched, and the data from before the rename is what opens.
 */
const LEGACY_POOL = { name: "karta", directory: "/karta" } as const;
let legacyPool: Pool | null = null;

/** Where a pool keeps its files: sqlite-wasm's `OPAQUE_DIR_NAME`, under the pool's directory. */
const OPAQUE = ".opaque";
const CURRENT_POOL = { name: "potyro", directory: "/potyro" } as const;

/** A pool's file directory, or null when the pool has never been installed here. Creates nothing. */
async function opaqueDir(directory: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await (self.navigator as Navigator).storage.getDirectory();
    const pool = await root.getDirectoryHandle(directory.slice(1)); // no `create`: throws when absent
    return await pool.getDirectoryHandle(OPAQUE);
  } catch {
    return null;
  }
}

type SyncHandleFile = FileSystemFileHandle & { createSyncAccessHandle(): Promise<{ close(): void }> };
type Entries = { entries(): AsyncIterable<[string, FileSystemHandle]> };

async function filesOf(dir: FileSystemDirectoryHandle): Promise<SyncHandleFile[]> {
  const files: SyncHandleFile[] = [];
  for await (const [, h] of (dir as unknown as Entries).entries()) if (h.kind === "file") files.push(h as SyncHandleFile);
  return files;
}

/**
 * True when every file of every pool this worker will install can be opened for sync access now.
 *
 * Each is opened and closed again at once. This is the question the pool install asks, minus what
 * it does when the answer is no: log an error per file, then try to delete the directory.
 */
async function poolFilesFree(): Promise<boolean> {
  const files: SyncHandleFile[] = [];
  for (const directory of [CURRENT_POOL.directory, LEGACY_POOL.directory]) {
    const dir = await opaqueDir(directory);
    if (dir) files.push(...(await filesOf(dir)));
  }
  // All at once, not one after the other: in Firefox, opening a sync access handle is a round trip
  // to the browser's parent process of some 50–70 ms, and closing one as much again — one file after
  // another, a pool of 32 was most of the three seconds every page load spent before any app
  // opened there. Asked together, the round trips overlap (the pool itself acquires its handles
  // this way, `acquireAccessHandles`).
  const answers = await Promise.allSettled(files.map(async (file) => (await file.createSyncAccessHandle()).close()));
  for (const a of answers) {
    if (a.status === "fulfilled") continue;
    if ((a.reason as { name?: string })?.name === "NoModificationAllowedError") return false;
    throw a.reason;
  }
  return true;
}

// ---- storage the browser will not open (storage-rescue.ts) -------------------------------------

/** The browser refused its own storage. Set once; only a restart of the browser changes it. */
let stuck = false;

type WritableSyncHandle = { truncate(size: number): void; write(data: Uint8Array, opts: { at: number }): number; flush(): void; close(): void };

/** A pool's file directory as the rescue uses it. Created when putting back into a directory that is gone. */
async function rescueDir(directory: string): Promise<RescueDir> {
  const root = await (self.navigator as Navigator).storage.getDirectory();
  const dir = await (await root.getDirectoryHandle(directory.slice(1), { create: true })).getDirectoryHandle(OPAQUE, { create: true });
  return {
    names: async () => (await filesOf(dir)).map((f) => f.name),
    read: async (name) => (await (await dir.getFileHandle(name)).getFile()).arrayBuffer(),
    async write(name, bytes) {
      const file = (await dir.getFileHandle(name, { create: true })) as unknown as { createSyncAccessHandle(): Promise<WritableSyncHandle> };
      const handle = await file.createSyncAccessHandle();
      try {
        handle.truncate(0);
        const written = handle.write(new Uint8Array(bytes), { at: 0 });
        handle.flush();
        if (written !== bytes.byteLength) throw new Error(`"${name}": ${written} of ${bytes.byteLength} bytes written`);
      } finally {
        handle.close();
      }
    },
    remove: (name) => dir.removeEntry(name),
  };
}

/** Where pool files wait for the browser to be restarted. IndexedDB: a different store, which still works. */
const RESCUE_DB = "potyro-storage-rescue";
const RESCUE_FILES = "files";

function rescueStash(): RescueStash {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const asked = self.indexedDB.open(RESCUE_DB, 1);
      asked.onupgradeneeded = () => asked.result.createObjectStore(RESCUE_FILES);
      asked.onsuccess = () => resolve(asked.result);
      asked.onerror = () => reject(asked.error);
    });
  const within = async <T>(mode: IDBTransactionMode, work: (files: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(RESCUE_FILES, mode);
        const asked = work(tx.objectStore(RESCUE_FILES));
        tx.oncomplete = () => resolve(asked.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    put: async (key, bytes) => void (await within("readwrite", (files) => files.put(bytes, key))),
    get: (key) => within<ArrayBuffer | undefined>("readonly", (files) => files.get(key)),
    keys: async () => (await within("readonly", (files) => files.getAllKeys())).map(String),
    clear: async () => void (await within("readwrite", (files) => files.clear())),
  };
}

/**
 * A note, in OPFS itself, that files were set aside. An empty file beside the pool: making one and
 * finding one both work while the browser refuses to open anything for writing.
 *
 * The stash is in IndexedDB, and "could not read the stash" must not be taken for "nothing is in
 * it": a pool installed empty then would be new, empty apps beside the real ones, and putting the
 * real ones back later would write over whatever had been made since.
 */
const SET_ASIDE_NOTE = "potyro-set-aside";

async function noteSetAside(on: boolean): Promise<void> {
  const root = await (self.navigator as Navigator).storage.getDirectory();
  if (on) await root.getFileHandle(SET_ASIDE_NOTE, { create: true });
  else await root.removeEntry(SET_ASIDE_NOTE).catch(() => undefined);
}

async function setAsideNoted(): Promise<boolean> {
  try {
    const root = await (self.navigator as Navigator).storage.getDirectory();
    await root.getFileHandle(SET_ASIDE_NOTE);
    return true;
  } catch {
    return false;
  }
}

/**
 * `poolFilesFree`, for a browser that may refuse its storage altogether.
 *
 * First whatever an earlier start set aside is put back: if the browser still will not write, the
 * files stay in the stash and this says so, rather than a pool opening empty beside them. Then the
 * files are tried. A refusal that is the browser's and not another tab's is asked once more a moment
 * later, and if it stands the files are set aside for the next start of the browser.
 */
async function poolFilesReady(): Promise<boolean> {
  let waiting: string[];
  try {
    waiting = await rescueStash().keys();
  } catch (err) {
    // A stash that cannot be read. Where files were set aside they are in it, and nothing opens
    // until it reads again. Where none were (a browser with no IndexedDB here), there is nothing to
    // put back, and the open goes on to fail or fall back as it always did.
    if (await setAsideNoted()) {
      console.warn("[potyro] storage: what was set aside cannot be read yet", err);
      throw new StorageStuckError();
    }
    waiting = [];
  }
  if (waiting.length > 0) {
    try {
      await putBack(rescueDir, rescueStash());
    } catch (err) {
      // Held by a tab of an older build, which takes no lock: that tab's to let go of, not stuck.
      if ((err as { name?: string })?.name === "NoModificationAllowedError") return false;
      // Anything else leaves the stash as it was. Said as stuck whatever the cause, because every
      // other answer lets a caller open different storage, empty, beside the records waiting here.
      console.warn("[potyro] storage: what was set aside cannot be put back yet", err);
      throw new StorageStuckError();
    }
  }
  await noteSetAside(false).catch(() => undefined);
  try {
    return await poolFilesFree();
  } catch (err) {
    if (!looksStuck(err)) throw err;
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  try {
    return await poolFilesFree();
  } catch (err) {
    if (!looksStuck(err)) throw err;
    console.warn("[potyro] storage: the browser will not open its files; setting them aside until it is restarted", err);
  }
  try {
    const dirs: Record<string, RescueDir> = {};
    for (const { directory } of [CURRENT_POOL, LEGACY_POOL]) if (await opaqueDir(directory)) dirs[directory] = await rescueDir(directory);
    await noteSetAside(true); // before anything is removed
    await setAside(dirs, rescueStash());
  } catch (err) {
    // Nothing was removed (storage-rescue.ts): the files are where they were, and still unopenable.
    console.warn("[potyro] storage: the files could not be set aside", err);
  }
  throw new StorageStuckError();
}

const dbs = new Map<string, Sqlite3Db>();

interface Capi {
  sqlite3_get_autocommit(db: number): number;
}

/** The module's own types do not describe its config argument; `sqlite-backend.ts` narrows it the
 *  same way, for the same reason. */
type InitFn = (config: { print?(): void; printErr?(): void }) => Promise<{
  installOpfsSAHPoolVfs?(opts: {
    name?: string;
    directory?: string;
    initialCapacity?: number;
  }): Promise<Pool>;
  capi: Capi;
}>;
let capi: Capi | null = null;

// ---- one owner per origin (storage-owner.ts) ---------------------------------------------------

/** Another tab took the storage. Set once; this worker never owns it again. */
let lost = false;
/** This worker's claim on the storage, once asked for. */
let owning: Promise<unknown> | null = null;
/** Every database closed and every handle let go, after `lost`. */
let letGo = false;

/**
 * Close everything and hand the files on, once no transaction is open.
 *
 * Called when the lock is stolen and after every message from then on: a write made a moment
 * before the other tab took over finishes, rather than being cut off between its BEGIN and its
 * COMMIT. A transaction that never finishes is not waited on forever (`onLost`).
 */
function letGoWhenIdle(force = false): void {
  if (!lost || letGo) return;
  const inTransaction = (db: Sqlite3Db) => db.pointer !== undefined && capi?.sqlite3_get_autocommit(db.pointer) === 0;
  if (!force && [...dbs.values()].some(inTransaction)) return;
  for (const db of dbs.values()) {
    try {
      db.close(); // an open transaction rolls back: what was committed is what is kept
    } catch {
      /* a database that will not close is not a reason to keep the files */
    }
  }
  dbs.clear();
  for (const p of [pool, legacyPool]) {
    try {
      p?.pauseVfs(); // lets go of the handles and keeps the files
    } catch {
      /* this worker is of no use to anyone now; the tab's end lets go of the rest */
    }
  }
  letGo = true;
  self.postMessage({ event: "lost" } satisfies WorkerEvent);
}

function onLost(): void {
  lost = true;
  letGoWhenIdle();
  setTimeout(() => letGoWhenIdle(true), 2000);
}

async function open(name: string, takeover: boolean): Promise<void> {
  await install(takeover);
  if (!pool) throw new Error("the storage pool did not install");
  if (dbs.has(name)) return;
  const file = `/${name}.sqlite3`;
  const home = legacyPool?.getFileNames().includes(file) ? legacyPool : pool;
  await makeRoom(home);
  const db = new home.OpfsSAHPoolDb(file);
  dbs.set(name, db);
  // One sync of the journal and one of the database per commit, not three. Firefox's `flush` is a
  // real fsync of some 10 ms; at FULL a one-row commit there was four of them. NORMAL still keeps
  // the database whole through a crash of the tab or the browser; what it gives up is the last
  // commit on a power cut at the wrong instant, which on a phone's own data is the trade to make.
  db.exec("PRAGMA synchronous=NORMAL");
}

/** The pools, installed once however many databases are asked for — and before a removal. */
async function install(takeover: boolean): Promise<void> {
  // Installed once, however many databases are asked for. `installing` is awaited rather than
  // re-entered: two apps opening at the same moment must not install two pools over one directory.
  installing ??= (async () => {
    // The storage's one owner first, the pool after: installing a pool over files another tab holds
    // is what logged an error per file, and what tries to delete them (storage-owner.ts). Owned once
    // per worker: a pool install that fails for some other reason (no OPFS at all) is retried
    // without asking for the lock again — this worker already has it, and would wait on itself.
    owning ??= ownStorage({
      locks: (self.navigator as Navigator & { locks?: LockManagerLike }).locks,
      takeover,
      waitMs: 2000,
      filesFree: poolFilesReady,
      filesWithinMs: takeover ? 5000 : 1500,
      onLost,
    }).catch((err: unknown) => {
      owning = null;
      // Remembered: every database of this load is asked for, and each would set aside again.
      if (isStorageStuck(err)) stuck = true;
      throw err;
    });
    await owning;
    const init = sqlite3InitModule as unknown as InitFn;
    const sqlite3 = await init({ print: () => {}, printErr: () => {} });
    capi = sqlite3.capi;
    if (!sqlite3.installOpfsSAHPoolVfs) throw new Error("this worker has no OPFS SAH-pool VFS");
    // Room for the device database, every app's, and the shell's own — with space to grow. The pool
    // preallocates this many handles; running out is the failure this file exists to avoid.
    pool = await sqlite3.installOpfsSAHPoolVfs({ ...CURRENT_POOL, initialCapacity: POOL_START });
    await trim(pool);
    // Only when it holds files: an empty `/karta` has nothing to open, and installing a pool there
    // would create 32 files in it for nobody. A failure here fails the open, as the current pool's
    // does: opening `/potyro` instead would show an app empty, and then hide whatever was written
    // there once `/karta` opened again.
    const legacy = await opaqueDir(LEGACY_POOL.directory);
    if (legacy && (await filesOf(legacy)).length > 0) {
      legacyPool = await sqlite3.installOpfsSAHPoolVfs({ ...LEGACY_POOL, initialCapacity: POOL_START });
      await trim(legacyPool);
    }
  })().catch((err: unknown) => {
    installing = null; // a failed install must be retryable, not remembered
    throw err;
  });
  await installing;
}

/**
 * Room in `pool` for the next database file and a journal for every open database, this one
 * included. Grown here, before an open, because the pool cannot grow from inside SQLite's own open
 * (`xOpen` is synchronous and simply fails "pool is full"), and a journal is opened mid-transaction
 * without any warning.
 */
async function makeRoom(p: Pool): Promise<void> {
  const need = dbs.size + 2;
  const free = p.getCapacity() - p.getFileCount();
  if (free < need) await p.addCapacity(need - free);
}

/** A pool left larger than it needs by an earlier build (32 files for a handful of databases): back to its size. */
async function trim(p: Pool): Promise<void> {
  const spare = p.getCapacity() - Math.max(POOL_START, p.getFileCount() + POOL_ROOM);
  if (spare > 0) await p.reduceCapacity(spare);
}

/**
 * An app deleted on this device takes its database with it.
 *
 * Deleting an app used to remove it from the launcher and leave its file in the pool: the next app
 * saved under the same name — or the same app added again — opened on the dead one's records, which
 * is the opposite of what the question ("This deletes the app AND its data") had promised. The file
 * goes from whichever pool holds it, after closing it if this worker has it open; a file that is
 * not there is not an error, because the app may never have been opened on this device.
 */
async function remove(name: string): Promise<void> {
  await install(false);
  const db = dbs.get(name);
  if (db) {
    db.close();
    dbs.delete(name);
  }
  const file = `/${name}.sqlite3`;
  for (const p of [pool, legacyPool]) if (p?.getFileNames().includes(file)) p.unlink(file);
}

function handle(msg: WorkerRequest): Record<string, unknown>[] | undefined {
  const db = dbs.get(msg.db);
  if (!db) throw new Error(`the database "${msg.db}" is not open`);
  switch (msg.op) {
    case "run":
      db.exec({ sql: msg.sql, bind: msg.params ?? [] });
      return undefined;
    case "query":
      return db.selectObjects(msg.sql, msg.params ?? []);
    case "get":
      return db.selectObjects(msg.sql, msg.params ?? []).slice(0, 1);
    case "close":
      db.close();
      dbs.delete(msg.db);
      return undefined;
    default:
      throw new Error(`unknown op`);
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  const reply = (r: WorkerReply): void => self.postMessage(r);
  try {
    // Once the files are another tab's, nothing here can be answered — and nothing should fall back
    // to other storage either, which is why this says so with a code rather than a plain error.
    if (letGo) {
      reply({ id: msg.id, ok: false, error: new StorageElsewhereError().message, code: ELSEWHERE });
      return;
    }
    if (stuck) {
      reply({ id: msg.id, ok: false, error: new StorageStuckError().message, code: STUCK });
      return;
    }
    if (msg.op === "open") {
      await open(msg.db, msg.takeover === true);
      reply({ id: msg.id, ok: true });
      return;
    }
    if (msg.op === "delete") {
      await remove(msg.db);
      reply({ id: msg.id, ok: true });
      return;
    }
    reply({ id: msg.id, ok: true, rows: handle(msg) });
  } catch (err) {
    // The client turns this back into a rejection. A worker that threw silently would leave the
    // caller waiting for a reply that is never coming.
    reply({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ...(isStorageElsewhere(err) ? { code: ELSEWHERE } : isStorageStuck(err) ? { code: STUCK } : {}),
    });
  } finally {
    letGoWhenIdle();
  }
};
