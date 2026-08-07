// JazzStore — the CRDT-backed `Store` (ADR 0001 D1, KA-08).
//
// ## Why this shape
//
// The whole reason Jazz won the engine evaluation is that a `CoMap` merges PER KEY: two peers
// editing different fields of the same record both survive (measured in
// `docs/spikes/jazz-merge-granularity.mjs`). That property only exists if a record IS a CoMap.
// Storing a record as one JSON blob inside a CoMap key would collapse it to whole-document
// last-write-wins — exactly the failure that disqualified Evolu's per-column model. So:
//
//   Group  (the space — membership + roles; ADR D3)
//    └─ root CoMap
//        ├─ "entities" -> CoMap<entityName, entityIndexId>
//        │                  └─ entityIndex CoMap<recordId, recordCoMapId>
//        │                       └─ record CoMap: field -> JsonValue   ← per-key merge lives HERE
//        ├─ "kv"       -> CoMap<string, string>        (ctx.storage)
//        ├─ "blobs"    -> CoMap<key, {mime, base64}>   (see "Blobs" below)
//        └─ "meta"     -> CoMap<string, JsonValue>     (schemaVersion, appVersion)
//
// CoValue references are stored as their id strings and resolved through the node.
//
// ## Local-only, by design (first increment)
//
// No peers are attached here. Sync is opt-in per app: `SqliteStore` remains the default for
// local-only apps, and the composition root selects `JazzStore` for apps the user turns sync on
// for. That keeps docs/01's "no server requirement" literally true and matches ADR D3, where a
// solo app is simply a space with one member and no transport. Attaching a peer is additive —
// nothing in this file changes when it happens.
//
// ## Two deliberate deviations, both documented in the ADR
//
// - **`transaction` is a compensating write, not a rollback.** CRDTs have no distributed
//   atomicity; there is no "undo transaction" in cojson. On throw we restore the pre-transaction
//   record set. That is correct locally (what the Store contract tests) and honest about not
//   being an atomic operation across peers.
// - **`Date` values round-trip as ISO strings**, because CoMap values are JSON. This matches
//   `SqliteStore` (which `JSON.stringify`s its `doc`) rather than `MemoryStore` (which uses
//   `structuredClone` and preserves `Date`). Matching the *durable* store is the right precedent.

import type { Id, KartaRecord, MediaRef, Value } from "karta";
import type { MigrationPlan, Narrow, Store, Unsubscribe } from "./types.js";
import { applyMigrationStep } from "./migrate.js";
import { ulid } from "./ulid.js";

// Structural types over cojson, so this module does not hard-depend on its class shapes and stays
// testable. Only the surface actually used is declared.
interface RawMapLike {
  id: string;
  set(key: string, value: unknown, privacy?: "private" | "trusting"): void;
  delete(key: string, privacy?: "private" | "trusting"): void;
  get(key: string): unknown;
  keys(): string[];
  toJSON(): Record<string, unknown>;
}
interface RawGroupLike {
  createMap<T = RawMapLike>(init?: Record<string, unknown>): T;
}
interface NodeLike {
  /** Async because a CoValue restored from storage is not in memory until it is loaded. */
  load(id: string): Promise<unknown>;
}

export interface JazzStoreDeps {
  /** The cojson node. The composition root owns the account/session; the store just uses it. */
  node: NodeLike;
  /** The space this app's data lives in. One group per app (ADR D3). */
  group: RawGroupLike;
  /**
   * Reattach to an existing root instead of creating one.
   *
   * Without this, `open()` would mint a fresh root every time and the app would look empty after
   * every reload — the CoValues survive in storage, but nothing would point at them. The caller
   * persists {@link JazzStore.rootId} and hands it back on the next open.
   */
  rootId?: string;
  /**
   * Resolves once every local write has reached storage.
   *
   * cojson flushes asynchronously, so without this a write that has *returned* may still be lost
   * to an immediate reload — add a record, refresh, gone. `SqliteStore` commits synchronously, so
   * its writes are durable when they return; awaiting this gives JazzStore the same guarantee
   * instead of asking every caller to remember. Injected by `createJazzStore`; absent (a no-op)
   * for a store with no storage attached, e.g. in tests.
   */
  whenDurable?: () => Promise<void>;
}

