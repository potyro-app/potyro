// The wire protocol between the host (the shell's page) and a browser realm (#272, docs/22).
//
// One MessagePort per app, created by the HOST and handed through the sandboxed iframe into its
// Worker, where the app's logic runs. Everything that arrives on it is UNTRUSTED: the host checks the
// op name against `OPS` and the ctx id against the ones it issued, and then calls a method of the one
// `ctx` the runtime handed it — the ctx `buildCtx` made, with `mediateCaps`, the values gate and
// authorship inside. The worker runtime needs no integrity: app code shares its realm and can forge
// any message it could send, so it is given nothing worth forging.

import type { Resolved } from "potyro";
import type { RealmSocketEvent } from "./realm-sockets.js";

/** What app code is called for — the `LoadedApp` call surface, by name. */
export type CallKind =
  | "computed"
  | "action"
  | "filter"
  | "sort"
  | "binding"
  | "viewOption"
  | "pageOption"
  | "pageAction"
  | "summary"
  | "aggregate"
  | "fold"
  | "fieldDefault"
  | "reminderWhen";

/**
 * The plain-data half of a `ctx`: what the realm answers locally, without a round trip. `ctx.t` and
 * `ctx.format` are computed in the realm from these with the host's own `format.ts` — the realm HAS
 * `Intl`, so formatting is not a host service there.
 */
export interface CtxBase {
  ctxId: number;
  params: Record<string, unknown>;
  nowIso: string;
  me: { id: string; name: string };
  space?: { id: string; role: string; members: readonly { id: string; name?: string }[] };
  scope: Record<string, Resolved | undefined>;
  locale: string;
  formatLocale: string;
  language?: string;
  languages?: string[];
  capsAvailable: string[];
}

/**
 * The ops a realm may ask the host for. Anything else is refused before any ctx is touched. Each is
 * one method of `ctx`; see `route` in realm-host.ts. Growing `ctx` means one line here and one there.
 */
export const OPS = [
  "log",
  "query",
  "get",
  "create",
  "patch",
  "increment",
  "delete",
  "storage.get",
  "storage.set",
  "storage.delete",
  "storage.keys",
  "media.put",
  "media.url",
  "files.list",
  "files.stat",
  "files.text",
  "files.bytes",
  "files.url",
  "files.write",
  "files.rename",
  "files.remove",
  "files.import",
  "files.export",
  "ui.toast",
  "ui.confirm",
  "ui.prompt",
  "ui.pick",
  "ui.sheet",
  "ui.menu",
  "ui.form",
  "ui.progress",
  "ui.share",
  "navigate",
  "views.call",
  "caps.camera.capture",
  "caps.geo.current",
  "caps.haptics.vibrate",
  "caps.notifications.schedule",
  "caps.notifications.cancel",
  "caps.filesystem.pick",
  "caps.filesystem.save",
  "caps.network.fetch",
  // Live connections (docs/28): opened and held by the host; the realm has a number for each.
  "caps.network.socket",
  "caps.network.room",
  "caps.network.socket.send",
  "caps.network.socket.close",
  "caps.ai.extract",
  "caps.ai.ask",
] as const;
export type Op = (typeof OPS)[number];

/**
 * What a sealed custom view may ask for beyond `ctx` (phase 3, #267): the `Runtime` members a view
 * gets in `ViewProps.runtime` that are not ctx methods, and its `navigate` prop. Only a view's port
 * accepts them — the logic's does not. Each is one call on the runtime (or the prop) the shell handed
 * the view, the same object a trusted view holds, so, like `OPS`, nothing is re-implemented here.
 */
export const VIEW_OPS = ["runtime.watchQuery", "runtime.watchRecord", "runtime.unwatch", "runtime.runAction", "runtime.reconcileReminders", "view.navigate"] as const;
export type ViewOp = (typeof VIEW_OPS)[number];

// ---- the view frame (phase 3, #267): one sandboxed frame per mounted custom view ----

