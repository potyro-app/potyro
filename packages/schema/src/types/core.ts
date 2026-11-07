// Shared value types (docs/05 "Shared value types"). These are the primitives that flow
// across every seam: Store rows, Ctx reads/writes, Host marshalling, view bindings.

/** ULID string. */
export type Id = string;

/**
 * A JSON-ish serializable value. This is the closed set of things that can cross the
 * isolate boundary (marshalled in/out of QuickJS) and be persisted. `Date` is included
 * because the runtime hydrates datetime fields to `Date` before app logic sees them.
 */
export type Value =
  | string
  | number
  | boolean
  | Date
  | null
  | Value[]
  | { [k: string]: Value };

/**
 * A raw stored record as the Store returns it: identity + timestamps + opaque field data.
 * Fields are `unknown` here because at the storage seam nothing has been resolved or
 * narrowed yet — the runtime is responsible for hydration/resolution.
 *
 * Named `PotyroRecord` (not `Record`) to avoid clashing with the TS built-in `Record<K,V>`.
 */
export interface PotyroRecord {
  id: Id;
  createdAt: string;
  updatedAt: string;
  /**
   * Who entered this record: the account id (KA-18). Stamped by the host, never app-settable — in a
   * shared ledger, code that could write it could rewrite authorship. An editable "who" is a `member`
   * field: who *entered* an expense is not who *paid*. Absent on records written before it existed.
   */
  createdBy?: Id;
  /** Who last changed it, stamped the same way; absent where the store keeps no log. */
  updatedBy?: Id;
  [field: string]: unknown;
}

/**
 * The app-facing record handed to logic functions (`computed`/`action`/`filter`/`sort`/
 * `binding`/`reminder`). Relations are resolved one level deep and computed values are
 * accessible as properties.
 *
 * It is deliberately permissive (`any` member access). This is the "no ceiling" record from
 * docs/04: app logic is unrestricted TypeScript, so field/relation/computed access is not
 * statically constrained here. Static shape safety lives in the declarative field
 * definitions + Zod validation, *not* in this record type — that is the whole point of the
 * "structure is declarative and validated; logic is typed, not validated" split (CLAUDE.md).
 */
export type Resolved = {
  id: Id;
  createdAt: string;
  updatedAt: string;
  // The escape hatch: any field/relation/computed is reachable. Intentional, see above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [field: string]: any;
};

/** Where a file came from: with the app, written by its code, or imported by the person (#251). */
export type FileOrigin = "shipped" | "app" | "imported";

/** A file in the app's own folder (`ctx.files`). `id` never changes; `path` can (rename/move). */
export interface FileInfo {
  id: string;
  /** e.g. `notes/2026-10-11.md`, no leading slash */
  path: string;
  /** last segment of `path` */
  name: string;
  mime: string;
  size: number;
  hash: string;
  origin: FileOrigin;
  created: string;
  updated: string;
}

/** A `file` field's value. Build it from a `FileInfo`: `{ id, path, name, mime }`. */
export interface FileRef {
  id: string;
  path?: string;
  name?: string;
  mime?: string;
}

/** Reference to a stored blob (media field value). */
export interface MediaRef {
  key: string;
  mime: string;
  w?: number;
  h?: number;
}

/** A geographic point (geo field value). */
export interface Geo {
  lat: number;
  lng: number;
  label?: string;
}
