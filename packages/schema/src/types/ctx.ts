// `ctx` — the host API surface (docs/04). This is *the* contract: every host power reaches
// app code only through `ctx`. Growing the system means growing this interface, never adding
// language features to a DSL (there is no DSL).
//
// `ctx` is constructed by the host (WP2). Its data/time/storage/ui/nav members are always
// present; its `caps` members are real+unmediated for trusted apps and mediated (or absent)
// for untrusted apps. App code sees the same interface either way — authority is what differs.

import type { Geo, Id, MediaRef, Resolved, Value } from "./core.js";

/** Query spec for `ctx.query` — JS predicates run in-memory over resolved rows. */
export interface QuerySpec {
  filter?: (r: Resolved) => boolean;
  sort?: (a: Resolved, b: Resolved) => number;
  limit?: number;
  offset?: number;
}

export interface CameraCapability {
  capture(opts?: { source?: "camera" | "library" }): Promise<Blob>;
}

export interface NotificationCapability {
  schedule(n: { id: string; at: Date; title: string; body?: string }): Promise<void>;
  cancel(id: string): Promise<void>;
  supportsExactScheduling: boolean;
}

export interface GeoCapability {
  current(): Promise<{ lat: number; lng: number }>;
}

export interface FileCapability {
  pick(): Promise<Blob>;
  save(name: string, data: Blob): Promise<void>;
}

export interface NetworkCapability {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/** Haptic feedback (docs/04). `pattern` follows the Web Vibration API. */
export interface HapticsCapability {
  vibrate(pattern?: number | number[]): Promise<void>;
}

/**
 * Native capabilities as app code sees them. Each member is optional: for an untrusted app it
 * is `undefined` unless the permission was declared *and* granted, and when present it may be
 * a mediated (scoped/rate-limited) wrapper. Trusted apps get all of them, unmediated.
 */
export interface Caps {
  camera?: CameraCapability;
  notifications?: NotificationCapability;
  geo?: GeoCapability;
  haptics?: HapticsCapability;
  filesystem?: FileCapability;
  network?: NetworkCapability;
}

/**
 * A person — you, or someone you share a space with (KA-18, ADR D2 amended).
 *
 * `id` is a cojson account id, stable for life. It is the *provable* identity: cojson signs every
 * transaction with the account that made it, which is what lets `createdBy` mean something in a
 * shared ledger. An id an app could write into a field would be forgeable by any member.
 */
export interface Person {
  id: Id;
  name: string;
}

/** What a member may do in a space (ADR D3). */
export type SpaceRole = "admin" | "writer" | "reader";

export interface Member extends Person {
  role: SpaceRole;
}

/**
 * The space this app's data lives in — present only when the app is synced (ADR D3).
 *
 * Absent for a solo app, which is the default. App code should read `ctx.space?.members ?? [ctx.me]`
 * rather than branching on whether sync exists: solo is "a space with one member", not a different
 * world.
 */
export interface Space {
  id: Id;
  members: readonly Member[];
  /** This device's own role in the space. */
  role: SpaceRole;
  /**
   * Mint an invite link. Host-mediated: the shell owns the UI and the admin check, because an app
   * that could silently mint invites could silently hand its data to someone.
   */
  invite(): Promise<string>;
}

/** App-scoped key/value storage, separate from entity records. */
export interface CtxStorage {
  get<T = unknown>(k: string): Promise<T | null>;
  set(k: string, v: unknown): Promise<void>;
  delete(k: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

/** UI affordances provided by the shell (docs/04). */
export interface CtxUi {
  toast(msg: string): void;
  confirm(msg: string): Promise<boolean>;
  prompt(msg: string, opts?: { default?: string }): Promise<string | null>;
  pick<T>(items: T[], opts?: { label?: (t: T) => string; multi?: boolean }): Promise<T | T[] | null>;
}

/** Media helpers (docs/04). */
export interface CtxMedia {
  put(bytes: Blob): Promise<MediaRef>;
  url(ref: MediaRef): Promise<string>;
}

/**
 * The complete host API surface handed to app functions. See docs/04 for the design rules:
 * members are stable, minimal, composable, async-by-default for anything touching
 * storage/caps, and `now()` is fixed per evaluation pass for deterministic computed values.
 */
export interface Ctx {
  // ---- data (all reads return Resolved records) ----
  query(entity: string, spec?: QuerySpec): Promise<Resolved[]>;
  get(entity: string, id: Id): Promise<Resolved | null>;
  create(entity: string, data: Record<string, unknown>): Promise<Resolved>;
  patch(entity: string, id: Id, data: Record<string, unknown>): Promise<Resolved>;
  /**
   * Add to a number — use this instead of `patch` for anything people count.
   *
   * `patch(id, { n: record.n + 1 })` reads on one device and writes on another: two people pressing
   * at the same moment both read 0, both write 1, and one press is gone with nothing to show for it.
   * Stating the CHANGE rather than the result lets the store add them up, because it is the only
   * party that can see both devices.
   *
   * Nothing else about the field changes — `record.n` is still one number, and a field written with
   * `patch` before is the starting point rather than something to migrate.
   */
  increment(entity: string, id: Id, field: string, delta: number): Promise<Resolved>;
  delete(entity: string, id: Id): Promise<void>;
  transaction<T>(fn: (tx: Ctx) => Promise<T>): Promise<T>;

  // ---- time (injected once per evaluation pass for determinism) ----
  now(): Date;
  today(): Date;

  // ---- identity (KA-18) ----
  /**
   * Who you are. **Always present**, including in a solo app that has never synced — so app code
   * never has to branch on whether identity or sync exists.
   */
  me: Person;
  /**
   * The space this app's data lives in, or `undefined` for a solo (local-only) app.
   *
   * Solo is a space with one member and no transport, so the honest reading of "everyone here" is
   * `ctx.space?.members ?? [ctx.me]`.
   */
  space?: Space;

  /**
   * Runtime inputs: the values of the current page's filter chips (`FilterChip.param`) and the
   * route params it was navigated to with (`navigate(pageId, params)` / `onOpen.param`).
   *
   * Scoped PER PAGE. A chip chosen on one page is not visible to another page's `filter`, so a
   * selection that should follow the user across pages cannot live here. (`ctx.storage` persists
   * across pages but is async, so a synchronous `filter` cannot read it either.)
   */
  params: Readonly<Record<string, unknown>>;

  /**
   * The app-wide selected record, when the app declares a top-level `scope` (see `ScopeDef`):
   * `ctx.scope.trip` is the current trip as a `Resolved` record, or `undefined` while none is
   * chosen. Synchronous and fixed per evaluation pass, so a `filter` can read it directly:
   * `(e, ctx) => e.trip?.id === ctx.scope.trip?.id`. Always present; `{}` for an app with no scope.
   * Per device — which trip *you* are looking at is not shared state.
   */
  scope: Readonly<Record<string, Resolved | undefined>>;

  // ---- app-scoped key/value storage ----
  storage: CtxStorage;

  // ---- native capabilities (may be denied/scoped for untrusted apps) ----
  caps: Caps;

  // ---- media helpers ----
  media: CtxMedia;

  // ---- UI affordances provided by the shell ----
  ui: CtxUi;

  // ---- navigation (in view/action contexts) ----
  navigate(pageId: string, params?: Record<string, string>): void;

  // ---- diagnostics ----
  log(...args: unknown[]): void;
}

/** Re-export so consumers can name the value type without reaching into core. */
export type { Value, Geo };
