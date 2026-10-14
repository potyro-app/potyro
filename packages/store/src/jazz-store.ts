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
//        ├─ "meta"     -> CoMap<string, JsonValue>     (schemaVersion, appVersion)
//        └─ "chat"     -> CoMap<"<thread>\u0000<ulid>", {t,c}>  ← messages (KA-35); `c` is an HLC stamp
//
// Chat sits BESIDE the entity tree, not inside it. It is in the space, so it syncs and is encrypted
// to the members, but it is not app data: an app shared with you is untrusted code by someone else,
// and nothing here is reachable from `ctx`.
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

import type { Id, PotyroRecord, MediaRef, Value } from "potyro";
import type { ChatMessage, FieldEdit, MigrationPlan, Narrow, Store, StoreRules, StoreSchema, StoredFile, Unsubscribe } from "./types.js";
import { recordThread } from "./types.js";
import { foldSet, foldSetFields, isScalarSet, parseSetKey, setFieldsOf, setKey, setWrites } from "./set-field.js";
import { applyMigrationStep } from "./migrate.js";
import { ulid } from "./ulid.js";
import { HybridClock, formatHlc, parseHlc } from "./hlc.js";
import { isReservedPath } from "./app-lock.js";

/** Fields this store maintains itself. Their edits are not activity anyone wants reported. */
const BOOKKEEPING = new Set(["id", "createdAt", "createdBy", "updatedAt"]);

// Structural types over cojson, so this module does not hard-depend on its class shapes and stays
// testable. Only the surface actually used is declared.
interface RawMapLike {
  id: string;
  /** Fires when this CoValue changes — including changes that arrived from a PEER. */
  subscribe(listener: (m: RawMapLike) => void): () => void;
  set(key: string, value: unknown, privacy?: "private" | "trusting"): void;
  delete(key: string, privacy?: "private" | "trusting"): void;
  get(key: string): unknown;
  keys(): string[];
  toJSON(): Record<string, unknown>;
  /**
   * Every edit ever made to one key, oldest first, each with its author and time (KA-36).
   *
   * cojson keeps this because a CoMap write IS a signed per-key transaction — the history is a
   * by-product of the merge strategy, not something we store on the side.
   */
  editsAt?(key: string): Iterable<{ by: string; at: Date; value: unknown }>;
  /** Every key ever written, deleted ones included (cojson's per-key op log). */
  ops?: Record<string, unknown>;
}
interface RawGroupLike {
  createMap<T = RawMapLike>(init?: Record<string, unknown>): T;
  /** A binary CoValue: bytes sync on their own, not as transactions in the app's document (KA-20). */
  createBinaryStream?<T = RawBinaryLike>(): T;
}

/** cojson's `RawBinaryCoStream`, narrowed to what this store uses. */
interface RawBinaryLike {
  id: string;
  startBinaryStream(settings: { mimeType: string; fileName?: string; totalSizeBytes?: number }): void;
  pushBinaryStreamChunk(chunk: Uint8Array<ArrayBuffer>): void;
  endBinaryStream(): void;
  getBinaryChunks(allowUnfinished?: boolean): { mimeType: string; chunks: Uint8Array<ArrayBuffer>[]; finished: boolean } | undefined;
  subscribe(listener: (s: RawBinaryLike) => void): () => void;
}
interface NodeLike {
  /** Async because a CoValue restored from storage is not in memory until it is loaded. */
  load(id: string): Promise<unknown>;
  /** The CoValue if it is already in memory — never a fetch (#255). */
  getLoaded?(id: string): unknown;
  /** The CoValue's core, to load it from THIS device's storage only (#255). */
  getCoValue?(id: string): { isAvailable(): boolean; loadFromStorage(done?: (found: boolean) => void): void };
  /** This device+tab's session. Two of them never share a counter key — see `increment`. */
  currentSessionID?: string;
  /** The account signing this node's writes. */
  getCurrentAccountOrAgentID?(): string;
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
/**
 * The app's own folder (#252): file id -> its index entry. The bytes are blobs (a stream each, under
 * `ROOT_BLOBS`), so a member who has never opened a file has its entry and not its bytes — which is
 * exactly "on demand" (#255).
 */
const ROOT_FILES = "files";

/** Base64 helpers, kept for blobs written before KA-20 moved bytes into their own CoValue. */
function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
const ROOT_META = "meta";
const ROOT_CHAT = "chat";

function nowIso(): string {
  return new Date().toISOString();
}

/** CoMap values are JSON. Strip anything that is not (notably `Date` -> ISO), as SqliteStore does. */
function toJsonValue<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

function asDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(v as never);
}

/**
 * Replay one mergeable field's raw key edits into the values that field actually held (KA-36/KA-38).
 *
 * A counter and a set are each stored as a base plus a scatter of contributions under their own
 * keys, precisely so two people never write the same key. That is what makes them merge, and it is
 * also what makes their history unreadable: the log holds "session 7's subtotal became 2", never
 * "the count became 5". Folding after every step recovers the second from the first, which is the
 * only form anyone can be shown.
 *
 * `part === null` is the base — the plain value written before anything merged into it. A write to
 * the base drops the contributions, matching what `update` does to the keys themselves.
 */
function replayDerived(
  kind: "set" | "counter",
  events: readonly { part: string | null; value: unknown; by: string; at: Date }[],
): Array<{ value: unknown; by: string; at: Date }> {
  let base: unknown = kind === "counter" ? 0 : undefined;
  let parts = new Map<string, unknown>();
  const out: Array<{ value: unknown; by: string; at: Date }> = [];

  for (const e of events) {
    if (e.part === null) {
      base = e.value;
      parts = new Map();
    } else {
      parts.set(e.part, e.value);
    }

    let value: unknown;
    if (kind === "set") {
      const deltas = new Map<string, boolean>();
      for (const [element, on] of parts) deltas.set(element, Boolean(on));
      value = foldSet(base, deltas);
    } else {
      let total = Number(base ?? 0);
      if (!Number.isFinite(total)) total = 0;
      for (const subtotal of parts.values()) {
        const n = Number(subtotal);
        if (Number.isFinite(n)) total += n;
      }
      value = total;
    }
    out.push({ value, by: e.by, at: e.at });
  }
  return out;
}

