// Engine wiring for SqliteStore. Initialises `@sqlite.org/sqlite-wasm` and opens the right database
// for the environment, then hands a `SqliteDbHandle` to the storage-agnostic SqliteStore:
//   • createSqliteStore()        → browser, OPFS-backed (durable, offline). Used by the shell.
//   • createMemorySqliteStore()  → in-memory, with byte export/import to simulate a reload in tests.
// Keeping all module-init and VFS specifics here means SqliteStore itself never imports the engine.

import type { SqliteDbHandle } from "./sqlite-store.js";
import { SqliteStore } from "./sqlite-store.js";

// Narrowed views of the parts of the sqlite3 module we touch. The real module satisfies these
// structurally; declaring them keeps this file free of `any` at its boundaries.
interface Sqlite3Db extends SqliteDbHandle {
  pointer: number;
  close(): void;
}
interface Sqlite3Module {
  version: { libVersion: string };
  oo1: { DB: new (filename?: string, flags?: string) => Sqlite3Db };
  capi: {
    sqlite3_js_db_export(pointer: number): Uint8Array;
    sqlite3_deserialize(pointer: number, schema: string, data: number, size: number, capacity: number, flags: number): number;
    SQLITE_DESERIALIZE_FREEONCLOSE: number;
    SQLITE_DESERIALIZE_RESIZEABLE: number;
  };
  wasm: { allocFromTypedArray(bytes: Uint8Array): number };
  installOpfsSAHPoolVfs?(opts: { name?: string; directory?: string }): Promise<{
    OpfsSAHPoolDb: new (filename: string) => Sqlite3Db;
    importDb?(path: string, bytes: Uint8Array): void;
  }>;
}

let modulePromise: Promise<Sqlite3Module> | null = null;

// The shipped types declare no config parameter; the runtime accepts an Emscripten config, so we
// narrow the init function to the shape we use (silence stdout/stderr).
type InitFn = (config?: { print?: () => void; printErr?: () => void }) => Promise<Sqlite3Module>;

/**
 * Initialise the wasm engine once per process/page (idempotent). The engine is imported
 * dynamically so its ~230kB of glue + wasm loads only when a durable store is actually opened,
 * keeping it out of the main bundle (web-performance: dynamically import heavy libraries).
 */
export async function initSqlite(): Promise<Sqlite3Module> {
  if (!modulePromise) {
    modulePromise = import("@sqlite.org/sqlite-wasm")
      .then((m) => {
        const init = m.default as unknown as InitFn;
        return init({ print: () => {}, printErr: () => {} });
      })
      .catch((err) => {
        modulePromise = null; // allow a retry after a transient init failure (e.g. missing wasm in CI)
        throw err;
      });
  }
  return modulePromise;
}

export interface SqliteStoreFactoryResult {
  store: SqliteStore;
  /** Snapshot the whole database as bytes (for backup/export, or a test "reload"). */
  export(): Uint8Array;
  /** Release the underlying database handle. */
  destroy(): void;
}

/**
 * Browser factory: opens an OPFS-backed database via the SAH-pool VFS (main-thread capable, no
 * COOP/COEP headers required) so data survives reloads and works fully offline. `appId` namespaces
 * the physical file so different apps never share storage.
 */
/**
 * Open a raw OPFS-backed SQLite handle.
 *
 * Exists so cojson can be given a database of its OWN (`createJazzStore`). Its schema
 * (coValues/sessions/transactions/…) is entirely its business, and sharing a file with Karta's
 * `records`/`blobs`/`meta` tables would couple two migration timelines that never need to meet.
 * The `name`/`directory` are namespaced by caller, so the files never collide.
 */
export async function openOpfsDb(name: string, opts?: { directory?: string }): Promise<SqliteDbHandle> {
  const sqlite3 = await initSqlite();
  if (!sqlite3.installOpfsSAHPoolVfs) {
    throw new Error("openOpfsDb: OPFS SAH-pool VFS unavailable in this environment");
  }
  const pool = await sqlite3.installOpfsSAHPoolVfs({
    name: `karta-${name}`,
    directory: opts?.directory ?? `/karta/${name}`,
  });
  return new pool.OpfsSAHPoolDb(`/${name}.sqlite3`) as unknown as SqliteDbHandle;
}

export async function createSqliteStore(appId: string, opts?: { directory?: string }): Promise<SqliteStore> {
  const sqlite3 = await initSqlite();
  if (!sqlite3.installOpfsSAHPoolVfs) {
    throw new Error("createSqliteStore: OPFS SAH-pool VFS unavailable in this environment (use createMemorySqliteStore for tests)");
  }
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: `karta-${appId}`, directory: opts?.directory ?? `/karta/${appId}` });
  const db = new pool.OpfsSAHPoolDb(`/${appId}.sqlite3`);
  const store = new SqliteStore(db, () => sqlite3.capi.sqlite3_js_db_export(db.pointer));
  await store.open(appId);
  return store;
}

/**
 * Import a `.sqlite` database (from an export bundle, KA-04) as `appId`'s durable store, replacing
 * whatever was there. On the browser it writes the bytes into the OPFS SAH-pool file so the imported
 * data survives reloads; where OPFS is unavailable it falls back to an in-memory store seeded from
 * the bytes. Call this on a fresh page (before `createSqliteStore` for the same app) so the pool VFS
 * is installed once.
 */
export async function importSqliteStore(appId: string, bytes: Uint8Array, opts?: { directory?: string }): Promise<SqliteStore> {
  const sqlite3 = await initSqlite();
  if (!sqlite3.installOpfsSAHPoolVfs) {
    const { store } = await createMemorySqliteStore(appId, { bytes }); // non-durable fallback
    return store;
  }
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: `karta-${appId}`, directory: opts?.directory ?? `/karta/${appId}` });
  const filename = `/${appId}.sqlite3`;
  if (typeof pool.importDb === "function") pool.importDb(filename, bytes);
  const db = new pool.OpfsSAHPoolDb(filename);
  const store = new SqliteStore(db, () => sqlite3.capi.sqlite3_js_db_export(db.pointer));
  await store.open(appId);
  return store;
}

/**
 * In-memory factory (tests, Node). Optionally seeds from previously exported bytes to simulate an
 * OPFS "reopen", which is how the persistence suite proves durability headlessly.
 */
export async function createMemorySqliteStore(appId: string, opts?: { bytes?: Uint8Array }): Promise<SqliteStoreFactoryResult> {
  const sqlite3 = await initSqlite();
  const db = new sqlite3.oo1.DB(":memory:", "c");

  if (opts?.bytes) {
    const { capi, wasm } = sqlite3;
    const ptr = wasm.allocFromTypedArray(opts.bytes);
    const flags = capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE;
    const rc = capi.sqlite3_deserialize(db.pointer, "main", ptr, opts.bytes.length, opts.bytes.length, flags);
    if (rc !== 0) throw new Error(`createMemorySqliteStore: sqlite3_deserialize failed (rc=${rc})`);
  }

  const exporter = () => sqlite3.capi.sqlite3_js_db_export(db.pointer);
  const store = new SqliteStore(db, exporter);
  await store.open(appId);

  return {
    store,
    export: exporter,
    destroy: () => void store.close(), // idempotent; closes the underlying db handle once
  };
}
