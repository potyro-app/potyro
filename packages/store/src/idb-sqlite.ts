// A SQLite handle that persists to IndexedDB — so sync works in every browser, not just the ones
// with OPFS.
//
// ## Why
//
// CORRECTION worth keeping: an earlier version of this code claimed "Firefox and Safari can't do
// OPFS". That was wrong. Firefox supports OPFS fine. The real constraint is that
// `createSyncAccessHandle` is a **worker-only** API — which is why a main-thread capability check
// reported "unsupported" in Firefox AND in Chrome, i.e. almost everywhere.
//
// The proper primary path is therefore to run sqlite-wasm + OPFS inside a Web Worker (which is what
// Jazz itself does). This module is the universal FALLBACK for contexts where that is unavailable
// or not yet wired — it needs no worker plumbing and works in every browser with IndexedDB.
//
// ## How
//
// SQLite runs in memory and the whole database is snapshotted into IndexedDB. That is viable here
// only because of a property `docs/01` states outright: Potyro is personal-scale, thousands of
// records rather than millions. A snapshot of that is small and quick; this approach would be
// hopeless for a large database.
//
// ## Durability
//
// Snapshotting must not lag behind writes, or we recreate the "add a record, refresh instantly,
// gone" bug that cost real work earlier. Every commit schedules a snapshot, and `whenPersisted()`
// resolves only once the bytes are actually in IndexedDB — `createJazzStore` awaits it alongside
// cojson's own flush signal, so a write still means what it says.

import { initSqlite } from "./sqlite-backend.js";
import type { SqliteDbHandle } from "./sqlite-store.js";

// The name predates the rename to Potyro and stays: it is the database on every device that ever
// ran the IndexedDB fallback, and a new name would orphan it.
const DB_NAME = "karta-jazz-idb";
const STORE = "databases";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as Uint8Array | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface IdbSqliteHandle {
  db: SqliteDbHandle;
  /** Resolves once every write so far is in IndexedDB. */
  whenPersisted: () => Promise<void>;
  close: () => void;
}

/** True when this browser can back a Jazz store. IndexedDB is available essentially everywhere. */
export function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/**
 * Open `name` as an in-memory SQLite database hydrated from (and snapshotted back to) IndexedDB.
 *
 * The returned handle satisfies `SqliteDbHandle`, so cojson's driver cannot tell the difference.
 */
export async function openIdbSqliteDb(name: string): Promise<IdbSqliteHandle> {
  const sqlite3 = await initSqlite();
  const store = await idb();
  const key = `db:${name}`;

  const raw = new sqlite3.oo1.DB(":memory:", "c") as unknown as SqliteDbHandle & { pointer: number };

  const existing = await idbGet(store, key);
  if (existing?.length) {
    const { capi, wasm } = sqlite3;
    const ptr = wasm.allocFromTypedArray(existing);
    const flags = capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE;
    const rc = capi.sqlite3_deserialize(raw.pointer, "main", ptr, existing.length, existing.length, flags);
    if (rc !== 0) throw new Error(`openIdbSqliteDb: could not restore "${name}" (rc=${rc})`);
  }

  let pending: Promise<void> = Promise.resolve();
  let dirty = false;
  let scheduled = false;

  const snapshot = async (): Promise<void> => {
    scheduled = false;
    if (!dirty) return;
    dirty = false;
    const bytes = sqlite3.capi.sqlite3_js_db_export(raw.pointer) as Uint8Array;
    await idbPut(store, key, bytes);
  };

  /** Coalesce bursts of writes into one snapshot, but never let one be dropped. */
  const schedule = (): void => {
    dirty = true;
    if (scheduled) return;
    scheduled = true;
    pending = pending.then(() => new Promise<void>((r) => setTimeout(r, 0))).then(snapshot);
  };

  const db: SqliteDbHandle = {
    exec(sqlOrOpts) {
      const result = raw.exec(sqlOrOpts);
      const sql = typeof sqlOrOpts === "string" ? sqlOrOpts : sqlOrOpts.sql;
      // Reads vastly outnumber writes; snapshotting on a SELECT would export the whole database
      // on every query.
      if (!/^\s*(select|pragma\s+\w+\s*$)/i.test(sql)) schedule();
      return result;
    },
    selectValue: (sql, bind) => raw.selectValue(sql, bind),
    selectObjects: (sql, bind) => raw.selectObjects(sql, bind),
    close: () => raw.close?.(),
  };

  return {
    db,
    async whenPersisted() {
      // Await the queue, then re-check: a write landing during the await schedules another.
      await pending;
      if (dirty) {
        schedule();
        await pending;
      }
    },
    close: () => raw.close?.(),
  };
}
