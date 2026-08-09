// The persistence seam (docs/05 "Store"). Filtering/sorting is done by the *runtime* in JS
// over fetched rows (personal scale), so this surface is deliberately simple: fetch by entity
// with optional cheap narrowing, plus writes, reactivity, blobs, kv, and migrations. A CRDT
// store later implements the same interface.

import type { Id, KartaRecord, MediaRef, Migration, Value } from "karta";

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

export interface Store {
  open(appId: string): Promise<void>;
  close(): Promise<void>;

  // reads — return raw records; the runtime resolves relations + computed + JS filters
  all(entity: string, narrow?: Narrow): Promise<KartaRecord[]>;
  get(entity: string, id: Id): Promise<KartaRecord | null>;

  // optional indexable fast-path (later optimization; default impl may ignore)
  byIndex?(entity: string, field: string, value: Value): Promise<KartaRecord[]>;

  // writes
  insert(entity: string, data: Partial<KartaRecord>): Promise<KartaRecord>;
  update(entity: string, id: Id, patch: Partial<KartaRecord>): Promise<KartaRecord>;
  delete(entity: string, id: Id): Promise<void>;
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
  getBlob(r: MediaRef): Promise<Blob | null>;
  kvGet(k: string): Promise<string | null>;
  kvSet(k: string, v: string): Promise<void>;
  kvDelete(k: string): Promise<void>;
  /** Optional key enumeration (backs `ctx.storage.keys`). Default impls may omit it. */
  kvKeys?(prefix?: string): Promise<string[]>;
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
  at: Date;
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
   * so it cannot be forged (the same guarantee as `KartaRecord.createdBy`, KA-18).
   */
  by: string;
  at: Date;
}