const ROOT_ENTITIES = "entities";
const ROOT_KV = "kv";
const ROOT_BLOBS = "blobs";
const ROOT_META = "meta";

function nowIso(): string {
  return new Date().toISOString();
}

/** CoMap values are JSON. Strip anything that is not (notably `Date` -> ISO), as SqliteStore does. */
function toJsonValue<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export class JazzStore implements Store {
  private readonly node: NodeLike;
  private readonly group: RawGroupLike;
  private readonly initialRootId?: string;
  private readonly whenDurable?: () => Promise<void>;
  private root!: RawMapLike;
  private appId: string | null = null;
  private listeners = new Map<string, Set<() => void>>();

  constructor(deps: JazzStoreDeps) {
    this.node = deps.node;
    this.group = deps.group;
    this.initialRootId = deps.rootId;
    this.whenDurable = deps.whenDurable;
  }

  /** The root CoValue id. Persist this and pass it back as `rootId` to reopen the same data. */
  get rootId(): string {
    return this.root.id;
  }

  // ---- CoValue plumbing -------------------------------------------------------------------

  /**
   * Resolve a CoValue by id.
   *
   * Async on purpose: values created in this session are in memory, but anything restored from
   * storage (or arriving from a peer) is not until it is loaded. An earlier sync version worked in
   * tests only because every value had just been created — it threw on the first real reload.
   */
  private async loadMap(id: string): Promise<RawMapLike> {
    const v = await this.node.load(id);
    if (v === "unavailable" || v == null) {
      throw new Error(`JazzStore: CoValue ${id} is unavailable (storage missing, or not yet synced)`);
    }
    return v as RawMapLike;
  }

  /** Resolve a child CoMap held by id under `key`, creating it on first use. */
  private async child(parent: RawMapLike, key: string): Promise<RawMapLike> {
    const existing = parent.get(key);
    if (typeof existing === "string") return this.loadMap(existing);
    const created = this.group.createMap<RawMapLike>({});
    parent.set(key, created.id);
    return created;
  }

  private async entityIndex(entity: string): Promise<RawMapLike> {
    return this.child(await this.child(this.root, ROOT_ENTITIES), entity);
  }

  private async recordMap(entity: string, id: Id): Promise<RawMapLike | null> {
    const refId = (await this.entityIndex(entity)).get(id);
    return typeof refId === "string" ? this.loadMap(refId) : null;
  }

  /**
   * Creation order without relying on CoMap key order, which is not guaranteed to agree across
   * peers. `createdAt` then `id` is stable everywhere, and ULIDs already sort by creation time —
   * so two devices list the same rows in the same order.
   */
  private async readEntity(entity: string): Promise<KartaRecord[]> {
    const index = await this.entityIndex(entity);
    const rows: KartaRecord[] = [];
    for (const recordId of index.keys()) {
      const refId = index.get(recordId);
      if (typeof refId !== "string") continue; // deleted: tombstoned to undefined
      rows.push((await this.loadMap(refId)).toJSON() as unknown as KartaRecord);
    }
    return rows.sort((a, b) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
    );
  }

  /** Local listeners fire synchronously on write, matching every other Store impl. Remote
   *  convergence will additionally drive these from a cojson subscription when a peer attaches. */
  private emit(entity: string): void {
    for (const cb of this.listeners.get(entity) ?? []) cb();
  }

  // ---- lifecycle --------------------------------------------------------------------------

  async open(appId: string): Promise<void> {
    this.appId = appId;
    this.root = this.initialRootId
      ? await this.loadMap(this.initialRootId)
      : this.group.createMap<RawMapLike>({ appId });
  }

  async close(): Promise<void> {
    this.appId = null;
  }

  // ---- reads ------------------------------------------------------------------------------

  async all(entity: string, narrow?: Narrow): Promise<KartaRecord[]> {
    let rows = await this.readEntity(entity);
    if (narrow?.ids) {
      const want = new Set(narrow.ids);
      rows = rows.filter((r) => want.has(r.id));
    }
    const offset = narrow?.offset ?? 0;
    const end = narrow?.limit != null ? offset + narrow.limit : undefined;
    return rows.slice(offset, end);
  }

  async get(entity: string, id: Id): Promise<KartaRecord | null> {
    const m = await this.recordMap(entity, id);
    return m ? (m.toJSON() as unknown as KartaRecord) : null;
  }

  async byIndex(entity: string, field: string, value: Value): Promise<KartaRecord[]> {
    return (await this.readEntity(entity)).filter((r) => r[field] === value);
  }

  // ---- writes -----------------------------------------------------------------------------

  async insert(entity: string, data: Partial<KartaRecord>): Promise<KartaRecord> {
    const id = (data.id as Id) ?? ulid();
    const ts = nowIso();
    const record = {
      ...toJsonValue(data),
      id,
      createdAt: (data.createdAt as string) ?? ts,
      updatedAt: ts,
    } as KartaRecord;
    // One CoMap per record — this is what makes concurrent edits to different fields merge.
    const created = this.group.createMap<RawMapLike>(record as unknown as Record<string, unknown>);
    (await this.entityIndex(entity)).set(id, created.id);
    this.emit(entity);
    await this.whenDurable?.();
    return record;
  }

  async update(entity: string, id: Id, patch: Partial<KartaRecord>): Promise<KartaRecord> {
    const m = await this.recordMap(entity, id);
    if (!m) throw new Error(`update: ${entity}/${id} not found`);
    // Set only the changed keys. Writing the whole record back would make every field a write and
    // clobber a concurrent peer's edit to a field this caller never touched — throwing away the
    // per-key merge that is the entire reason for this store.
    for (const [k, v] of Object.entries(toJsonValue(patch))) {
      if (k === "id" || k === "createdAt") continue; // immutable
      m.set(k, v);
    }
    m.set("updatedAt", nowIso());
    this.emit(entity);
    await this.whenDurable?.();
    return m.toJSON() as unknown as KartaRecord;
  }

  async delete(entity: string, id: Id): Promise<void> {
    const index = await this.entityIndex(entity);
    if (typeof index.get(id) !== "string") return;
    // Tombstone by dropping the index entry. The record CoMap itself is left addressable so a
    // concurrent peer editing it does not resurrect a half-record through the index.
    index.delete(id);
    this.emit(entity);
    await this.whenDurable?.();
  }

  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    // Compensating write, not a rollback — see the header. Snapshot every entity's rows, and on
    // failure restore them.
    const entityNames = (await this.child(this.root, ROOT_ENTITIES)).keys();
    const snapshot = new Map<string, KartaRecord[]>();
    for (const entity of entityNames) snapshot.set(entity, await this.readEntity(entity));
    try {
      return await fn(this);
    } catch (err) {
      for (const [entity, rows] of snapshot) {
        const index = await this.entityIndex(entity);
        const keep = new Set(rows.map((r) => r.id));
        for (const id of index.keys()) {
          if (!keep.has(id) && typeof index.get(id) === "string") index.delete(id);
        }
        for (const row of rows) {
          const m = await this.recordMap(entity, row.id);
          if (m) for (const [k, v] of Object.entries(row)) m.set(k, v as unknown);
          else {
            const created = this.group.createMap<RawMapLike>(row as unknown as Record<string, unknown>);
            index.set(row.id, created.id);
          }
        }
        this.emit(entity);
      }
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

  // ---- blobs ------------------------------------------------------------------------------

  /**
   * Base64 in a CoMap for now. Deliberately provisional: media belongs in a `FileStream` so bytes
   * sync out-of-band instead of bloating every peer's transaction log with data most peers never
   * open (ADR D5). That is KA-20 and it lands with the relay, not before — a local-only store has
   * nothing to bloat.
   */
  async putBlob(b: Blob): Promise<MediaRef> {
    const key = ulid();
    const mime = b.type || "application/octet-stream";
    const bytes = new Uint8Array(await b.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    (await this.child(this.root, ROOT_BLOBS)).set(key, { mime, base64: btoa(binary) });
    await this.whenDurable?.();
    return { key, mime };
  }

  async putBlobWithKey(key: string, b: Blob): Promise<MediaRef> {
    const mime = b.type || "application/octet-stream";
    const bytes = new Uint8Array(await b.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    (await this.child(this.root, ROOT_BLOBS)).set(key, { mime, base64: btoa(binary) });
    await this.whenDurable?.();
    return { key, mime };
  }

  async getBlob(r: MediaRef): Promise<Blob | null> {
    const entry = (await this.child(this.root, ROOT_BLOBS)).get(r.key) as
      | { mime: string; base64: string }
      | undefined;
    if (!entry) return null;
    const binary = atob(entry.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: entry.mime });
  }

  // ---- kv ---------------------------------------------------------------------------------

  async kvGet(k: string): Promise<string | null> {
    const v = (await this.child(this.root, ROOT_KV)).get(k);
    return typeof v === "string" ? v : null;
  }

  async kvSet(k: string, v: string): Promise<void> {
    (await this.child(this.root, ROOT_KV)).set(k, v);
    await this.whenDurable?.();
  }

  async kvDelete(k: string): Promise<void> {
    (await this.child(this.root, ROOT_KV)).delete(k);
    await this.whenDurable?.();
  }

  async kvKeys(prefix?: string): Promise<string[]> {
    const kv = await this.child(this.root, ROOT_KV);
    return kv.keys().filter((k) => kv.get(k) !== undefined && (prefix ? k.startsWith(prefix) : true));
  }

  // ---- migrations -------------------------------------------------------------------------

  async storedSchemaVersion(): Promise<number> {
    const v = (await this.child(this.root, ROOT_META)).get("schemaVersion");
    return typeof v === "number" ? v : 0;
  }

  /**
   * Materialize -> apply the shared pure ops -> write back. Same approach as `SqliteStore`, and it
   * reuses the identical `applyMigrationStep`, so migration semantics cannot drift between stores.
   *
   * Migrating a SHARED space is a distributed event and needs the version gate from KA-22 (#63)
   * before sync is switched on: a peer that migrates writes the new shape into a document its
   * peers replicate.
   */
  async runMigrations(plan: MigrationPlan): Promise<void> {
    const records = new Map<string, Map<Id, KartaRecord>>();
    for (const entity of (await this.child(this.root, ROOT_ENTITIES)).keys()) {
      records.set(entity, new Map((await this.readEntity(entity)).map((r) => [r.id, r])));
    }

    const affected = new Set<string>();
    for (const migration of plan.migrations) {
      for (const step of migration.steps) {
        for (const entity of applyMigrationStep(step, records, nowIso)) affected.add(entity);
      }
    }

    for (const [entity, rows] of records) {
      const index = await this.entityIndex(entity);
      const live = new Set(rows.keys());
      for (const id of index.keys()) {
        if (!live.has(id) && typeof index.get(id) === "string") index.delete(id);
      }
      for (const [id, row] of rows) {
        const existing = await this.recordMap(entity, id);
        if (existing) {
          // A migration may DROP a field; clearing removed keys is what makes `renameField` and
          // `dropField` actually disappear rather than linger beside their replacement.
          for (const k of existing.keys()) {
            if (!(k in row) && existing.get(k) !== undefined) existing.delete(k);
          }
          for (const [k, v] of Object.entries(toJsonValue(row))) existing.set(k, v);
        } else {
          const created = this.group.createMap<RawMapLike>(toJsonValue(row) as unknown as Record<string, unknown>);
          index.set(id, created.id);
        }
      }
    }

    (await this.child(this.root, ROOT_META)).set("schemaVersion", plan.toSchemaVersion);
    await this.kvSet("__appVersion", plan.toAppVersion);
    for (const entity of affected) this.emit(entity);
    await this.whenDurable?.();
  }
}
