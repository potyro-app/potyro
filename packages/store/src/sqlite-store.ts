// SqliteStore — the durable Store for the PWA (KA-01 / docs/08 WP3). One SQLite database per app,
// each record stored as a JSON `doc` (SQLite JSON1), plus tables for blobs, kv, and meta. It
// implements the exact same `Store` interface as MemoryStore/LocalStore, so swapping it in touches
// only the composition root.
//
// The SQLite engine (`@sqlite.org/sqlite-wasm`) is injected as a `SqliteDbHandle`, so the store is
// storage-agnostic: the browser opens an OPFS-backed database (durable, offline); tests open an
// in-memory database and simulate a "reload" by export/deserialize. QuickJS isolation is unaffected
// — the store lives host-side, never inside the app sandbox.

import type { Id, PotyroRecord, MediaRef, Value } from "potyro";
import type { MigrationPlan, Narrow, Store, Unsubscribe } from "./types.js";
import { applyMigrationStep, type EntityRecords } from "./migrate.js";
import { ulid } from "./ulid.js";

/**
 * The minimal SQLite surface SqliteStore needs. `@sqlite.org/sqlite-wasm`'s `oo1.DB` satisfies this
 * structurally; declaring it here keeps the store free of `any` and testable with a fake.
 *
 * Every call MAY return a promise, and the store awaits all of them. That is not ceremony: the only
 * place a browser will open OPFS is a Web Worker (see `sqlite-worker.ts`), and a database on the
 * other side of a worker answers asynchronously. A synchronous handle — in-memory, or the engine
 * loaded directly — still satisfies this, because awaiting a plain value costs a microtask and
 * nothing else.
 */
export interface SqliteDbHandle {
  exec(sqlOrOpts: string | { sql: string; bind?: readonly unknown[] }): unknown;
  selectValue(sql: string, bind?: readonly unknown[]): unknown | Promise<unknown>;
  selectObjects(
    sql: string,
    bind?: readonly unknown[],
  ): Array<Record<string, unknown>> | Promise<Array<Record<string, unknown>>>;
  /** Release the database (OPFS file handle / memory). Optional so fakes may omit it. */
  close?(): void | Promise<void>;
}

