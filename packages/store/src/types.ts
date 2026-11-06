// The persistence seam (docs/05 "Store"). Filtering/sorting is done by the *runtime* in JS
// over fetched rows (personal scale), so this surface is deliberately simple: fetch by entity
// with optional cheap narrowing, plus writes, reactivity, blobs, kv, and migrations. A CRDT
// store later implements the same interface.

import type { Field, FileInfo, Id, PotyroRecord, MediaRef, Migration, TextEdit, TextRun, Value } from "potyro";

export type Unsubscribe = () => void;

/** Cheap indexable narrowing for `all` (never a substitute for JS filtering). */
export interface Narrow {
  ids?: Id[];
  limit?: number;
  offset?: number;
}

/** A migration run plan handed to `runMigrations` (docs/06). */
export interface MigrationPlan {
  fromAppVersion: string | null;
  toAppVersion: string;
  fromSchemaVersion: number;
  toSchemaVersion: number;
  migrations: Migration[];
}

/**
 * The app's declared shape, for a store that can act on it (KA-38). Entity key -> field key -> field.
 *
 * Only the DECLARED parts — the fields, which are plain data. Computed and actions are functions and
 * have no business crossing this seam; a store that could see them would be a store that could be
 * tempted to run them.
 */
export type StoreSchema = Record<string, Record<string, Field>>;

/**
 * Who may change what, as the app declared it (KA-21).
 *
 * `creatorOnly`: entities whose records only their creator may change or delete (`editableBy:
 * "creator"`). A store with peers enforces it where the authorship is — in its signed log, on read —
 * so another member's edit simply does not take, whatever their copy did. A store without peers has
 * nothing to enforce and may ignore it.
 */
/** What a link to one record carries (docs/24 §12): where it is, and the secret that lets its holder in. */
export interface RecordInvite {
  entity: string;
  id: Id;
  /** The record's own group. */
  group: string;
  /** The record's CoValue. */
  map: string;
  secret: string;
}

export interface StoreRules {
  creatorOnly?: readonly string[];
  /**
   * Entities whose records are shared one by one (`share: "record"`, docs/24 §12). A store with
   * peers makes each such record in a group of its own, with the records that point at it; a
   * store without peers has nothing to separate and may ignore it.
   */
  sharedRecords?: readonly string[];
}

/** A file's index entry as a store keeps it: what the app sees, plus the blob key of its bytes. */
export interface StoredFile extends FileInfo {
  blob: string;
  /** What newer writes replaced, newest first, kept for a while (#255; `file-space.ts`). */
  earlier?: EarlierCopy[];
}

/** What a shared space holds on the relay, in bytes, and how much it may (#255). */
export interface SpaceUsage {
  used: number;
  budget: number;
}

/** A file's bytes as they were before a newer write replaced them. */
export interface EarlierCopy {
  blob: string;
  hash: string;
  size: number;
  mime: string;
  /** When this copy was written. */
  updated: string;
  /** When a newer write replaced it: how long it has been kept counts from here. */
  replaced: string;
}

export interface Store {
  open(appId: string): Promise<void>;
  close(): Promise<void>;

  /**
   * Tell the store what the app declared (KA-38).
   *
   * `open` takes an id and nothing else, so until now the store held records without knowing that
   * `tags` is a set, `notes` is prose or `n` is a count. It stored what it was handed. That is
   * exactly why a CRDT store could not merge the things the schema had already named: the mapping
   * from a declared type to the right merge behaviour existed on paper and nowhere in the code.
   *
   * Optional, and never required to be called: a store that ignores it behaves as it always did, and
   * a set field written by an app that never described itself still READS correctly (the merged
   * shape is recognisable from the data). Calling it only makes future writes merge better.
   */
  describe?(schema: StoreSchema, rules?: StoreRules): void;

  // reads — return raw records; the runtime resolves relations + computed + JS filters
  all(entity: string, narrow?: Narrow): Promise<PotyroRecord[]>;
  get(entity: string, id: Id): Promise<PotyroRecord | null>;

  // optional indexable fast-path (later optimization; default impl may ignore)
  byIndex?(entity: string, field: string, value: Value): Promise<PotyroRecord[]>;

  // writes
  insert(entity: string, data: Partial<PotyroRecord>): Promise<PotyroRecord>;
  update(entity: string, id: Id, patch: Partial<PotyroRecord>): Promise<PotyroRecord>;
  delete(entity: string, id: Id): Promise<void>;