export class JazzStore implements Store {
  private readonly node: NodeLike;
  private readonly group: RawGroupLike;
  private readonly initialRootId?: string;
  private whenDurable?: () => Promise<void>;
  private root!: RawMapLike;
  private appId: string | null = null;
  private listeners = new Map<string, Set<() => void>>();
  /** cojson subscriptions per entity, so remote changes reach `Store.subscribe`. */
  private watched = new Map<string, () => void>();
  /**
   * Entities being watched by a PLACEHOLDER — subscribed to the container the index will appear in,
   * because the index itself is not here yet and making one to subscribe to is how records end up
   * stranded in a rival container.
   */
  private pending = new Set<string>();
  /**
   * Depth of the local mutation currently running.
   *
   * cojson notifies synchronously when THIS device writes, which would double-fire alongside the
   * local `emit` — every other Store impl notifies exactly once per write, and the shared battery
   * asserts it. A counter rather than a boolean so nested writes (a transaction) unwind correctly,
   * and synchronous so it is impossible for a REMOTE notification to be mistaken for a local one:
   * remote changes never arrive while a local mutation is on the stack.
   */
  private localDepth = 0;
  /** entity -> set-valued field keys, from `describe`. Empty until the app says otherwise. */
  private setFields = new Map<string, Set<string>>();

  /**
   * Learn which fields are sets, so writing one merges element by element (KA-38).
   *
   * Reading does not need this — `foldSetFields` recognises the shape from the keys — so a store
   * that is never described stays correct, it just keeps writing whole arrays.
   */
  describe(schema: StoreSchema, rules?: StoreRules): void {
    this.setFields = setFieldsOf(schema);
    this.creatorOnly = new Set(rules?.creatorOnly ?? []);
  }

  /** Entities whose records only their creator may change (`editableBy: "creator"`, KA-21). */
  private creatorOnly = new Set<string>();

  /**
   * A record as its CREATOR left it, and who that is — for a creator-only entity (KA-21).
   *
   * Enforced here, on read, because this is where authorship is a fact rather than a claim: every
   * write is a transaction signed by its account, and the log keeps all of them. Another member's
   * copy can still write to the record — the group lets any writer — but those writes are simply not
   * folded in, so everyone keeps seeing the creator's version. Same for a delete: the index entry is
   * read at the last value its creator wrote.
   *
   * The creator is whoever wrote the record's index entry first. Ordering is by the transaction's
   * own timestamp, which a hand-modified client could backdate; app code — trusted or in the isolate
   * — cannot, since it only reaches the log through this store.
   */
  private async scoped(entity: string, id: Id): Promise<{ m: RawMapLike; creator: string } | null> {
    const index = await this.entityIndexIfPresent(entity);
    if (!index) return null;
    const edits = [...(index.editsAt?.(id) ?? [])];
    const first = edits[0];
    if (!first) return null;
    const creator = String(first.by);
    let ref: unknown;
    for (const e of edits) if (String(e.by) === creator) ref = e.value;
    if (typeof ref !== "string") return null;
    return { m: JazzStore.byAuthor(await this.loadMap(ref), creator), creator };
  }

  /** A view of `m` holding, for every key, the last value `author` wrote — nobody else's. */
  private static byAuthor(m: RawMapLike, author: string): RawMapLike {
    const last = (key: string): unknown => {
      let value: unknown;
      for (const e of m.editsAt?.(key) ?? []) if (String(e.by) === author) value = e.value;
      return value;
    };
    const keys = (): string[] => Object.keys(m.ops ?? {}).concat(m.ops ? [] : m.keys()).filter((k) => last(k) !== undefined);
    return {
      id: m.id,
      subscribe: (listener) => m.subscribe(listener),
      set: (key, value, privacy) => m.set(key, value, privacy),
      delete: (key, privacy) => m.delete(key, privacy),
      get: last,
      keys,
      toJSON: () => Object.fromEntries(keys().map((k) => [k, last(k)])),
      editsAt: function* (key: string) {
        for (const e of m.editsAt?.(key) ?? []) if (String(e.by) === author) yield e;
      },
    };
  }

  /** Refuse an edit to a creator-only record by anyone but its creator, in words for a person. */
  private assertCreator(creator: string, doing: "change" | "delete"): void {
    const me = this.node.getCurrentAccountOrAgentID?.();
    if (me && me !== creator) throw new Error(`Only the person who added this can ${doing} it.`);
  }

  constructor(deps: JazzStoreDeps) {
    this.node = deps.node;
    this.group = deps.group;
    this.initialRootId = deps.rootId;
    this.whenDurable = deps.whenDurable;
  }

