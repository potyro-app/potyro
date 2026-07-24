// In-memory Store for tests and the runtime's default (docs/05). Correct + reactive; not
// durable. SqliteStore (OPFS + JSON1) implements the same interface for the PWA (WP3, later).

import type { Id, KartaRecord, MediaRef, MigrationStep, Value } from "karta";
import type { MigrationPlan, Narrow, Store, Unsubscribe } from "./types.js";
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
  protected records = new Map<string, Map<Id, KartaRecord>>();
  protected blobs = new Map<string, BlobEntry>();
  protected kv = new Map<string, string>();
  private listeners = new Map<string, Set<() => void>>();
  protected schemaVersion = 0;

  /** Subclass hook fired after every mutation (LocalStore persists here). */
  protected changed(): void {}

  private entityMap(entity: string): Map<Id, KartaRecord> {
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

  async all(entity: string, narrow?: Narrow): Promise<KartaRecord[]> {
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

  async get(entity: string, id: Id): Promise<KartaRecord | null> {
    const r = this.entityMap(entity).get(id);
    return r ? clone(r) : null;
  }

  async byIndex(entity: string, field: string, value: Value): Promise<KartaRecord[]> {
    const rows = [...this.entityMap(entity).values()].filter((r) => r[field] === value);
    return rows.map(clone);
  }

  async insert(entity: string, data: Partial<KartaRecord>): Promise<KartaRecord> {
    const id = (data.id as Id) ?? ulid();
    const ts = nowIso();
    const record: KartaRecord = {
      ...clone(data),
      id,
      createdAt: (data.createdAt as string) ?? ts,
      updatedAt: ts,
    };
    this.entityMap(entity).set(id, record);
    this.emit(entity);
    return clone(record);
  }

  async update(entity: string, id: Id, patch: Partial<KartaRecord>): Promise<KartaRecord> {
    const existing = this.entityMap(entity).get(id);
    if (!existing) throw new Error(`update: ${entity}/${id} not found`);
    const next: KartaRecord = {
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
    const snapshot = new Map<string, Map<Id, KartaRecord>>();
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
    for (const migration of plan.migrations) {
      for (const step of migration.steps) {
        this.applyStep(step);
      }
    }
    this.schemaVersion = plan.toSchemaVersion;
    this.kv.set("__appVersion", plan.toAppVersion);
    this.changed();
  }

  private applyStep(step: MigrationStep): void {
    if ("transform" in step) {
      for (const [entity, m] of this.records) {
        for (const [id, r] of m) {
          // Migrations run in the app's trust context; a full ctx is only available at the
          // host level. MemoryStore supplies a minimal placeholder for pure record transforms.
          const out = step.transform(r, undefined as never);
          m.set(id, { ...out, id, createdAt: r.createdAt, updatedAt: nowIso() });
        }
      }
      // notify all entities changed
      for (const entity of this.records.keys()) this.emit(entity);
      return;
    }

    switch (step.op) {
      case "addField":
      case "addRelation": {
        const def = step.op === "addField" ? step.default : step.many ? [] : null;
        for (const r of this.entityMap(step.entity).values()) {
          if (r[step.field] === undefined) r[step.field] = def as unknown;
        }
        break;
      }
      case "dropField": {
        for (const r of this.entityMap(step.entity).values()) delete r[step.field];
        break;
      }
      case "renameField": {
        for (const r of this.entityMap(step.entity).values()) {
          if (step.from in r) {
            r[step.to] = r[step.from];
            delete r[step.from];
          }
        }
        break;
      }
      case "changeType": {
        for (const r of this.entityMap(step.entity).values()) {
          r[step.field] = step.via(r[step.field]);
        }
        break;
      }
      case "setDefaultForExisting": {
        for (const r of this.entityMap(step.entity).values()) {
          if (r[step.field] === undefined) r[step.field] = step.value;
        }
        break;
      }
      case "renameEntity": {
        const from = this.records.get(step.from);
        if (from) {
          this.records.set(step.to, from);
          this.records.delete(step.from);
        }
        break;
      }
    }
    if (!("transform" in step)) {
      const affected = "entity" in step ? step.entity : "to" in step ? step.to : null;
      if (affected) this.emit(affected);
    }
  }
}