  /**
   * Add to a number, safely, when two people may add at the same moment (KA-38).
   *
   * `update(id, { n: row.n + 1 })` is the shape every counter button has, and it is a read on one
   * device and a write on another: both read 0, both write 1, and one press is gone with nothing to
   * show for it. That is not a defect in the merge — last-write-wins is exactly what a single value
   * can promise — it is the wrong thing to store. A count is not a value, it is the sum of what
   * everybody added.
   *
   * So this takes the DELTA, never the result. A store that keeps each contributor's total apart can
   * add them up; one that is handed an answer can only keep the newest.
   *
   * Optional because only a CRDT store can honour it. Callers must check: a store without it should
   * fall back to read-modify-write and accept the risk, rather than silently doing nothing.
   */
  increment?(entity: string, id: Id, field: string, delta: number): Promise<number>;
  /**
   * Change a text that several people type into at once (a `text` field with `collaborative: true`).
   *
   * `update(id, { body })` is the counter's mistake one shape up: the whole text is one value, so two
   * people typing at the same moment keep only the last save, and one person's words are gone. Taking
   * the EDITS instead — this went in here, that came out there — lets a CRDT store merge them
   * character by character, the way `increment` adds deltas up. `edits` apply in order, each against
   * the text as the one before left it; positions count UTF-16 units like `String.slice`. Resolves to
   * the text after.
   *
   * Optional, with `textRuns`/`textAnchor`/`textIndex`: only a CRDT store can merge, remember who
   * typed what, or keep a place through others' edits. The host falls back to read-modify-write and
   * to "everything is mine" on a store without them — a local-only app is single-writer anyway.
   */
  editText?(entity: string, id: Id, field: string, edits: TextEdit[]): Promise<string>;
  /** The text as runs, each with the account that typed it (`null` where no author is recorded). */
  textRuns?(entity: string, id: Id, field: string): Promise<TextRun[]>;
  /** An opaque anchor that follows the character at `at` (the length: the end) through everyone's edits. */
  textAnchor?(entity: string, id: Id, field: string, at: number): Promise<string>;
  /** Where an anchor's character is now, or `null` once it has been deleted. */
  textIndex?(entity: string, id: Id, field: string, anchor: string): Promise<number | null>;
  /**
   * Records shared one by one (`share: "record"`, docs/24 §12; record-sharing.ts). What this device
   * may do with a record — look, change, or also invite others to it; an invite to ONE record, to
   * carry in a link's fragment; and joining one from such an invite, after which the record (with
   * the records that point at it) is listed here as if it were the device's own. Optional: only a
   * store with peers has groups; the host answers "admin" for everything on a store without them.
   */
  recordAccess?(entity: string, id: Id): Promise<"reader" | "writer" | "admin">;
  createRecordInvite?(entity: string, id: Id, role: "writer" | "reader"): Promise<RecordInvite>;
  joinRecord?(invite: RecordInvite): Promise<PotyroRecord | null>;
  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>;

  // reactivity — notify on entity change; runtime re-runs JS queries
  subscribe(entity: string, cb: () => void): Unsubscribe;

  // blobs (media), kv (ctx.storage), migration support
  putBlob(b: Blob): Promise<MediaRef>;
  /**
   * Write a blob under an EXISTING key.
   *
   * `putBlob` mints a new key, which is right for capture but wrong for copying: every `MediaRef`
   * already embedded in a record points at the old key, so a re-keyed copy silently loses every
   * photo. Optional so a minimal Store need not implement it; `copyStoreData` reports what it
   * could not move rather than dropping media quietly.
   */
  putBlobWithKey?(key: string, b: Blob): Promise<MediaRef>;
  /**
   * The blob's bytes, or `null` when they are not on this device.
   *
   * `null` is not "deleted" (KA-20): in a shared app a photo is its own CoValue, and a device that
   * has not fetched it yet has the reference without the bytes. Asking is what starts the fetch, so
   * a caller showing a placeholder and asking again gets the photo when it lands.
   */
  getBlob(r: MediaRef): Promise<Blob | null>;
  /** Fires when a blob's bytes arrive. Only a synced store has anything to wait for. */
  subscribeBlob?(r: MediaRef, cb: () => void): Unsubscribe;
  /**
   * Whether a blob's bytes are on this device, WITHOUT fetching them (#255). A store that keeps
   * everything locally need not implement it: its bytes are always here.
   */
  blobHere?(r: MediaRef): Promise<boolean>;
  /**
   * How much a SHARED space holds on the relay, against its budget (#255). Every byte ever written
   * counts — cojson keeps history, so replacing or deleting frees nothing there. Absent where nothing
   * leaves the device.
   */
  spaceUsage?(): Promise<SpaceUsage>;
  /**
   * Drop a blob's bytes. Called when a file is replaced or removed and nothing else points at the
   * old bytes. A synced store may only forget its index entry; the bytes there are history.
   */
  deleteBlob(key: string): Promise<void>;

