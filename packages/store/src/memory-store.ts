// In-memory Store for tests and the runtime's default (docs/05). Correct + reactive; not
// durable. SqliteStore (OPFS + JSON1) implements the same interface for the PWA (WP3, later).

import type { Id, PotyroRecord, MediaRef, Value } from "potyro";
import type { MigrationPlan, Narrow, Store, Unsubscribe } from "./types.js";
import { applyMigrationStep, type EntityRecords } from "./migrate.js";
import { ulid } from "./ulid.js";

interface BlobEntry {
  mime: string;
  bytes: ArrayBuffer;
}

function clone<T>(v: T): T {
  // structuredClone preserves Date; records are JSON-ish + Date values.
  return structuredClone(v);
}

function nowIso(): string {
  return new Date().toISOString();
}

export class MemoryStore implements Store {
  protected appId: string | null = null;
  protected records = new Map<string, Map<Id, PotyroRecord>>();
  protected blobs = new Map<string, BlobEntry>();
  protected kv = new Map<string, string>();
  private listeners = new Map<string, Set<() => void>>();
  protected schemaVersion = 0;

  /** Subclass hook fired after every mutation (LocalStore persists here). */
  protected changed(): void {}

  private entityMap(entity: string): Map<Id, PotyroRecord> {
    let m = this.records.get(entity);
    if (!m) {
      m = new Map();
      this.records.set(entity, m);
    }
    return m;
  }

  private emit(entity: string): void {
    for (const cb of this.listeners.get(entity) ?? []) cb();
    this.changed();
  }

  async open(appId: string): Promise<void> {
    this.appId = appId;
  }

  async close(): Promise<void> {
    this.appId = null;
  }

  async all(entity: string, narrow?: Narrow): Promise<PotyroRecord[]> {
    let rows = [...this.entityMap(entity).values()];
    if (narrow?.ids) {
      const set = new Set(narrow.ids);
      rows = rows.filter((r) => set.has(r.id));
    }
    // Map iteration preserves insertion (creation) order — no id sort needed.
    const offset = narrow?.offset ?? 0;
    const end = narrow?.limit != null ? offset + narrow.limit : undefined;
    return rows.slice(offset, end).map(clone);
  }

  async get(entity: string, id: Id): Promise<PotyroRecord | null> {
    const r = this.entityMap(entity).get(id);
    return r ? clone(r) : null;
  }

  async byIndex(entity: string, field: string, value: Value): Promise<PotyroRecord[]> {
    const rows = [...this.entityMap(entity).values()].filter((r) => r[field] === value);
    return rows.map(clone);
  }

  async insert(entity: string, data: Partial<PotyroRecord>): Promise<PotyroRecord> {
    const id = (data.id as Id) ?? ulid();
    const ts = nowIso();
    const record: PotyroRecord = {
      ...clone(data),
      id,
      createdAt: (data.createdAt as string) ?? ts,
      updatedAt: ts,
    };
    this.entityMap(entity).set(id, record);
    this.emit(entity);
    return clone(record);
  }

  async update(entity: string, id: Id, patch: Partial<PotyroRecord>): Promise<PotyroRecord> {
    const existing = this.entityMap(entity).get(id);
    if (!existing) throw new Error(`update: ${entity}/${id} not found`);
    const next: PotyroRecord = {
      ...existing,
      ...clone(patch),
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowIso(),
    };
    this.entityMap(entity).set(id, next);
    this.emit(entity);
    return clone(next);
  }

  async delete(entity: string, id: Id): Promise<void> {
    if (this.entityMap(entity).delete(id)) this.emit(entity);
  }

  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    // Snapshot for rollback. MemoryStore runs the transaction against itself.
    const snapshot = new Map<string, Map<Id, PotyroRecord>>();
    for (const [e, m] of this.records) snapshot.set(e, new Map(m));
    try {
      return await fn(this);
    } catch (err) {
      this.records = snapshot;
      throw err;
    }
  }

  subscribe(entity: string, cb: () => void): Unsubscribe {
    let set = this.listeners.get(entity);
    if (!set) {
      set = new Set();
      this.listeners.set(entity, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  async putBlob(b: Blob): Promise<MediaRef> {
    const bytes = await b.arrayBuffer();
    const key = ulid();
    this.blobs.set(key, { mime: b.type || "application/octet-stream", bytes });
    this.changed();
    return { key, mime: b.type || "application/octet-stream" };
  }

  async putBlobWithKey(key: string, b: Blob): Promise<MediaRef> {
    const bytes = await b.arrayBuffer();
    const mime = b.type || "application/octet-stream";
    this.blobs.set(key, { mime, bytes });
    this.changed();
    return { key, mime };
  }

  async getBlob(r: MediaRef): Promise<Blob | null> {
    const e = this.blobs.get(r.key);
    if (!e) return null;
    return new Blob([e.bytes], { type: e.mime });
  }

  async kvGet(k: string): Promise<string | null> {
    return this.kv.get(k) ?? null;
  }

  async kvSet(k: string, v: string): Promise<void> {
    this.kv.set(k, v);
    this.changed();
  }

  async kvDelete(k: string): Promise<void> {
    this.kv.delete(k);
    this.changed();
  }

  async kvKeys(prefix?: string): Promise<string[]> {
    return [...this.kv.keys()].filter((k) => (prefix ? k.startsWith(prefix) : true));
  }

  async storedSchemaVersion(): Promise<number> {
    return this.schemaVersion;
  }

  async runMigrations(plan: MigrationPlan): Promise<void> {
    // On a COPY, swapped in only once every step has run. Applied to the live maps, a step that threw
    // left the steps before it applied and the version unchanged — so the next open re-ran them over
    // half-migrated data. SqliteStore gets the same guarantee from its transaction, JazzStore from
    // materialising before it writes (KA-22: the refusal path must not leave partial writes).
    const draft: EntityRecords = new Map(
      [...this.records].map(([entity, rows]) => [entity, new Map([...rows].map(([id, r]) => [id, structuredClone(r)]))]),
    );
    const affected = new Set<string>();
    for (const migration of plan.migrations) {
      for (const step of migration.steps) {
        for (const entity of applyMigrationStep(step, draft, nowIso)) affected.add(entity);
      }
    }
    this.records.clear();
    for (const [entity, rows] of draft) this.records.set(entity, rows);
    for (const entity of affected) this.emit(entity);
    this.schemaVersion = plan.toSchemaVersion;
    this.kv.set("__appVersion", plan.toAppVersion);
    this.changed();
  }
}