/** Ids bound per `IN (…)`: under SQLite's lowest default cap on parameters (999), with room for the rest. */
const IDS_PER_STATEMENT = 500;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS records(
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     entity TEXT NOT NULL,
     id TEXT NOT NULL,
     doc TEXT NOT NULL,
     UNIQUE(entity, id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_records_entity ON records(entity, seq)`,
  `CREATE TABLE IF NOT EXISTS blobs(key TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
];

function nowIso(): string {
  return new Date().toISOString();
}

export class SqliteStore implements Store {
  private appId: string | null = null;
  private closed = false;
  private readonly listeners = new Map<string, Set<() => void>>();
  private txCounter = 0;
  // Change notifications raised inside a transaction are buffered here and only fired when the
  // outermost SAVEPOINT commits — so a rolled-back transaction never leaks phantom notifications.
  private txDepth = 0;
  private pendingEmits: string[] = [];

  /**
   * `db` must be an already-opened SQLite database handle (in-memory or OPFS-backed). `exporter`,
   * when provided by the factory, serializes the whole database to bytes (a real `.sqlite` file) —
   * used by the data-export bundle (KA-04).
   */
  constructor(private readonly db: SqliteDbHandle, private readonly exporter?: () => Uint8Array) {}

  async open(appId: string): Promise<void> {
    this.appId = appId;
    for (const stmt of SCHEMA) await this.db.exec(stmt);
  }

  /** Serialize the whole database to a standalone `.sqlite` file (opens in any SQLite tool). */
  exportSqlite(): Uint8Array {
    if (!this.exporter) throw new Error("SqliteStore: this store was created without an exporter");
    return this.exporter();
  }

  async close(): Promise<void> {
    if (this.closed) return; // idempotent; double-close of the wasm DB would throw
    this.closed = true;
    this.appId = null;
    await this.db.close?.();
  }

  // ── reads ──────────────────────────────────────────────────────────────────
  async all(entity: string, narrow?: Narrow): Promise<PotyroRecord[]> {
    const out = narrow?.ids
      ? await this.byIds(entity, narrow.ids)
      : (await this.db.selectObjects("SELECT doc FROM records WHERE entity=? ORDER BY seq", [entity])).map((r) => JSON.parse(r.doc as string) as PotyroRecord);
    const offset = narrow?.offset ?? 0;
    const end = narrow?.limit != null ? offset + narrow.limit : undefined;
    return out.slice(offset, end);
  }

  /**
   * The rows with these ids, in creation order — read through the `(entity, id)` key.
   *
   * This is how the runtime resolves a list's relations: one call per related entity. It used to
   * read and parse the whole entity and filter in JS, so a batch of 5 aisles cost as much as the
   * table. In chunks, because SQLite caps the parameters one statement may bind.
   */
  private async byIds(entity: string, ids: readonly Id[]): Promise<PotyroRecord[]> {
    const unique = [...new Set(ids)];
    const found: Array<{ seq: number; doc: string }> = [];
    for (let at = 0; at < unique.length; at += IDS_PER_STATEMENT) {
      const chunk = unique.slice(at, at + IDS_PER_STATEMENT);
      const rows = await this.db.selectObjects(`SELECT seq, doc FROM records WHERE entity=? AND id IN (${chunk.map(() => "?").join(",")})`, [entity, ...chunk]);
      for (const r of rows) found.push({ seq: Number(r.seq), doc: r.doc as string });
    }
    return found.sort((a, b) => a.seq - b.seq).map((r) => JSON.parse(r.doc) as PotyroRecord);
  }

  async get(entity: string, id: Id): Promise<PotyroRecord | null> {
    const doc = await this.db.selectValue("SELECT doc FROM records WHERE entity=? AND id=?", [entity, id]);
    return doc == null ? null : (JSON.parse(doc as string) as PotyroRecord);
  }

  async byIndex(entity: string, field: string, value: Value): Promise<PotyroRecord[]> {
    // Personal-scale: scan + compare in JS (identical semantics to MemoryStore). A JSON1 index is
    // a later optimization; the runtime never relies on this fast-path for correctness.
    const rows = await this.all(entity);
    return rows.filter((r) => r[field] === value);
  }

  // ── writes ─────────────────────────────────────────────────────────────────
  async insert(entity: string, data: Partial<PotyroRecord>): Promise<PotyroRecord> {
    const id = (data.id as Id) ?? ulid();
    const ts = nowIso();
    const record: PotyroRecord = {
      ...structuredClone(data),
      id,
      createdAt: (data.createdAt as string) ?? ts,
      updatedAt: ts,
    };
    await this.db.exec({
      sql: "INSERT INTO records(entity, id, doc) VALUES(?, ?, ?) ON CONFLICT(entity, id) DO UPDATE SET doc=excluded.doc",
      bind: [entity, id, JSON.stringify(record)],
    });
    this.emit(entity);
    return structuredClone(record);
  }

  async update(entity: string, id: Id, patch: Partial<PotyroRecord>): Promise<PotyroRecord> {
    const existing = await this.get(entity, id);
    if (!existing) throw new Error(`update: ${entity}/${id} not found`);
    const next: PotyroRecord = {
      ...existing,
      ...structuredClone(patch),
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowIso(),
    };
    await this.db.exec({ sql: "UPDATE records SET doc=? WHERE entity=? AND id=?", bind: [JSON.stringify(next), entity, id] });
    this.emit(entity);
    return structuredClone(next);
  }

  async delete(entity: string, id: Id): Promise<void> {
    await this.db.exec({ sql: "DELETE FROM records WHERE entity=? AND id=?", bind: [entity, id] });
    if (Number(await this.db.selectValue("SELECT changes()")) > 0) this.emit(entity);
  }

  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    const name = `potyro_tx_${++this.txCounter}`;
    const mark = this.pendingEmits.length; // notifications buffered before this (nested) level
    await this.db.exec(`SAVEPOINT ${name}`);
    this.txDepth++;
    try {
      const out = await fn(this);
      await this.db.exec(`RELEASE ${name}`);
      this.txDepth--;
      if (this.txDepth === 0) this.flushPending();
      return out;
    } catch (err) {
      await this.db.exec(`ROLLBACK TO ${name}`);
      await this.db.exec(`RELEASE ${name}`);
      this.txDepth--;
      this.pendingEmits.length = mark; // discard notifications from the rolled-back level(s)
      throw err;
    }
  }

  // ── reactivity ──────────────────────────────────────────────────────────────
  subscribe(entity: string, cb: () => void): Unsubscribe {
    let set = this.listeners.get(entity);
    if (!set) {
      set = new Set();
      this.listeners.set(entity, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  private emit(entity: string): void {
    if (this.txDepth > 0) {
      this.pendingEmits.push(entity); // defer until the outermost transaction commits
      return;
    }
    this.fire(entity);
  }

  private fire(entity: string): void {
    for (const cb of this.listeners.get(entity) ?? []) cb();
  }

  private flushPending(): void {
    const entities = [...new Set(this.pendingEmits)];
    this.pendingEmits.length = 0;
    for (const entity of entities) this.fire(entity);
  }

  // ── blobs ────────────────────────────────────────────────────────────────────
  async putBlob(b: Blob): Promise<MediaRef> {
    const bytes = new Uint8Array(await b.arrayBuffer());
    const key = ulid();
    const mime = b.type || "application/octet-stream";
    await this.db.exec({ sql: "INSERT INTO blobs(key, mime, bytes) VALUES(?, ?, ?)", bind: [key, mime, bytes] });
    return { key, mime };
  }

  async putBlobWithKey(key: string, b: Blob): Promise<MediaRef> {
    const bytes = new Uint8Array(await b.arrayBuffer());
    const mime = b.type || "application/octet-stream";
    await this.db.exec({
      sql: "INSERT INTO blobs(key, mime, bytes) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET mime=excluded.mime, bytes=excluded.bytes",
      bind: [key, mime, bytes],
    });
    return { key, mime };
  }

  async getBlob(r: MediaRef): Promise<Blob | null> {
    const row = (await this.db.selectObjects("SELECT mime, bytes FROM blobs WHERE key=?", [r.key]))[0];
    if (!row) return null;
    // Copy into a standalone ArrayBuffer. The wasm layer may hand back a Uint8Array (over a
    // possibly-shared buffer) or a raw ArrayBuffer depending on version — handle both explicitly
    // rather than casting blindly, so a shape change surfaces as a clear error.
    const raw = row.bytes;
    let buf: ArrayBuffer;
    if (raw instanceof Uint8Array) {
      buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    } else if (raw instanceof ArrayBuffer) {
      buf = raw.slice(0);
    } else {
      throw new Error(`getBlob: unexpected blob column type for key ${r.key}`);
    }
    return new Blob([buf], { type: row.mime as string });
  }

  // ── kv ──────────────────────────────────────────────────────────────────────
  async kvGet(k: string): Promise<string | null> {
    const v = await this.db.selectValue("SELECT v FROM kv WHERE k=?", [k]);
    return v == null ? null : (v as string);
  }

  async kvSet(k: string, v: string): Promise<void> {
    await this.db.exec({ sql: "INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", bind: [k, v] });
  }

  async kvDelete(k: string): Promise<void> {
    await this.db.exec({ sql: "DELETE FROM kv WHERE k=?", bind: [k] });
  }

  async kvKeys(prefix?: string): Promise<string[]> {
    const rows = await this.db.selectObjects("SELECT k FROM kv ORDER BY k");
    const keys = rows.map((r) => r.k as string);
    return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
  }

  // ── migrations ───────────────────────────────────────────────────────────────
  async storedSchemaVersion(): Promise<number> {
    return Number((await this.db.selectValue("SELECT v FROM meta WHERE k='schemaVersion'")) ?? 0);
  }

  async runMigrations(plan: MigrationPlan): Promise<void> {
    // Atomic: the DELETE-then-reinsert in writeBack + the version bump run inside one SAVEPOINT, so
    // a crash mid-migration rolls back cleanly instead of leaving an emptied, un-versioned table.
    await this.transaction(async () => {
      const records = await this.loadAll();
      const affected = new Set<string>();
      for (const migration of plan.migrations) {
        for (const step of migration.steps) {
          for (const entity of applyMigrationStep(step, records, nowIso)) affected.add(entity);
        }
      }
      await this.writeBack(records);
      await this.db.exec({
        sql: "INSERT INTO meta(k, v) VALUES('schemaVersion', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        bind: [String(plan.toSchemaVersion)],
      });
      await this.kvSet("__appVersion", plan.toAppVersion);
      for (const entity of affected) this.emit(entity); // buffered, flushed on commit
    });
  }

  /** Load every record into an in-memory set, preserving per-entity creation order (by `seq`). */
  private async loadAll(): Promise<EntityRecords> {
    const records: EntityRecords = new Map();
    const rows = await this.db.selectObjects("SELECT entity, doc FROM records ORDER BY seq");
    for (const row of rows) {
      const entity = row.entity as string;
      let m = records.get(entity);
      if (!m) {
        m = new Map();
        records.set(entity, m);
      }
      const rec = JSON.parse(row.doc as string) as PotyroRecord;
      m.set(rec.id, rec);
    }
    return records;
  }

  /** Replace the entire record table from an in-memory set, re-establishing creation order. */
  private async writeBack(records: EntityRecords): Promise<void> {
    await this.db.exec("DELETE FROM records");
    for (const [entity, m] of records) {
      for (const [id, rec] of m) {
        await this.db.exec({
          sql: "INSERT INTO records(entity, id, doc) VALUES(?, ?, ?)",
          bind: [entity, id, JSON.stringify(rec)],
        });
      }
    }
  }
}
