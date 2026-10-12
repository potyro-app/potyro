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

interface Sqlite3Db {
  exec(sqlOrOpts: string | { sql: string; bind?: unknown[] }): unknown;
  selectObjects(sql: string, bind?: unknown[]): Record<string, unknown>[];
  selectValue(sql: string, bind?: unknown[]): unknown;
  close(): void;
}

export type WorkerRequest =
  | { id: number; op: "open"; db: string }
  | { id: number; op: "run"; db: string; sql: string; params?: unknown[] }
  | { id: number; op: "query"; db: string; sql: string; params?: unknown[] }
  | { id: number; op: "get"; db: string; sql: string; params?: unknown[] }
  | { id: number; op: "close"; db: string };

export type WorkerReply = { id: number; ok: true; rows?: Record<string, unknown>[] } | { id: number; ok: false; error: string };

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
}
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

async function legacyPoolExists(): Promise<boolean> {
  try {
    const root = await (self.navigator as Navigator).storage.getDirectory();
    await root.getDirectoryHandle(LEGACY_POOL.directory.slice(1)); // no `create`: throws when absent
    return true;
  } catch {
    return false;
  }
}
const dbs = new Map<string, Sqlite3Db>();

/** The module's own types do not describe its config argument; `sqlite-backend.ts` narrows it the
 *  same way, for the same reason. */
type InitFn = (config: { print?(): void; printErr?(): void }) => Promise<{
  installOpfsSAHPoolVfs?(opts: {
    name?: string;
    directory?: string;
    initialCapacity?: number;
  }): Promise<Pool>;
}>;

async function open(name: string): Promise<void> {
  // Installed once, however many databases are asked for. `installing` is awaited rather than
  // re-entered: two apps opening at the same moment must not install two pools over one directory.
  installing ??= (async () => {
    const init = sqlite3InitModule as unknown as InitFn;
    const sqlite3 = await init({ print: () => {}, printErr: () => {} });
    if (!sqlite3.installOpfsSAHPoolVfs) throw new Error("this worker has no OPFS SAH-pool VFS");
    // Room for the device database, every app's, and the shell's own — with space to grow. The pool
    // preallocates this many handles; running out is the failure this file exists to avoid.
    pool = await sqlite3.installOpfsSAHPoolVfs({ name: "potyro", directory: "/potyro", initialCapacity: 32 });
    // A failure here fails the open, as the current pool's does: opening `/potyro` instead would show
    // an app empty, and then hide whatever was written there once `/karta` opened again.
    if (await legacyPoolExists()) legacyPool = await sqlite3.installOpfsSAHPoolVfs({ ...LEGACY_POOL, initialCapacity: 32 });
  })().catch((err: unknown) => {
    installing = null; // a failed install must be retryable, not remembered
    throw err;
  });
  await installing;
  if (!pool) throw new Error("the storage pool did not install");
  if (dbs.has(name)) return;
  const file = `/${name}.sqlite3`;
  const home = legacyPool?.getFileNames().includes(file) ? legacyPool : pool;
  dbs.set(name, new home.OpfsSAHPoolDb(file));
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
    if (msg.op === "open") {
      await open(msg.db);
      reply({ id: msg.id, ok: true });
      return;
    }
    reply({ id: msg.id, ok: true, rows: handle(msg) });
  } catch (err) {
    // The client turns this back into a rejection. A worker that threw silently would leave the
    // caller waiting for a reply that is never coming.
    reply({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