  /** Replace the durability hook. The IndexedDB backend needs writes to await its snapshot too,
   *  and that is only known once the backing store has been chosen. */
  setWhenDurable(fn: () => Promise<void>): void {
    this.whenDurable = fn;
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

  /**
   * Resolve a child CoMap held under `key` WITHOUT creating one.
   *
   * The creating variant below is a hazard on a read: a guest whose root has not synced yet would
   * mint its own container and write it over the pointer — two maps, and whichever lost the write is
   * stranded with the data in it. That is exactly how a photo taken by the person who shared an app
   * became unreadable on the device that joined it (KA-20). Reads take this one and treat "not
   * there" as "not here yet".
   */
  private async childIfPresent(parent: RawMapLike, key: string): Promise<RawMapLike | null> {
    const existing = parent.get(key);
    if (typeof existing !== "string") return null;
    try {
      return await this.loadMap(existing);
    } catch {
      return null; // pointer known, container not synced yet
    }
  }

  /** Resolve a child CoMap held by id under `key`, creating it on first use. */
  private async child(parent: RawMapLike, key: string): Promise<RawMapLike> {
    const existing = parent.get(key);
    if (typeof existing === "string") return this.loadMap(existing);
    const created = this.group.createMap<RawMapLike>({});
    parent.set(key, created.id);
    return created;
  }

  /**
   * The entity's index, CREATING it (and the entities container) if absent. Writes only.
   *
   * A read must never take this path. A guest whose root has not replicated yet would mint its own
   * container and write it over the pointer — two maps, and whichever lost the write is stranded
   * with the records in it. That is the defect `childIfPresent` was introduced for, on blobs and
   * kv (KA-20); entity data was left on the creating variant for reads as well as writes, which is
   * the same bug against the one thing an app is actually made of.
   */
  private async entityIndex(entity: string): Promise<RawMapLike> {
    return this.child(await this.child(this.root, ROOT_ENTITIES), entity);
  }

  /** The entity's index if it is here, without making one. `null` means "no records yet, or not
   *  replicated yet" — which a read must treat as empty rather than as a reason to create. */
  private async entityIndexIfPresent(entity: string): Promise<RawMapLike | null> {
    const entities = await this.childIfPresent(this.root, ROOT_ENTITIES);
    return entities ? this.childIfPresent(entities, entity) : null;
  }

  private async recordMap(entity: string, id: Id): Promise<RawMapLike | null> {
    if (this.creatorOnly.has(entity)) return (await this.scoped(entity, id))?.m ?? null;
    const index = await this.entityIndexIfPresent(entity);
    const refId = index?.get(id);
    return typeof refId === "string" ? this.loadMap(refId) : null;
  }

  /**
   * Creation order without relying on CoMap key order, which is not guaranteed to agree across
   * peers. `createdAt` then `id` is stable everywhere, and ULIDs already sort by creation time —
   * so two devices list the same rows in the same order.
   */
  private async readEntity(entity: string): Promise<PotyroRecord[]> {
    const index = await this.entityIndexIfPresent(entity);
    if (!index) return [];
    const rows: PotyroRecord[] = [];
    if (this.creatorOnly.has(entity)) {
      // Every id ever indexed: a record someone else "deleted" is still there, as its creator left it.
      for (const recordId of Object.keys(index.ops ?? {}).concat(index.ops ? [] : index.keys())) {
        const found = await this.scoped(entity, recordId);
        if (found) rows.push(JazzStore.materialise(found.m) as unknown as PotyroRecord);
      }
      return rows.sort((a, b) =>
        a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
      );
    }
    for (const recordId of index.keys()) {
      const refId = index.get(recordId);
      if (typeof refId !== "string") continue; // deleted: tombstoned to undefined
      rows.push(JazzStore.materialise(await this.loadMap(refId)) as unknown as PotyroRecord);
    }
    return rows.sort((a, b) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
    );
  }

  /** Local listeners fire synchronously on write, matching every other Store impl. */
  private emit(entity: string): void {
    for (const cb of this.listeners.get(entity) ?? []) cb();
  }

  /** Run a local mutation with cojson's synchronous self-notification suppressed. */
  private local<T>(fn: () => T): T {
    this.localDepth++;
    try {
      return fn();
    } catch (e) {
      // The engine's words for "this device may not write here" — after the owner removed you, or
      // on a view-only invite (#58) — mean nothing to a person looking at a form that won't save.
      if (e instanceof Error && /does not have write permissions|role of current account is (reader|revoked)/.test(e.message)) {
        throw new Error("You can't change this app: you were removed from it, or you can only view it.");
      }
      throw e;
    } finally {
      this.localDepth--;
    }
  }

  /**
   * Bridge cojson's change notifications into `Store.subscribe`.
   *
   * Without this, a remote change updated the CoValues but nothing told the runtime to re-query, so
   * a peer's edits only became visible once THIS device happened to write something — which is the
   * bug this fixes: tab 1 sat on stale data until you typed into it.
   *
   * Two levels are needed. The entity index fires when records are added or removed; each record
   * CoMap fires when its own fields change. Watching only the index would miss every edit to an
   * existing record — which is exactly the case the whole engine was chosen for.
   */
  private async watchEntity(entity: string): Promise<void> {
    if (this.watched.has(entity)) return;
    const index = await this.entityIndexIfPresent(entity);
    if (!index) {
      // Not here yet: an entity nothing has written, or a guest whose space is still replicating.
      // Creating the index to have something to subscribe to is exactly what strands records in a
      // rival container — so wait for the real one and attach when it lands.
      let cancelled = false;
      const unsubs: Array<() => void> = [];
      let entities = await this.childIfPresent(this.root, ROOT_ENTITIES);
      /**
       * Has THIS entity's index appeared?
       *
       * Decided synchronously, from the pointer, and latched before anything is awaited. Both
       * matter: the container fires for every entity written into it, so an async check would emit
       * for someone else's insert — a contract break ("notify on entity change") — and two checks
       * in flight would both pass and attach two watchers.
       */
      const attach = (): void => {
        if (cancelled) return;
        if (!entities) {
          // The container itself is what has not arrived yet; pick it up and watch it too.
          void this.childIfPresent(this.root, ROOT_ENTITIES).then((found) => {
            if (cancelled || !found || entities) return;
            entities = found;
            unsubs.push(found.subscribe(attach));
            attach();
          });
          return;
        }
        if (typeof entities.get(entity) !== "string") return;
        cancelled = true;
        for (const un of unsubs) un();
        this.watched.delete(entity);
        this.pending.delete(entity);
        // Watch it for real, then tell anyone listening — their first read found nothing.
        void this.watchEntity(entity).then(() => this.emit(entity));
      };
      unsubs.push(this.root.subscribe(attach));
      if (entities) unsubs.push(entities.subscribe(attach));
      this.pending.add(entity);
      this.watched.set(entity, () => {
        cancelled = true;
        this.pending.delete(entity);
        for (const un of unsubs) un();
      });
      attach();
      return;
    }
    const perRecord = new Map<string, () => void>();

    // Which record CoValues to watch. For a creator-only entity that includes records someone else
    // "deleted" from the index (KA-21): they are still showing, so their creator's edits must still
    // arrive live.
    const refsToWatch = (): string[] => {
      if (!this.creatorOnly.has(entity)) {
        return index.keys().flatMap((recordId) => {
          const refId = index.get(recordId);
          return typeof refId === "string" ? [refId] : [];
        });
      }
      return Object.keys(index.ops ?? {}).flatMap((recordId) =>
        [...(index.editsAt?.(recordId) ?? [])].flatMap((e) => (typeof e.value === "string" ? [e.value] : [])),
      );
    };

    const syncRecordWatchers = (): void => {
      for (const refId of refsToWatch()) {
        if (perRecord.has(refId)) continue;
        void this.loadMap(refId)
          .then((m) => {
            if (!perRecord.has(refId)) {
              perRecord.set(
                refId,
                m.subscribe(() => {
                  if (this.localDepth === 0) this.emit(entity);
                }),
              );
            }
          })
          // A record that cannot be loaded yet is not fatal: it will arrive with a later index
          // notification, and throwing here would kill the whole subscription.
          .catch(() => {});
      }
    };

    const unsubIndex = index.subscribe(() => {
      if (this.localDepth > 0) return; // our own write; `emit` already fired
      syncRecordWatchers();
      this.emit(entity);
    });
    syncRecordWatchers();

    this.watched.set(entity, () => {
      unsubIndex();
      for (const un of perRecord.values()) un();
    });
  }

  // ---- lifecycle --------------------------------------------------------------------------

  async open(appId: string): Promise<void> {
    this.appId = appId;
    if (this.initialRootId) {
      // Attaching to a root someone else made — a guest, or this device on a later open. Nothing is
      // created here: a guest's `open()` runs BEFORE `acceptInvite`, so it has no write permission
      // yet and any write would fail the whole boot.
      this.root = await this.loadMap(this.initialRootId);
      return;
    }
    this.root = this.group.createMap<RawMapLike>({ appId });
    // Created with the root, by the only party that certainly may: a container made lazily is one
    // two peers can make at the same time, and the loser's messages would be stranded in an
    // orphaned CoValue. Apps whose root predates this fall back to lazy creation on first post.
    await this.chat();
    // Same reason, for the containers a GUEST reads before it has written anything (KA-20): the
    // blob index and the kv map. Made here by the app's creator, so no second device ever mints a
    // rival copy of them.
    await this.child(this.root, ROOT_BLOBS);
    await this.child(this.root, ROOT_KV);
    // The folder too (#252). A root made before files existed gets it lazily on the first write,
    // like the chat: see #255 for making that safe between two devices writing first at once.
    await this.child(this.root, ROOT_FILES);
    // And the entities container — the one that was left lazy, and the one that holds the data.
    // Every read below takes the non-creating path now, so without this a brand-new app would have
    // nowhere to put its first record until something wrote one.
    await this.child(this.root, ROOT_ENTITIES);
  }

  async close(): Promise<void> {
    for (const un of this.watched.values()) un();
    this.watched.clear();
    this.appId = null;
  }

  // ---- reads ------------------------------------------------------------------------------

  async all(entity: string, narrow?: Narrow): Promise<PotyroRecord[]> {
    let rows = await this.readEntity(entity);
    if (narrow?.ids) {
      const want = new Set(narrow.ids);
      rows = rows.filter((r) => want.has(r.id));
    }
    const offset = narrow?.offset ?? 0;
    const end = narrow?.limit != null ? offset + narrow.limit : undefined;
    return rows.slice(offset, end);
  }

  async get(entity: string, id: Id): Promise<PotyroRecord | null> {
    const m = await this.recordMap(entity, id);
    return m ? (JazzStore.materialise(m) as unknown as PotyroRecord) : null;
  }

  /**
   * Who changed what, when — read straight out of the CRDT log (KA-36).
   *
   * Nothing is stored to make this work: a record is a CoMap, a write is a per-key signed
   * transaction, so the history is already there and the author is derived from the signing session
   * rather than from anything an app wrote. That is what makes it unforgeable, and what makes it
   * work RETROACTIVELY for edits made long before the feature existed.
   *
   * `id`/`createdAt`/`createdBy`/`updatedAt` are skipped: they are bookkeeping this store writes
   * itself, and "Ana changed updatedAt" is noise, not activity.
   */
  // ---- messages (KA-35) --------------------------------------------------------------------
  //
  // A thread is a CoMap keyed by a ULID, one message per key. That gives the same "cannot conflict"
  // property an append-only stream would — two people posting at once write DIFFERENT keys, and
  // per-key merge keeps both — while reusing the map machinery already in this file rather than
  // declaring more of cojson's surface.
  //
  // Only the TEXT is stored. Author and time come from the transaction that wrote the key, exactly
  // as `editHistory` reads them, so a sender cannot claim to be someone else and a message cannot be
  // back-dated. Storing `by` as a field would have made both possible.

  /**
   * ONE map for all threads, keyed `<thread>\u0000<ulid>`.
   *
   * The first version gave each thread its own CoMap, created on demand — and two people posting
   * their first message at the same time each created a DIFFERENT map and wrote the same key on the
   * parent, so last-write-wins silently threw one conversation away. Exactly the "keying an index so
   * peers diverge" failure this file warns about elsewhere, reproduced by a test before it was seen
   * in the wild.
   *
   * Flattened, there is nothing to create concurrently: every message is its own unique key in a
   * container that exists from `open()`.
   */
  private async chat(): Promise<RawMapLike> {
    return this.child(this.root, ROOT_CHAT);
  }

  /** Everything in one map, so keys carry the thread. `\u0000` cannot occur in a thread key. */
  private static threadPrefix(thread: string): string {
    return `${thread}\u0000`;
  }

  private static threadKey(thread: string, id: string): string {
    return `${JazzStore.threadPrefix(thread)}${id}`;
  }

  /**
   * This device's hybrid clock — what makes a conversation read in the right order (see `hlc.ts`).
   *
   * Rebuilt from what is read: every `messages()` folds in every stamp it sees, so a freshly opened
   * page has caught up with the thread before it can post into it.
   */
  private readonly clock = new HybridClock();

  /**
   * What is stored for one message.
   *
   * Was a bare string. The stamp had to go somewhere, and it cannot come from the transaction the
   * way `by` and `at` do — a CRDT records WHEN A DEVICE CLAIMS it wrote, which is exactly the number
   * that could not be trusted to order anything. A legacy bare string is still read; it simply has
   * no stamp and falls back to transaction time.
   */
  private static encodeMessage(text: string, stamp: string): string {
    return JSON.stringify({ t: text, c: stamp });
  }

  private static decodeMessage(raw: unknown): { text: string; stamp: string | null } | null {
    if (typeof raw !== "string") return null;
    // Written before stamps existed: no clock, and the leading `{` is what tells them apart.
    if (!raw.startsWith("{")) return { text: raw, stamp: null };
    try {
      const parsed = JSON.parse(raw) as { t?: unknown; c?: unknown };
      if (typeof parsed?.t !== "string") return null;
      return { text: parsed.t, stamp: typeof parsed.c === "string" && parseHlc(parsed.c) ? parsed.c : null };
    } catch {
      // A message that will not parse must not take the conversation down with it.
      return null;
    }
  }

  async postMessage(thread: string, text: string): Promise<ChatMessage> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("An empty message has nothing to say.");
    const map = await this.chat();
    // Catch up on the thread BEFORE stamping. Posting without having folded in what is already there
    // is how a reply gets a stamp lower than the message it answers.
    await this.messages(thread);
    const id = ulid();
    const stamp = formatHlc(this.clock.issue());
    map.set(JazzStore.threadKey(thread, id), JazzStore.encodeMessage(trimmed, stamp));
    await this.whenDurable?.();

    const posted = (await this.messages(thread)).find((m) => m.id === id);
    // The write happened; if reading its own metadata back somehow fails, do not lose the message.
    return posted ?? { id, text: trimmed, by: "", at: new Date() };
  }

