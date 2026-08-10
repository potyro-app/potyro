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

import type { Id, KartaRecord, MediaRef, Value } from "karta";
import type { ChatMessage, FieldEdit, MigrationPlan, Narrow, Store, Unsubscribe } from "./types.js";
import { recordThread } from "./types.js";
import { applyMigrationStep } from "./migrate.js";
import { ulid } from "./ulid.js";
import { HybridClock, formatHlc, parseHlc } from "./hlc.js";

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
const ROOT_CHAT = "chat";

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
  private whenDurable?: () => Promise<void>;
  private root!: RawMapLike;
  private appId: string | null = null;
  private listeners = new Map<string, Set<() => void>>();
  /** cojson subscriptions per entity, so remote changes reach `Store.subscribe`. */
  private watched = new Map<string, () => void>();
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

  /** Local listeners fire synchronously on write, matching every other Store impl. */
  private emit(entity: string): void {
    for (const cb of this.listeners.get(entity) ?? []) cb();
  }

  /** Run a local mutation with cojson's synchronous self-notification suppressed. */
  private local<T>(fn: () => T): T {
    this.localDepth++;
    try {
      return fn();
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
    const index = await this.entityIndex(entity);
    const perRecord = new Map<string, () => void>();

    const syncRecordWatchers = (): void => {
      for (const recordId of index.keys()) {
        const refId = index.get(recordId);
        if (typeof refId !== "string" || perRecord.has(refId)) continue;
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
  }

  async close(): Promise<void> {
    for (const un of this.watched.values()) un();
    this.watched.clear();
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
    for (const field of m.keys()) {
      if (BOOKKEEPING.has(field)) continue;
      for (const edit of m.editsAt(field) ?? []) {
        const at = edit.at instanceof Date ? edit.at : new Date(edit.at as never);
        if (since !== undefined && at.getTime() <= since) continue;
        out.push({ field, value: edit.value, by: String(edit.by), at });
      }
    }
    // One record's edits across all its fields, in the order they happened.
    return out.sort((a, b) => a.at.getTime() - b.at.getTime());
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
    const index = await this.entityIndex(entity);
    this.local(() => {
      const created = this.group.createMap<RawMapLike>(record as unknown as Record<string, unknown>);
      index.set(id, created.id);
    });
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
    this.local(() => {
      for (const [k, v] of Object.entries(toJsonValue(patch))) {
        if (k === "id" || k === "createdAt") continue; // immutable
        m.set(k, v);
      }
      m.set("updatedAt", nowIso());
    });
    this.emit(entity);
    await this.whenDurable?.();
    return m.toJSON() as unknown as KartaRecord;
  }

  async delete(entity: string, id: Id): Promise<void> {
    const index = await this.entityIndex(entity);
    if (typeof index.get(id) !== "string") return;
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
    // Attaching is async (CoValues load async) while `subscribe` is sync by contract; a peer's
    // change arriving before it attaches is caught by the initial `syncRecordWatchers` pass.
    void this.watchEntity(entity);
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
