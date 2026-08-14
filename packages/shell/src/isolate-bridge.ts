// Bridge to the untrusted (QuickJS-WASM) runner. The isolate runner lives in @karta/host; the
// shell supplies the QuickJS async-context factory + the app's Store. Loaded lazily so the
// trusted path (`pnpm dev`) never pulls in the WASM engine.

import type { CreateHostOptions } from "@karta/host";
import type { QuickJSAsyncContextLike } from "@karta/host/isolate";
import type { Store } from "@karta/store";

export type LoadIsolated = NonNullable<CreateHostOptions["loadIsolated"]>;

/**
 * Build the untrusted loader for a given app Store. Used by `pnpm dev:sandbox`, and by
 * verification (verify-candidate.ts), which passes its own, larger budget: `dev:sandbox`'s
 * defaults (1000 ms / 64 MB, from createIsolateLoader) suit an interactive render, but a
 * candidate replay runs a handful of queries back to back and would false-fail under that.
 */
export async function createSandboxLoader(
  store: Store,
  opts?: { timeoutMs?: number; memoryLimitBytes?: number },
): Promise<LoadIsolated> {
  const [{ createIsolateLoader }, quickjs] = await Promise.all([
    import("@karta/host/isolate"),
    import("quickjs-emscripten"),
  ]);
  return createIsolateLoader({
    store,
    newContext: () => quickjs.newAsyncContext() as unknown as Promise<QuickJSAsyncContextLike>,
    ...opts,
  });
}
