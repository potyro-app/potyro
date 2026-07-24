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
  delete(entity: string, id: Id): Promise<void>;
  transaction<T>(fn: (tx: Ctx) => Promise<T>): Promise<T>;

  // ---- time (injected once per evaluation pass for determinism) ----
  now(): Date;
  today(): Date;

  // ---- runtime inputs (view filter params, custom-view args) ----
  params: Readonly<Record<string, unknown>>;

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