  async messages(thread: string, opts?: { since?: Date; limit?: number }): Promise<ChatMessage[]> {
    const map = await this.chat();
    const since = opts?.since?.getTime();
    const prefix = JazzStore.threadPrefix(thread);
    const out: ChatMessage[] = [];

    for (const key of map.keys()) {
      if (!key.startsWith(prefix)) continue;
      const decoded = JazzStore.decodeMessage(map.get(key));
      if (!decoded) continue;
      // Fold every stamp we see into this device's clock, whether or not it is returned below — that
      // is what makes the NEXT thing posted here sort after everything already said.
      this.clock.observe(decoded.stamp);
      // The FIRST edit of the key is the post. A later one would be an edit, which nothing offers.
      const first = map.editsAt?.(key)?.[Symbol.iterator]().next().value as
        | { by: string; at: Date | number }
        | undefined;
      const at = first ? (first.at instanceof Date ? first.at : new Date(first.at)) : new Date(0);
      if (since !== undefined && at.getTime() <= since) continue;
      out.push({
        id: key.slice(prefix.length),
        text: decoded.text,
        by: String(first?.by ?? ""),
        at,
        ...(decoded.stamp ? { stamp: decoded.stamp } : {}),
      });
    }

    // Oldest first, as a conversation reads — by the HYBRID CLOCK, not by anyone's wall clock.
    //
    // Sorting on `at` (the time the sending device claimed) meant a device five minutes fast put its
    // messages five minutes into everyone's future, and a reply written on a correct clock sorted
    // BEFORE the message it answered. Every peer agreed on that order, which is what made it look
    // deliberate rather than broken.
    //
    // A message with no stamp predates stamping, so it falls back to `at` — and sorts first, which
    // is where it belongs. The ULID breaks a remaining tie so peers still agree exactly.
    const rank = (m: ChatMessage): string =>
      m.stamp ?? `0000000000000.00000#${String(m.at.getTime()).padStart(13, "0")}`;
    out.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra < rb ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    return opts?.limit ? out.slice(-opts.limit) : out;
  }

