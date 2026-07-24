// Bridge to the untrusted (QuickJS-WASM) runner. The isolate runner lives in @karta/host; the
// shell supplies the QuickJS async-context factory + the app's Store. Loaded lazily so the
// trusted path (`pnpm dev`) never pulls in the WASM engine.

import type { CreateHostOptions } from "@karta/host";
import type { QuickJSAsyncContextLike } from "@karta/host/isolate";
import type { Store } from "@karta/store";

export type LoadIsolated = NonNullable<CreateHostOptions["loadIsolated"]>;

/** Build the untrusted loader for a given app Store. Used by `pnpm dev:sandbox`. */
export async function createSandboxLoader(store: Store): Promise<LoadIsolated> {
  const [{ createIsolateLoader }, quickjs] = await Promise.all([
    import("@karta/host/isolate"),
    import("quickjs-emscripten"),
  ]);
  return createIsolateLoader({
    store,
    newContext: () => quickjs.newAsyncContext() as unknown as Promise<QuickJSAsyncContextLike>,
  });
}
