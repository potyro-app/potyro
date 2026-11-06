// The main-thread half of worker-hosted SQLite: cojson's async driver, over postMessage.
//
// cojson's storage interface is async already (`SQLiteDatabaseDriverAsync` — every method returns a
// promise), which is what makes this possible at all: nothing on this side needs a synchronous
// answer from the database, so the database can live where OPFS actually works. See
// `sqlite-worker.ts` for why that is a worker and nowhere else.
//
// Ordering is the load-bearing property. Every call goes down one channel and the worker answers
// them in the order they arrive, so `BEGIN`, the caller's statements, and `COMMIT` reach SQLite in
// that order without the client having to hold a lock across the callback.

import type { SqliteDriverAsync } from "./jazz-sqlite-driver.js";
import type { SqliteDbHandle } from "./sqlite-store.js";
import { ELSEWHERE, StorageElsewhereError } from "./storage-owner.js";

export { isStorageElsewhere, StorageElsewhereError } from "./storage-owner.js";

// ---- one tab owns the storage (storage-owner.ts) ------------------------------------------------

/** Set once this tab learns another one owns the storage. Never unset: the way back is a reload. */
let elsewhere = false;
const elsewhereListeners = new Set<() => void>();

function markElsewhere(): void {
  if (elsewhere) return;
  elsewhere = true;
  for (const l of [...elsewhereListeners]) l();
}

/**
 * Be told when another tab has the storage — at boot, or later when another tab takes it over.
 * Called at once if that is already so. Returns the way to stop listening.
 */
export function onStorageElsewhere(listener: () => void): () => void {
  elsewhereListeners.add(listener);
  if (elsewhere) listener();
  return () => elsewhereListeners.delete(listener);
}

/** Said in this tab's session storage, read by the next page load's first open. */
const TAKEOVER_KEY = "potyro:storage:takeover";

/**
 * "Use it here": the next load of this tab takes the storage from whichever tab has it. The caller
 * reloads; a page that has been told it lost its storage has nothing in memory worth keeping.
 */
export function takeOverStorageOnNextLoad(): void {
  try {
    globalThis.sessionStorage?.setItem(TAKEOVER_KEY, "1");
  } catch {
    /* without session storage the reload simply waits its turn like any other open */
  }
}

/** Whether this load was asked to take the storage over. Read once: a later reload asks again. */
function takeoverAsked(): boolean {
  try {
    const asked = globalThis.sessionStorage?.getItem(TAKEOVER_KEY) === "1";
    if (asked) globalThis.sessionStorage.removeItem(TAKEOVER_KEY);
    return asked;
  } catch {
    return false;
  }
}

export interface WorkerSqlite {
  driver: SqliteDriverAsync;
  /** Stop the worker. The driver is unusable afterwards. */
  terminate(): void;
}

/** How a worker is made. Injected so tests can drive the protocol without a real one. */
export interface WorkerFactory {
  (): {
    postMessage(message: unknown): void;
    terminate(): void;
    onmessage: ((event: { data: unknown }) => void) | null;
    onerror?: ((event: unknown) => void) | null;
  };
}

/** True when this environment can host a module worker at all (a browser; not Node, not vitest). */
export function workersAvailable(): boolean {
  return typeof Worker === "function";
}

/**
 * Spawn the SQLite worker and adapt it to cojson's driver.
 *
 * Rejects if the worker cannot open the database — OPFS missing, storage denied, another tab
 * holding the SAH pool. The caller is expected to fall back rather than fail the app: losing sync
 * is worse than losing the fast path.
 */
export function openWorkerSqlite(name: string, factory?: WorkerFactory): Promise<WorkerSqlite> {
  // Not an error to fall back from: opening anything else would be a second copy of the same apps.
  if (elsewhere && !factory) return Promise.reject(new StorageElsewhereError());
  // ONE worker for everything, holding one pool and a database per name.
  //
  // The SAH pool takes exclusive sync access handles over its directory, so a second worker over
  // the same storage does not merely duplicate work — it never finishes opening. That is true both
  // of two callers wanting the same database (an app's store and the account node the launcher
  // reads both want `karta-jazz`) and of one pool per app, which is how a device with a handful of
  // apps ran out of handles and simply stopped part-way through a save.
  const entry = openings.get(name) ?? { open: spawn(name, factory), holders: 0 };
  openings.set(name, entry);
  entry.holders++;
  // A failed open must not be remembered, or one bad boot poisons every later attempt.
  return entry.open.then(
    (connection) => heldBy(name, entry, connection),
    (err: unknown) => {
      if (openings.get(name) === entry) openings.delete(name);
      throw err;
    },
  );
}

