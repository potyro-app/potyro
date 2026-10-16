// The browser realm, as the shell builds it (#272, docs/22): the host's realm runner, the worker
// runtime the Vite plugin bundles (`virtual:potyro-realm-worker`, packages/host/realm-build.mjs), and
// this page to put the sandboxed iframes in. Its own module, imported only when a realm is wanted, so
// nothing that never runs a shared app (the Node tests among them) has to resolve the virtual module.
//
// Since #267 the realm also draws the app's custom views, each in a sandboxed frame of its own: the
// view bundle is the app's source again, React resolved to the frame's (`bundleViewSource`), built
// only when the first of its views mounts; the frame runtime is `virtual:potyro-realm-view`, loaded
// then too.

import { createRealmLoader, frameSpawner, ViewGuard } from "@potyro/host/realm";
export { RealmStartError } from "@potyro/host/realm";
import workerSource from "virtual:potyro-realm-worker";
import type { LoadIsolated, SandboxOptions } from "./isolate-bridge.js";
import type { ModuleSource } from "./package-modules.js";

/** What a sealed app's custom views need: its source again, and what the shell calls it. */
export interface SealedViewSource {
  /** The app's source (the same text its logic bundle was made from). */
  source: string;
  /** Its libraries and own modules, as its logic bundle had them. */
  modules?: ModuleSource;
  /** The shell's id for the app: the crash-loop guard keys on it. */
  appKey: string;
  /** The app's name, for the frame's accessible name. */
  name: string;
}

let guard: ViewGuard | null = null;

/** This page's crash-loop guard for sealed views, over localStorage (host/src/realm/view-guard.ts). */
export function sealedViewGuard(): ViewGuard {
  guard ??= new ViewGuard();
  return guard;
}

let viewRuntime: Promise<string> | null = null;
const loadViewRuntime = (): Promise<string> => (viewRuntime ??= import("virtual:potyro-realm-view").then((m) => m.default));

export function createRealmSandboxLoader(opts?: SandboxOptions, views?: SealedViewSource): LoadIsolated {
  return createRealmLoader({
    spawn: frameSpawner(),
    workerSource,
    timeoutMs: opts?.timeoutMs,
    loadTimeoutMs: opts?.loadTimeoutMs,
    // What was waiting is rejected with the reason, which the views and the toasts already show; the
    // next call starts the app afresh. A "this app keeps stopping" screen is phase 2 (docs/22 §8).
    onKill: (reason) => console.warn(`[potyro] a shared app was stopped: ${reason}`),
    views: views && {
      appKey: views.appKey,
      guard: sealedViewGuard(),
      code: async () => (await import("./app-bundler.js")).bundleViewSource(views.source, views.modules),
      runtimeSource: loadViewRuntime,
      title: (pageRef) => `${views.name}: ${pageRef.split("#")[0]}`,
    },
  });
}
