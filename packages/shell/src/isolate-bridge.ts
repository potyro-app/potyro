// Bridge to the untrusted runners. Both live in @potyro/host; the shell supplies what each needs —
// the realm's worker runtime and the page to put its iframe in, or the QuickJS async-context factory
// and the app's Store. Loaded lazily so the trusted path (`pnpm dev`) pulls in neither.
//
// `createSharedAppLoader` is how a shared app runs, and how the Add-an-app card tries one (#271): in
// the browser realm (#272), or QuickJS where the flag says so (sandbox-runner.ts). `createSandboxLoader`
// is QuickJS itself, which verification and the Studio still use until they move (docs/22 §8 phase 2).

import type { CreateHostOptions } from "@potyro/host";
import type { QuickJSAsyncContextLike } from "@potyro/host/isolate";
import type { Store } from "@potyro/store";
import { sandboxRunner } from "./sandbox-runner.js";

export type LoadIsolated = NonNullable<CreateHostOptions["loadIsolated"]>;

export interface SandboxOptions {
  timeoutMs?: number;
  /** QuickJS only. A Worker has no per-realm memory cap (docs/22 §6.1, §7). */
  memoryLimitBytes?: number;
  loadTimeoutMs?: number;
}

/**
 * Build the QuickJS loader for a given app Store. Used by verification (verify-candidate.ts), which
 * passes its own explicit budgets, by the Studio, and as the shared-app fallback.
 *
 * `createIsolateLoader`'s defaults are two separate numbers: 5000 ms to load the module (parse +
 * eval the bundle + install the harness — DEFAULT_LOAD_TIMEOUT in isolate-host.ts) and 1000 ms per
 * `invoke()` call, i.e. each computed/action/filter call the app makes afterward (DEFAULT_TIMEOUT).
 * Both default to 64 MB of memory. An interactive render takes those defaults; a candidate replay
 * runs a handful of queries back to back and passes its own `timeoutMs` / `loadTimeoutMs` so a
 * slow-but-correct app isn't false-failed by the interactive budget.
 */
export async function createSandboxLoader(store: Store, opts?: SandboxOptions): Promise<LoadIsolated> {
  const [{ createIsolateLoader }, quickjs] = await Promise.all([
    import("@potyro/host/isolate"),
    import("quickjs-emscripten"),
  ]);
  return createIsolateLoader({
    store,
    newContext: () => quickjs.newAsyncContext() as unknown as Promise<QuickJSAsyncContextLike>,
    ...opts,
  });
}

/** The loader a shared app runs with: the browser realm, or QuickJS behind the flag. */
export async function createSharedAppLoader(store: Store, opts?: SandboxOptions): Promise<LoadIsolated> {
  if (sandboxRunner() === "quickjs") return createSandboxLoader(store, opts);
  const { createRealmSandboxLoader } = await import("./realm-bridge.js");
  return createRealmSandboxLoader(opts);
}