/**
 * One caller's handle on a shared connection.
 *
 * The worker's `close` shuts a database for EVERYONE using it, and the connection used to be handed
 * out as-is — so the first caller to close took the database away from the rest (an app and the
 * Data panel both holding `user-groceries`), and the closed connection stayed cached: the next open
 * of that name got it, failed with "is not open", and the app fell back to `localStorage`, showing
 * none of its real records. Each caller now releases its own hold, once; the database closes, and
 * leaves the cache, when the last one lets go.
 */
function heldBy(name: string, entry: Opening, connection: WorkerSqlite): WorkerSqlite {
  let released = false;
  const closeDb = async (): Promise<void> => {
    if (released) return;
    released = true;
    if (--entry.holders > 0) return;
    if (openings.get(name) === entry) openings.delete(name);
    await connection.driver.closeDb();
  };
  return { ...connection, driver: { ...connection.driver, closeDb } };
}

interface Opening {
  open: Promise<WorkerSqlite>;
  /** Callers that opened this database and have not closed it. */
  holders: number;
}

const openings = new Map<string, Opening>();

/** The one worker, and the calls waiting on it. Shared by every database. */
let shared: { worker: ReturnType<WorkerFactory>; send: Sender } | null = null;

type Sender = (message: Record<string, unknown>) => Promise<Record<string, unknown>[] | undefined>;

function connect(factory?: WorkerFactory): { worker: ReturnType<WorkerFactory>; send: Sender } {
  if (shared && !factory) return shared;
  const worker = factory
    ? factory()
    : (new Worker(new URL("./sqlite-worker.ts", import.meta.url), { type: "module" }) as unknown as ReturnType<WorkerFactory>);

  let nextId = 1;
  const waiting = new Map<number, { resolve: (rows?: Record<string, unknown>[]) => void; reject: (e: Error) => void }>();

  worker.onmessage = (event: { data: unknown }) => {
    if ((event.data as { event?: unknown }).event === "lost") {
      // Another tab took the storage over. Whatever is still waiting will not be answered here.
      markElsewhere();
      const dead = [...waiting.values()];
      waiting.clear();
      for (const p of dead) p.reject(new StorageElsewhereError());
      return;
    }
    const reply = event.data as { id: number; ok: boolean; rows?: Record<string, unknown>[]; error?: string; code?: string };
    const pending = waiting.get(reply.id);
    if (!pending) return;
    waiting.delete(reply.id);
    if (reply.ok) return pending.resolve(reply.rows);
    if (reply.code === ELSEWHERE) {
      markElsewhere();
      return pending.reject(new StorageElsewhereError());
    }
    pending.reject(new Error(reply.error ?? "the storage worker failed"));
  };
  if ("onerror" in worker) {
    worker.onerror = (event: unknown) => {
      const why = (event as { message?: string })?.message;
      // A worker that dies takes every outstanding call with it. Failing them is the only honest
      // thing to do: cojson can retry, where waiting forever would hang the app with no error.
      const dead = [...waiting.values()];
      waiting.clear();
      for (const p of dead) p.reject(new Error(why ? `the storage worker stopped: ${why}` : "the storage worker stopped"));
    };
  }

  const send: Sender = (message) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      worker.postMessage({ ...message, id });
    });
  };

  const connection = { worker, send };
  if (!factory) shared = connection;
  return connection;
}

