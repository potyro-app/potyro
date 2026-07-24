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
  getBlob(r: MediaRef): Promise<Blob | null>;
  kvGet(k: string): Promise<string | null>;
  kvSet(k: string, v: string): Promise<void>;
  kvDelete(k: string): Promise<void>;
  /** Optional key enumeration (backs `ctx.storage.keys`). Default impls may omit it. */
  kvKeys?(prefix?: string): Promise<string[]>;
  storedSchemaVersion(): Promise<number>;
  runMigrations(plan: MigrationPlan): Promise<void>;
}
