// The browser realm, as the shell builds it (#272, docs/22): the host's realm runner, the worker
// runtime the Vite plugin bundles (`virtual:potyro-realm-worker`, packages/host/realm-build.mjs), and
// this page to put the sandboxed iframes in. Its own module, imported only when a realm is wanted, so
// nothing that never runs a shared app (the Node tests among them) has to resolve the virtual module.

import { createRealmLoader, frameSpawner } from "@potyro/host/realm";
export { RealmStartError } from "@potyro/host/realm";
import workerSource from "virtual:potyro-realm-worker";
import type { LoadIsolated, SandboxOptions } from "./isolate-bridge.js";

export function createRealmSandboxLoader(opts?: SandboxOptions): LoadIsolated {
  return createRealmLoader({
    spawn: frameSpawner(),
    workerSource,
    timeoutMs: opts?.timeoutMs,
    loadTimeoutMs: opts?.loadTimeoutMs,
    // What was waiting is rejected with the reason, which the views and the toasts already show; the
    // next call starts the app afresh. A "this app keeps stopping" screen is phase 2 (docs/22 §8).
    onKill: (reason) => console.warn(`[potyro] a shared app was stopped: ${reason}`),
  });
}