/** What the host hands a view frame, once, with its port. */
export interface ViewInit {
  t: "init";
  /** The view bundle: the app's source with React resolved to the frame's own (shell `bundleViewSource`). */
  code: string;
  /** `page` or `page#index` (a layout item). */
  pageRef: string;
  /** The view's ctx: the plain-data half, as for logic. Its id names the view's ctx and nothing else. */
  base: CtxBase;
  /** The app's definition in the language it is shown in, functions left out (JSON). */
  definition: string;
  language: { current?: string; default?: string; available: string[] };
  entity: string;
  param: Record<string, string>;
  /** CSS custom properties and a few computed values of where the view sits: the theme. */
  tokens: Record<string, string>;
}

// ---- host → view frame ----
export type HostToView =
  | ViewInit
  | { t: "ping"; n: number }
  | { t: "reply"; id: number; ok: boolean; value?: unknown; error?: string; code?: string }
  /** A watched query or record changed (`runtime.watchQuery` / `runtime.watchRecord`). */
  | { t: "watch"; wid: number; state: unknown }
  | { t: "tokens"; tokens: Record<string, string> }
  | { t: "sock"; ev: RealmSocketEvent }
  /** The host is about to remove the frame: unmount now, as a courtesy. */
  | { t: "stop" };

// ---- view frame → host ----
export type ViewToHost =
  /** The frame runtime runs and holds its port. */
  | { t: "up" }
  /** The view's `mount` (or first render) returned. */
  | { t: "mounted" }
  /** The view could not be mounted: its bundle threw, or the page has no custom view. */
  | { t: "failed"; error: string }
  | { t: "pong"; n: number }
  /** The view's document wants this many CSS pixels: it scrolls with the page, never inside itself. */
  | { t: "height"; px: number }
  | { t: "op"; id: number; ctxId: number; op: string; args: unknown[] }
  | { t: "sockack"; sid: number; n: number; bytes: number };

// ---- host → realm (on the app's port) ----
export type HostToRealm =
  | { t: "load"; code: string }
  | { t: "call"; id: number; kind: CallKind; args: unknown[]; base: CtxBase }
  /** `code`: an Error's own code (a socket's "denied", AI's "offline"…), so the app reads the same as a trusted one. */
  | { t: "reply"; id: number; ok: boolean; value?: unknown; error?: string; code?: string }
  /** Something happened on a live connection (docs/28). */
  | { t: "sock"; ev: RealmSocketEvent };

// ---- realm → host ----
export type RealmToHost =
  /** The worker runtime is running and holds the port: the realm itself works on this browser. */
  | { t: "up" }
  /** `error` with `start: true` is the realm failing to start (the frame could not make a Worker), not the app. */
  | { t: "ready"; definition?: string; error?: string; start?: boolean }
  | { t: "result"; id: number; ok: boolean; value?: unknown; error?: string }
  | { t: "op"; id: number; ctxId: number; op: string; args: unknown[] }
  /** `n` socket events (of `bytes`) were handed to the app's callbacks: the host may send more. */
  | { t: "sockack"; sid: number; n: number; bytes: number }
  | { t: "hb"; at: number };

/** What `caps.network.fetch` hands back into the realm, where it becomes a `Response` again. */
export interface FetchAnswer {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer;
}

/**
 * The CSP the sandboxed document is served with (and so its Worker, which inherits it). Nothing loads
 * from a URL; nothing connects.
 */
export const REALM_CSP = [
  "default-src 'none'",
  // Inline (the frame runtime) and blob: (the worker). `eval` and Wasm compilation are allowed on
  // purpose: the app's bundle is evaluated with it, they load nothing, and libraries use both — the
  // realm is the boundary, so there is nothing for these to widen.
  "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "worker-src blob:",
  "style-src 'unsafe-inline'",
  "img-src blob: data:",
  "font-src blob: data:",
  "media-src blob: data:",
  "connect-src 'none'",
  // CSP3's switch for WebRTC: connect-src does not cover ICE. No engine measured honours it
  // (docs/22 §3.2), which is why the frame runtime deletes the constructors as well.
  "webrtc 'block'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");