  // ---- the app's own folder (#252) ----
  // The store keeps an INDEX of files, by id; the bytes are blobs under `entry.blob`. Paths, types,
  // hashing and the rule that a path is taken once live in `file-space.ts`, the same for every store.
  /** Every file entry, in no particular order. */
  listFiles(): Promise<StoredFile[]>;
  getFile(id: string): Promise<StoredFile | null>;
  /** Create or replace the entry with this id. */
  setFile(entry: StoredFile): Promise<void>;
  deleteFile(id: string): Promise<void>;
  /** Fires when any file entry changes, including from a peer. */
  subscribeFiles?(cb: () => void): Unsubscribe;
  kvGet(k: string): Promise<string | null>;
  kvSet(k: string, v: string): Promise<void>;
  kvDelete(k: string): Promise<void>;
  /** Optional key enumeration (backs `ctx.storage.keys`). Default impls may omit it. */
  kvKeys?(prefix?: string): Promise<string[]>;
  /**
   * Fires when any kv entry changes, including from a peer (KA-22).
   *
   * Optional: only a synced store has peers whose writes arrive while the app is open. The shell
   * uses it to notice a newer version of a shared app the moment it is published, instead of on
   * the next open — by which time an old copy may have written old-shape records for minutes.
   */
  subscribeKv?(cb: () => void): Unsubscribe;
  /**
   * Every account that has ever held a role in this space — people who were removed included (KA-19).
   *
   * Optional: only a store with a space has members. It is what a `member` value is checked against
   * on read, so a forged id never reaches a view while a ledger naming someone who has since left
   * stays readable. Synchronous because a synced store keeps its group in memory.
   */
  memberIds?(): readonly string[];
  storedSchemaVersion(): Promise<number>;
  runMigrations(plan: MigrationPlan): Promise<void>;

  /**
   * Who changed which field of a record, and when (KA-36).
   *
   * **Optional, and honestly so.** Only a CRDT store has this: a record there IS a CoMap and every
   * write is a per-key signed transaction, so the history is already in the data and costs nothing
   * to keep. `MemoryStore` and `SqliteStore` store current values and genuinely cannot answer —
   * which is why this is `?` rather than a method they fake by returning `[]`. An empty array means
   * "nothing changed"; absent means "this store cannot tell you", and a feature built on it must be
   * able to say so rather than render a confidently empty screen.
   *
   * `since` windows the walk. The log grows with every edit ever made and never shrinks (KA-30), so
   * folding an app's whole history to render a feed gets slower for as long as the app is used.
   */
  editHistory?(entity: string, id: Id, opts?: { since?: Date }): Promise<FieldEdit[]>;

  // ---- messages between the people sharing this app (KA-35) ----
  //
  // Deliberately on the STORE and not on `ctx`. Messages live in the space but outside the app's
  // entity tree, and an app shared with you is untrusted code by someone else — "their app can read
  // the messages you send them" is an exfiltration path (hard rule 3). The shell calls these; app
  // code has no route to them at all.
  //
  // Optional for the same reason as `editHistory`: a local-only app has no space and nobody to talk
  // to, so the control should be absent rather than present and empty.

  /** Post to a thread. The author is stamped from the signing session, never supplied. */
  postMessage?(thread: string, text: string): Promise<ChatMessage>;
  /** A thread's messages, oldest first. */
  messages?(thread: string, opts?: { since?: Date; limit?: number }): Promise<ChatMessage[]>;
  /** Fires when a message arrives, including from a peer. */
  subscribeMessages?(thread: string, cb: () => void): Unsubscribe;
}

/** One message. `by`/`at` come from the CRDT transaction, so neither can be forged. */
export interface ChatMessage {
  id: string;
  text: string;
  by: string;
  /**
   * When the SENDING DEVICE says it wrote this — read off the transaction, so unforgeable, but only
   * as accurate as that device's clock. Fine to display; do not order by it. See `stamp`.
   */
  at: Date;
  /**
   * Hybrid-logical-clock stamp, and the thing the conversation is actually ordered by.
   *
   * Wall clocks do not order anything across devices: one running five minutes fast puts its
   * messages five minutes into everyone's future, so a reply sorts before the message it answers.
   * The stamp folds in every message the sender had already seen, so causality survives whatever
   * the clocks say. Absent on messages written before stamping existed — those fall back to `at`.
   */
  stamp?: string;
}

/**
 * Thread keys.
 *
 * One room per app, plus a thread per record — the same storage either way, differing only in what
 * the conversation is attached to.
 */
export const ROOM_THREAD = "room";
export const recordThread = (entity: string, id: Id): string => `record:${entity}:${id}`;

/** One field of one record changing, attributed and timed. */
export interface FieldEdit {
  /** Field key as declared by the app. The caller maps it to a label. */
  field: string;
  /** The value written. `undefined` when the field was cleared. */
  value: unknown;
  /**
   * The account that made the change, derived from the signing session — not an app-supplied field,
   * so it cannot be forged (the same guarantee as `PotyroRecord.createdBy`, KA-18).
   */
  by: string;
  at: Date;
}