  /**
   * Stop a thread being readable. Called when the record it hangs off is deleted.
   *
   * `delete` on each key, not a container swap: everything lives in ONE map precisely so there is
   * no container for two peers to race over, and replacing it would reintroduce that. A peer that
   * posts concurrently with the delete keeps its message — per-key merge, nothing else to decide —
   * and it is unreachable anyway once the record is gone.
   */
  private async dropThread(thread: string): Promise<void> {
    const map = await this.chat();
    const prefix = JazzStore.threadPrefix(thread);
    for (const key of map.keys()) {
      if (key.startsWith(prefix)) map.delete(key);
    }
  }

  subscribeMessages(thread: string, cb: () => void): Unsubscribe {
    let stop: (() => void) | null = null;
    let alive = true;
    void this.chat().then((map) => {
      if (!alive) return;
      stop = map.subscribe(() => cb());
    });
    return () => {
      alive = false;
      stop?.();
    };
  }

  async editHistory(entity: string, id: Id, opts?: { since?: Date }): Promise<FieldEdit[]> {
    const m = await this.recordMap(entity, id);
    if (!m?.editsAt) return [];

    const since = opts?.since?.getTime();
    const out: FieldEdit[] = [];

    // A counter's per-session subtotals and a set's per-element keys are not fields — they are how
    // ONE field survives two people — so their raw edits are nobody's idea of activity. Reported
    // straight, they read as `tagsurgent` changing to `1`. Grouped here and replayed below,
    // they read as what the field actually held at that moment, which is what a person asked.
    const derived = new Map<string, { kind: "set" | "counter"; keys: string[] }>();
    const group = (field: string, kind: "set" | "counter", key: string): void => {
      const g = derived.get(field) ?? { kind, keys: [] };
      g.keys.push(key);
      derived.set(field, g);
    };

    for (const key of m.keys()) {
      const asSet = parseSetKey(key);
      if (asSet) {
        group(asSet.field, "set", key);
        continue;
      }
      const asCounter = JazzStore.parseCounterKey(key);
      if (asCounter) {
        group(asCounter.field, "counter", key);
        continue;
      }
      if (BOOKKEEPING.has(key)) continue;
      // A plain field. Its own key may ALSO be the base of a derived one, so it is grouped rather
      // than emitted whenever element or subtotal keys exist beside it.
      for (const edit of m.editsAt(key) ?? []) {
        out.push({ field: key, value: edit.value, by: String(edit.by), at: asDate(edit.at) });
      }
    }

    for (const [field, { kind, keys }] of derived) {
      // The base is the plain value written before anyone merged into it — already emitted above as
      // an ordinary field. Fold it in here instead, and drop the raw version, so the field has one
      // timeline rather than two that disagree.
      const base = out.filter((e) => e.field === field);
      for (let i = out.length - 1; i >= 0; i--) if (out[i]!.field === field) out.splice(i, 1);

      const events = [
        ...base.map((e) => ({ part: null, value: e.value, by: e.by, at: e.at })),
        ...keys.flatMap((key) => {
          const part = kind === "set" ? parseSetKey(key)!.element : JazzStore.parseCounterKey(key)!.session;
          return [...(m.editsAt!(key) ?? [])].map((e) => ({
            part,
            value: e.value,
            by: String(e.by),
            at: asDate(e.at),
          }));
        }),
      ].sort((a, b) => a.at.getTime() - b.at.getTime());

      for (const step of replayDerived(kind, events)) out.push({ field, ...step });
    }

    // One record's edits across all its fields, in the order they happened.
    return out
      .filter((e) => since === undefined || e.at.getTime() > since)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  async byIndex(entity: string, field: string, value: Value): Promise<PotyroRecord[]> {
    return (await this.readEntity(entity)).filter((r) => r[field] === value);
  }

  // ---- writes -----------------------------------------------------------------------------

  async insert(entity: string, data: Partial<PotyroRecord>): Promise<PotyroRecord> {
    const id = (data.id as Id) ?? ulid();
    const ts = nowIso();
    const record = {
      ...toJsonValue(data),
      id,
      createdAt: (data.createdAt as string) ?? ts,
      updatedAt: ts,
    } as PotyroRecord;
    // One CoMap per record — this is what makes concurrent edits to different fields merge.
    const index = await this.entityIndex(entity);
    // This write may be what creates the index. A watcher parked on the container would notice and
    // announce it — a second notification for a write that announces itself below. Upgrade it here,
    // quietly, so the placeholder only ever speaks for a container that arrived from a PEER.
    if (this.pending.has(entity)) {
      this.watched.get(entity)?.();
      this.watched.delete(entity);
      await this.watchEntity(entity);
    }
    this.local(() => {
      const created = this.group.createMap<RawMapLike>(record as unknown as Record<string, unknown>);
      index.set(id, created.id);
    });
    this.emit(entity);
    await this.whenDurable?.();
    return record;
  }

  async update(entity: string, id: Id, patch: Partial<PotyroRecord>): Promise<PotyroRecord> {
    if (this.creatorOnly.has(entity)) {
      const found = await this.scoped(entity, id);
      if (found) this.assertCreator(found.creator, "change");
    }
    const m = await this.recordMap(entity, id);
    if (!m) throw new Error(`update: ${entity}/${id} not found`);
    // Set only the changed keys. Writing the whole record back would make every field a write and
    // clobber a concurrent peer's edit to a field this caller never touched — throwing away the
    // per-key merge that is the entire reason for this store.
    //
    // A SET field goes one level further, for the same reason one level down (KA-38). `tags` arrives
    // as a whole array — `[...row.tags, "urgent"]` is the only way an app can express "add one" —
    // and writing that array back re-asserts every element in it, including elements a peer removed
    // and excluding elements a peer added that this caller never saw. So the array is diffed against
    // what is actually there and only the elements that CHANGED are written, each under its own key.
    const sets = this.setFields.get(entity);
    const current = sets?.size ? (JazzStore.materialise(m) as Record<string, unknown>) : null;
    this.local(() => {
      for (const [k, v] of Object.entries(toJsonValue(patch))) {
        if (k === "id" || k === "createdAt") continue; // immutable
        // `isScalarSet` is the honest guard, not a formality: element-wise merge needs elements that
        // can be keys. Anything else (a list of rows, a null, a media ref) is written whole, which is
        // what this store did for everything until now.
        if (current && sets?.has(k)) {
          if (isScalarSet(v)) {
            const before = current[k];
            for (const [element, present] of setWrites(isScalarSet(before) ? before : [], v)) {
              m.set(setKey(k, element), present ? 1 : 0);
            }
            continue;
          }
          // Written whole (a `null` that clears it, or a shape elements cannot be made from). The
          // per-element keys have to go with it — left behind, they would fold straight back on top
          // of the new value and the field would refuse to be cleared.
          for (const key of m.keys()) if (parseSetKey(key)?.field === k) m.delete(key);
        }
        m.set(k, v);
      }
      m.set("updatedAt", nowIso());
    });
    this.emit(entity);
    await this.whenDurable?.();
    return JazzStore.materialise(m) as unknown as PotyroRecord;
  }

  /**
   * A counter that survives two people adding at once (KA-38).
   *
   * ## Why not just add to the field
   *
   * `update(id, { n: n + 1 })` reads on one device and writes on another. Both read 0, both write 1,
   * and a press disappears. Last-write-wins is doing exactly what it promises; the mistake is asking
   * a single value to hold a total that several people contribute to.
   *
   * ## The shape
   *
   * Each session keeps ITS OWN subtotal, under its own key: `n\u0001<sessionID>`. The value anyone
   * reads is the sum. Because no two sessions ever write the same key, per-key merge — the thing this
   * store is built on — makes concurrent increments simply add up. That is a G/PN-counter assembled
   * out of the CoMap we already have, rather than a new CoValue type and a new shape to migrate.
   *
   * ## Living beside a plain value
   *
   * A field may already hold an ordinary number, written before anyone incremented it. That is the
   * base: the total is `base + Σ(session subtotals)`. So turning a `patch`-written field into a
   * counter needs no migration, and reading it through `all()`/`get()` gives one number either way.
   */
  async increment(entity: string, id: Id, field: string, delta: number): Promise<number> {
    if (this.creatorOnly.has(entity)) {
      const found = await this.scoped(entity, id);
      if (found) this.assertCreator(found.creator, "change");
    }
    const m = await this.recordMap(entity, id);
    if (!m) throw new Error(`increment: ${entity}/${id} not found`);
    const session = this.node.currentSessionID ?? "local";
    const key = JazzStore.counterKey(field, session);
    const mine = Number(m.get(key) ?? 0);
    this.local(() => {
      m.set(key, mine + delta);
      m.set("updatedAt", nowIso());
    });
    this.emit(entity);
    await this.whenDurable?.();
    return JazzStore.counterTotal(m, field);
  }

  /** `\u0001` cannot appear in a field name, so a counter key can never collide with a real field. */
  private static counterKey(field: string, session: string): string {
    return `${field}\u0001${session}`;
  }

  /** `\u0001` again: `null` when the key is an ordinary field rather than one session's subtotal. */
  private static parseCounterKey(key: string): { field: string; session: string } | null {
    const at = key.indexOf("\u0001");
    if (at <= 0) return null;
    return { field: key.slice(0, at), session: key.slice(at + 1) };
  }

  /** The plain value, plus every session's subtotal. */
  private static counterTotal(m: RawMapLike, field: string): number {
    const prefix = `${field}\u0001`;
    let total = Number(m.get(field) ?? 0);
    if (!Number.isFinite(total)) total = 0;
    for (const k of m.keys()) {
      if (!k.startsWith(prefix)) continue;
      const v = Number(m.get(k));
      if (Number.isFinite(v)) total += v;
    }
    return total;
  }

  /**
   * Turn what is stored into what the app asked for.
   *
   * Two mergeable shapes live inside the record CoMap — a counter's per-session subtotals (KA-38,
   * `increment`) and a set's per-element keys (`set-field.ts`) — and neither is anything an app
   * should ever see. Everything that reads a record comes through here, so app code, views and
   * exports get one number and one array and never learn how either survived two people.
   *
   * That is the whole argument for doing this at the store seam: the app keeps saying
   * `record.bought` and `record.tags`, and simply stops losing other people's work.
   */
  private static materialise(m: RawMapLike): Record<string, unknown> {
    return foldSetFields(JazzStore.withCounters(m));
  }

  /** Counter subtotals folded back into plain fields, with the per-session keys hidden. */
  private static withCounters(m: RawMapLike): Record<string, unknown> {
    const raw = m.toJSON() as Record<string, unknown>;
    const fields = new Set<string>();
    for (const k of Object.keys(raw)) {
      const at = k.indexOf("\u0001");
      if (at > 0) fields.add(k.slice(0, at));
    }
    if (!fields.size) return raw;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) if (!k.includes("\u0001")) out[k] = v;
    for (const f of fields) out[f] = JazzStore.counterTotal(m, f);
    return out;
  }

