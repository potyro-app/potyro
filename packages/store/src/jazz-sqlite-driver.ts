// Durable storage for JazzStore, on the SQLite engine Karta already ships.
//
// cojson persists CoValues through a small driver interface (`SQLiteDatabaseDriverAsync`, 7
// methods). Karta already carries `@sqlite.org/sqlite-wasm` for `SqliteStore` (KA-01) and opens it
// over OPFS. Bridging the two means Jazz-backed apps get durability with **no second WASM engine**
// — which matters: the bundle already lazily loads QuickJS for the isolate and SQLite for the
// store, and a third would be hard to justify for a feature that is opt-in per app.
//
// cojson gets its OWN database file, not Karta's. Its schema (coValues/sessions/transactions/…) is
// entirely its business, and sharing a file with Karta's `records`/`blobs`/`meta` tables would
// couple two migration timelines that have no reason to meet.
//
// The driver is sync underneath (sqlite-wasm's oo1 API is synchronous once the module is loaded);
// the async signatures are just what cojson asks for.

import type { SqliteDbHandle } from "./sqlite-store.js";

/** The shape cojson's `getSqliteStorageAsync` expects. Declared here so this module does not
 *  depend on cojson's type exports — the same structural approach `jazz-store.ts` takes. */
export interface SqliteDriverAsync {
  initialize(): Promise<void>;
  run(sql: string, params: unknown[]): Promise<void>;
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
  get<T>(sql: string, params: unknown[]): Promise<T | undefined>;
  transaction(callback: (tx: SqliteDriverAsync) => unknown): Promise<unknown>;
  closeDb(): Promise<unknown>;
  getMigrationVersion?(): Promise<number>;
  saveMigrationVersion?(version: number): Promise<void>;
}

/**
 * Adapt a Karta `SqliteDbHandle` to cojson's async driver.
 *
 * Schema versioning uses `PRAGMA user_version`, which is per-database — safe precisely because
 * cojson owns this file outright.
 */
export function createJazzSqliteDriver(db: SqliteDbHandle): SqliteDriverAsync {
  let depth = 0; // cojson may nest transactions; only the outermost may BEGIN/COMMIT.

  const driver: SqliteDriverAsync = {
    async initialize() {
      // The handle is already open — the factory installs the VFS and opens the file. Enable WAL
      // so a reader never blocks the sync writer.
      db.exec("PRAGMA journal_mode=WAL");
    },

    async run(sql, params) {
      db.exec({ sql, bind: params });
    },

    async query<T>(sql: string, params: unknown[]): Promise<T[]> {
      return db.selectObjects(sql, params) as T[];
    },

    async get<T>(sql: string, params: unknown[]): Promise<T | undefined> {
      return db.selectObjects(sql, params)[0] as T | undefined;
    },

    async transaction(callback) {
      if (depth++ > 0) {
        // Already inside one. SQLite has no real nested transactions here, and issuing a second
        // BEGIN would throw; joining the outer one keeps the caller's semantics.
        try {
          return await callback(driver);
        } finally {
          depth--;
        }
      }
      db.exec("BEGIN");
      try {
        const result = await callback(driver);
        db.exec("COMMIT");
        return result;
      } catch (err) {
        // Rollback must not mask the original failure — that is how a storage bug becomes
        // invisible behind a misleading error.
        try {
          db.exec("ROLLBACK");
        } catch {
          /* the transaction was already aborted by SQLite */
        }
        throw err;
      } finally {
        depth--;
      }
    },

    async closeDb() {
      db.close?.();
    },

    async getMigrationVersion() {
      const v = db.selectValue("PRAGMA user_version");
      return typeof v === "number" ? v : 0;
    },

    async saveMigrationVersion(version: number) {
      // PRAGMA does not accept bound parameters, so the value is interpolated — coerced to an
      // integer first so this cannot become an injection point.
      db.exec(`PRAGMA user_version = ${Number.parseInt(String(version), 10) || 0}`);
    },
  };

  return driver;
}
