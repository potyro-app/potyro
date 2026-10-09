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
   * Who entered this record — the account id of whoever inserted it (KA-18).
   *
   * **Stamped by the host and never app-settable.** In a shared ledger, code that could write its
   * own `createdBy` could rewrite authorship, and untrusted code is exactly the code that would
   * want to. An app that wants an editable "who did this" uses an ordinary `member` field: who
   * *entered* an expense is genuinely not who *paid* for it (spike F5), and conflating the two
   * makes the unforgeable one useless.
   *
   * Optional because records written before this existed do not have it, and because a `Store` is
   * free of identity — the runtime stamps it.
   */
  createdBy?: Id;
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