async function spawn(name: string, factory?: WorkerFactory): Promise<WorkerSqlite> {
  const { worker, send: post } = connect(factory);
  const send: Sender = (message) => post({ ...message, db: name });

  // The first open of this load carries "Use it here", if that is why the page was reloaded.
  await send({ op: "open", ...(!factory && takeoverAsked() ? { takeover: true } : {}) });

  // One transaction at a time, across everyone using this database. Per database, not per worker:
  // two apps writing at once are two SQLite connections and have nothing to serialise between them.
  //
  // cojson serialises its own transactions (`SQLiteClientAsync.enqueueTx`), so a single node never
  // overlaps them — but TWO nodes share this worker: an app's store and the account node the
  // launcher reads, both on `karta-jazz`. Left to interleave, the second node's BEGIN lands inside
  // the first's transaction, its writes commit under the first's COMMIT, and a rollback on either
  // side discards the other's work. That is a lost record, and it showed up as rows that simply
  // never appeared.
  //
  // Joining instead of queueing (what the main-thread driver did, safely, because it never yielded
  // mid-transaction) is not enough here for the same reason. Nothing re-enters this method — cojson
  // passes its own transaction object down to the callback — so a queue cannot deadlock on itself.
  let queue: Promise<unknown> = Promise.resolve();
  const serialise = <T>(work: () => Promise<T>): Promise<T> => {
    const mine = queue.then(work, work);
    // The chain has to survive a failed transaction, or one bad write blocks every later one.
    queue = mine.then(
      () => undefined,
      () => undefined,
    );
    return mine;
  };

  const driver: SqliteDriverAsync = {
    async initialize() {
      // WAL is what the main-thread driver asks for, and the SAH-pool VFS does not offer it (one
      // file, no shared-memory segment). Asking is harmless and keeps the two paths one line apart;
      // refusing is not an error worth failing a boot over.
      await send({ op: "run", sql: "PRAGMA journal_mode=WAL" }).catch(() => undefined);
    },

    async run(sql, params) {
      await send({ op: "run", sql, params });
    },

    async query<T>(sql: string, params: unknown[]): Promise<T[]> {
      return ((await send({ op: "query", sql, params })) ?? []) as T[];
    },

    async get<T>(sql: string, params: unknown[]): Promise<T | undefined> {
      return (((await send({ op: "get", sql, params })) ?? [])[0] as T | undefined) ?? undefined;
    },

    async transaction(callback) {
      return serialise(async () => {
        await send({ op: "run", sql: "BEGIN" });
        try {
          const result = await callback(driver);
          await send({ op: "run", sql: "COMMIT" });
          return result;
        } catch (err) {
          // Rolling back must not mask what actually went wrong — that is how a storage bug hides
          // behind a misleading error.
          await send({ op: "run", sql: "ROLLBACK" }).catch(() => undefined);
          throw err;
        }
      });
    },

    async closeDb() {
      await send({ op: "close" }).catch(() => undefined);
    },

    async getMigrationVersion() {
      const rows = (await send({ op: "query", sql: "PRAGMA user_version", params: [] })) ?? [];
      const value = Object.values(rows[0] ?? {})[0];
      return typeof value === "number" ? value : 0;
    },

    async saveMigrationVersion(version: number) {
      // PRAGMA takes no bound parameters, so the number is interpolated — parsed to an integer
      // first so this cannot become an injection point.
      await send({ op: "run", sql: `PRAGMA user_version = ${Number.parseInt(String(version), 10) || 0}` });
    },
  };

  return { driver, terminate: () => worker.terminate() };
}

/**
 * The same worker database, in the shape `SqliteStore` takes.
 *
 * cojson has its own driver interface; `SqliteStore` has `exec`/`selectValue`/`selectObjects`. Both
 * end up at the same three worker operations, so this is an adapter and nothing more — it exists so
 * an ordinary local-only app can have real OPFS storage too, instead of the `localStorage` fallback
 * it got when the main-thread OPFS open failed (five megabytes, and a photo would not fit).
 *
 * The name is used as a file name in OPFS, and app namespaces contain characters ("user:groceries")
 * that have no business in one.
 */
export const workerDbName = (name: string): string => name.replace(/[^A-Za-z0-9._-]+/g, "-");

/**
 * Remove a database's file from this device, closing it first if it is open here.
 *
 * What deleting an app promises ("the app AND its data"): the file goes, so the same name opened
 * again starts empty. Whoever still holds the connection in this tab is holding a closed one, which
 * is right — the app is gone. A name that was never opened on this device has nothing to remove and
 * is not an error. Refused, like an open, while another tab has the storage: that tab's copy of the
 * app would go on writing into a file this one had just removed.
 */
export async function deleteWorkerSqlite(name: string, factory?: WorkerFactory): Promise<void> {
  if (elsewhere && !factory) throw new StorageElsewhereError();
  const db = workerDbName(name);
  openings.delete(db);
  const { send } = connect(factory);
  await send({ op: "delete", db });
}
export async function openWorkerSqliteHandle(name: string): Promise<SqliteDbHandle> {
  const { driver } = await openWorkerSqlite(workerDbName(name));
  return {
    exec: (sqlOrOpts) =>
      typeof sqlOrOpts === "string"
        ? driver.run(sqlOrOpts, [])
        : driver.run(sqlOrOpts.sql, [...(sqlOrOpts.bind ?? [])]),
    selectValue: async (sql, bind) => {
      const rows = await driver.query<Record<string, unknown>>(sql, [...(bind ?? [])]);
      // `selectValue` is the first column of the first row — SQLite's own definition of it.
      return rows[0] ? Object.values(rows[0])[0] : undefined;
    },
    selectObjects: (sql, bind) => driver.query<Record<string, unknown>>(sql, [...(bind ?? [])]),
    close: () => driver.closeDb().then(() => undefined),
  };
}
