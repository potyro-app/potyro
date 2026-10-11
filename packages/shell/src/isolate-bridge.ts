// Bridge to the untrusted (QuickJS-WASM) runner. The isolate runner lives in @potyro/host; the
// shell supplies the QuickJS async-context factory + the app's Store. Loaded lazily so the
// trusted path (`pnpm dev`) never pulls in the WASM engine.

import type { CreateHostOptions } from "@potyro/host";
import type { QuickJSAsyncContextLike } from "@potyro/host/isolate";
import type { Store } from "@potyro/store";

export type LoadIsolated = NonNullable<CreateHostOptions["loadIsolated"]>;

/**
 * Build the untrusted loader for a given app Store. Used by `pnpm dev:sandbox`, and by
 * verification (verify-candidate.ts), which passes its own explicit budgets.
 *
 * `createIsolateLoader`'s defaults are two separate numbers: 5000 ms to load the module (parse +
 * eval the bundle + install the harness — DEFAULT_LOAD_TIMEOUT in isolate-host.ts) and 1000 ms per
 * `invoke()` call, i.e. each computed/action/filter call the app makes afterward (DEFAULT_TIMEOUT).
 * Both default to 64 MB of memory. `dev:sandbox` takes those defaults for an interactive render; a
 * candidate replay runs a handful of queries back to back and passes its own `timeoutMs` /
 * `loadTimeoutMs` so a slow-but-correct app isn't false-failed by the interactive budget.
 */
export async function createSandboxLoader(
  store: Store,
  opts?: { timeoutMs?: number; memoryLimitBytes?: number; loadTimeoutMs?: number },
): Promise<LoadIsolated> {
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