  async delete(entity: string, id: Id): Promise<void> {
    const index = await this.entityIndexIfPresent(entity);
    if (!index) return;
    if (this.creatorOnly.has(entity)) {
      const found = await this.scoped(entity, id);
      if (!found) return;
      this.assertCreator(found.creator, "delete");
    } else if (typeof index.get(id) !== "string") return;
    // Tombstone by dropping the index entry. The record CoMap itself is left addressable so a
    // concurrent peer editing it does not resurrect a half-record through the index.
    this.local(() => index.delete(id));
    // A record's conversation dies with it (KA-35). Left behind, the messages would be unreachable
    // — nothing lists a thread whose record is gone — and would come back attached to the wrong
    // thing if that id were ever reused. The transactions stay in the log, which nothing compacts
    // (KA-30); what ends here is the thread being readable.
    await this.dropThread(recordThread(entity, id));
    this.emit(entity);
    await this.whenDurable?.();
  }

  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    // Compensating write, not a rollback — see the header. Snapshot every entity's rows, and on
    // failure restore them.
    const entityNames = (await this.childIfPresent(this.root, ROOT_ENTITIES))?.keys() ?? [];
    const snapshot = new Map<string, PotyroRecord[]>();
    for (const entity of entityNames) snapshot.set(entity, await this.readEntity(entity));
    try {
      return await fn(this);
    } catch (err) {
      for (const [entity, rows] of snapshot) {
        const index = await this.entityIndexIfPresent(entity);
        if (!index) continue;
        const keep = new Set(rows.map((r) => r.id));
        for (const id of index.keys()) {
          if (!keep.has(id) && typeof index.get(id) === "string") index.delete(id);
        }
        for (const row of rows) {
          const m = await this.recordMap(entity, row.id);
          if (m) {
            // The snapshot holds MATERIALISED values — one number for a counter, one array for a set
            // — so restoring it has to clear the contributions those values were folded from. Left
            // in place, they fold straight back on top of what was just restored and the record ends
            // up at neither the old value nor the new one. (True of counters since they landed; a
            // rollback silently doubled them.)
            for (const key of m.keys()) {
              if (parseSetKey(key) ?? JazzStore.parseCounterKey(key)) m.delete(key);
            }
            for (const [k, v] of Object.entries(row)) m.set(k, v as unknown);
          } else {
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
    // Attaching is async (CoValues load async) while `subscribe` is sync by contract; a peer's
    // change arriving before it attaches is caught by the initial `syncRecordWatchers` pass.
    void this.watchEntity(entity);
    return () => set!.delete(cb);
  }

  // ---- blobs ------------------------------------------------------------------------------

  /**
   * A photo is its OWN CoValue, not bytes inside the app's document (KA-20, ADR D5).
   *
   * Base64 in a CoMap — what this did before — makes every byte a CRDT transaction: replicated to
   * everyone in the space whether or not they ever open the photo, kept forever because nothing
   * compacts the log (KA-30), and counted twice over by base64's third. A `FileStream` is a separate
   * CoValue that syncs on its own and is fetched when someone actually looks at it. It is owned by
   * the same group, so its chunks are sealed with the same read key as every other private
   * transaction: the relay stores ciphertext and can no more read a photo than a record.
   *
   * `ROOT_BLOBS` stays, now as an INDEX: `MediaRef.key` -> the stream's CoValue id. The key is what
   * records already embed and what `copyStoreData` preserves, so it cannot become the stream id.
   * Entries written by the old build are plain `{ mime, base64 }` objects and are still read.
   */
  async putBlob(b: Blob): Promise<MediaRef> {
    return this.writeBlob(ulid(), b);
  }

  async putBlobWithKey(key: string, b: Blob): Promise<MediaRef> {
    return this.writeBlob(key, b);
  }

  /** 64 KB: cojson signs roughly per 100 KB transaction and recommends staying under it. */
  private static readonly CHUNK = 64 * 1024;

  private async writeBlob(key: string, b: Blob): Promise<MediaRef> {
    const mime = b.type || "application/octet-stream";
    const bytes = new Uint8Array(await b.arrayBuffer()) as Uint8Array<ArrayBuffer>;
    const index = await this.child(this.root, ROOT_BLOBS);

    const stream = this.group.createBinaryStream?.<RawBinaryLike>();
    if (!stream) {
      // A group without binary streams (a test double). Keep the old shape rather than lose the file.
      index.set(key, { mime, base64: base64Of(bytes) });
      await this.whenDurable?.();
      return { key, mime };
    }

    this.local(() => {
      stream.startBinaryStream({ mimeType: mime, totalSizeBytes: bytes.byteLength });
      for (let at = 0; at < bytes.byteLength; at += JazzStore.CHUNK) {
        stream.pushBinaryStreamChunk(bytes.subarray(at, Math.min(at + JazzStore.CHUNK, bytes.byteLength)));
      }
      stream.endBinaryStream();
      // The index entry LAST: a half-written stream nothing points at is invisible, where a pointer
      // to a half-written stream would render as a broken photo.
      index.set(key, { mime, stream: stream.id });
    });
    await this.whenDurable?.();
    return { key, mime };
  }

  /**
   * The blob, or `null` when its bytes are not here yet.
   *
   * `null` is not an error and not "deleted": on a device that just joined, the photo is a CoValue
   * that has not arrived. Asking for it is what makes cojson fetch it, so a view that renders a
   * placeholder and asks again gets the photo as soon as it lands (#61).
   */
  async getBlob(r: MediaRef): Promise<Blob | null> {
    const entry = (await this.childIfPresent(this.root, ROOT_BLOBS))?.get(r.key) as
      | { mime: string; base64?: string; stream?: string }
      | undefined;
    if (!entry) return null;
    if (typeof entry.base64 === "string") return new Blob([bytesOf(entry.base64)], { type: entry.mime }); // written before KA-20
    if (typeof entry.stream !== "string") return null;

    const stream = await this.loadBinary(entry.stream);
    const parts = stream?.getBinaryChunks();
    if (!parts?.finished) return null; // still arriving — the caller shows "not downloaded yet"
    return new Blob(parts.chunks as BlobPart[], { type: parts.mimeType || entry.mime });
  }

  /**
   * Whether a blob's bytes are on this device, asking no one (#255). In memory and complete, or in
   * this device's storage and complete once loaded from it. `getBlob` is what fetches; this never does,
   * so a list of a shared app's files can say which are here without pulling every one of them.
   */
  async blobHere(r: MediaRef): Promise<boolean> {
    const entry = (await this.childIfPresent(this.root, ROOT_BLOBS))?.get(r.key) as { base64?: string; stream?: string } | undefined;
    if (!entry) return false;
    if (typeof entry.base64 === "string") return true;
    const id = entry.stream;
    if (typeof id !== "string") return false;
    const finished = (): boolean => !!(this.node.getLoaded?.(id) as RawBinaryLike | undefined)?.getBinaryChunks()?.finished;
    if (finished()) return true;
    const core = this.node.getCoValue?.(id);
    if (!core || core.isAvailable()) return false;
    await new Promise<void>((resolve) => core.loadFromStorage(() => resolve()));
    return finished();
  }

  /** Fires when a blob's bytes arrive, so a placeholder can become the photo without a reload. */
  subscribeBlob(r: MediaRef, cb: () => void): Unsubscribe {
    let stop: (() => void) | null = null;
    let alive = true;
    void (async () => {
      const entry = (await this.childIfPresent(this.root, ROOT_BLOBS))?.get(r.key) as { stream?: string } | undefined;
      if (!alive || typeof entry?.stream !== "string") return;
      const stream = await this.loadBinary(entry.stream);
      if (!alive || !stream) return;
      stop = stream.subscribe(() => cb());
    })();
    return () => {
      alive = false;
      stop?.();
    };
  }

  private async loadBinary(id: string): Promise<RawBinaryLike | null> {
    try {
      const v = await this.node.load(id);
      return v && v !== "unavailable" ? (v as RawBinaryLike) : null;
    } catch {
      return null;
    }
  }

  // ---- kv ---------------------------------------------------------------------------------

  /**
   * Forget a blob. Only the index entry goes: the stream is a CoValue other members may hold, and
   * history in a CRDT is not deleted. What a person sees is that the old bytes are no longer anyone's.
   */
  async deleteBlob(key: string): Promise<void> {
    const index = await this.childIfPresent(this.root, ROOT_BLOBS);
    if (!index || index.get(key) === undefined) return;
    index.delete(key);
    await this.whenDurable?.();
  }

  // ---- files (#252) ------------------------------------------------------------------------

  async listFiles(): Promise<StoredFile[]> {
    const map = await this.childIfPresent(this.root, ROOT_FILES);
    if (!map) return [];
    return map
      .keys()
      .map((id) => map.get(id))
      .filter((v): v is StoredFile => !!v && typeof v === "object" && typeof (v as StoredFile).id === "string")
      .map((f) => ({ ...f }));
  }

  async getFile(id: string): Promise<StoredFile | null> {
    const v = (await this.childIfPresent(this.root, ROOT_FILES))?.get(id) as StoredFile | undefined;
    return v && typeof v === "object" ? { ...v } : null;
  }

  async setFile(entry: StoredFile): Promise<void> {
    // A shared space holds the app's DATA. Its code (`.modules/`, `.src/`) stays on each device and
    // travels with the source, checked against the lock (#281): megabytes of library bytes do not
    // belong in every member's copy, and code written here would reach them without that check.
    if (isReservedPath(entry.path)) throw new Error(`"${entry.path}" is the app's code, which a shared space does not hold`);
    (await this.child(this.root, ROOT_FILES)).set(entry.id, { ...entry });
    await this.whenDurable?.();
  }

  async deleteFile(id: string): Promise<void> {
    const map = await this.childIfPresent(this.root, ROOT_FILES);
    if (!map || map.get(id) === undefined) return;
    map.delete(id);
    await this.whenDurable?.();
  }

  subscribeFiles(cb: () => void): Unsubscribe {
    let stop: (() => void) | null = null;
    let alive = true;
    void this.childIfPresent(this.root, ROOT_FILES).then((map) => {
      if (!alive || !map) return;
      stop = map.subscribe(() => cb());
    });
    return () => {
      alive = false;
      stop?.();
    };
  }

  async kvGet(k: string): Promise<string | null> {
    const v = (await this.childIfPresent(this.root, ROOT_KV))?.get(k);
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

  memberIds(): readonly string[] {
    // Member keys hold every role ever granted, "revoked" included; non-account agents (invites, the
    // relay's server agent) are not people.
    const keys = (this.group as { getMemberKeys?(): string[] }).getMemberKeys?.() ?? [];
    return keys.filter((k) => k.startsWith("co_"));
  }

  subscribeKv(cb: () => void): Unsubscribe {
    let stop: (() => void) | null = null;
    let alive = true;
    void this.child(this.root, ROOT_KV).then((map) => {
      if (!alive) return;
      stop = map.subscribe(() => cb());
    });
    return () => {
      alive = false;
      stop?.();
    };
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
    const records = new Map<string, Map<Id, PotyroRecord>>();
    for (const entity of (await this.childIfPresent(this.root, ROOT_ENTITIES))?.keys() ?? []) {
      records.set(entity, new Map((await this.readEntity(entity)).map((r) => [r.id, r])));
    }

    const affected = new Set<string>();
    for (const migration of plan.migrations) {
      for (const step of migration.steps) {
        for (const entity of applyMigrationStep(step, records, nowIso)) affected.add(entity);
      }
    }

    for (const [entity, rows] of records) {
      const index = await this.entityIndexIfPresent(entity);
      if (!index) continue;
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
