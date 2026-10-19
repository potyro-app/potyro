// The Host factory (docs/02 composition root). Dispatches to a runner by provenance:
//   - trusted module  → DirectHost (in-process)
//   - untrusted bundle → IsolateHost (QuickJS-WASM) — wired once the isolate lands
// `promote` flips an app to trusted so a subsequent load runs it direct.

import type { Ctx, PotyroApp } from "potyro";
import { attachCatalogs, isPotyroApp } from "potyro";
import { DirectLoadedApp } from "./direct-host.js";
import { buildCtx } from "./make-ctx.js";
import { loadMessageFormat } from "./format.js";
import type { AppSource, Host, LoadedApp, MakeCtxBase, Provenance } from "./types.js";

export interface CreateHostOptions {
  /**
   * Factory for the untrusted (isolate) runner. Injected so the isolate dependency
   * (QuickJS-WASM) stays optional and out of the trusted/test path. When absent, loading an
   * untrusted app throws a clear error.
   */
  loadIsolated?: (args: { code: string; provenance: Provenance; catalogs?: AppSource["catalogs"] }) => Promise<LoadedApp>;
}

export function createHost(options: CreateHostOptions = {}): Host {
  const promoted = new Set<string>();

  function provenanceFor(source: AppSource, declared: Provenance | undefined, defaultProv: Provenance): Provenance {
    const app = source.kind === "module" ? source.app : null;
    if (app && promoted.has(app.id)) return "trusted";
    return declared ?? defaultProv;
  }

  return {
    async load(source: AppSource): Promise<LoadedApp> {
      // The ICU formatter `ctx.t(words, vars)` needs is a lazy chunk; it is in place before any of
      // the app's functions can run, at either provenance (#302).
      await loadMessageFormat();
      if (source.kind === "module") {
        if (!isPotyroApp(source.app as PotyroApp)) {
          throw new Error("load: module source is not a PotyroApp (did you defineApp() it?)");
        }
        const provenance = provenanceFor(source, source.provenance, "trusted");
        if (provenance === "untrusted") {
          // A module we already hold in-process could run direct, but running an *untrusted*
          // module directly would grant it ambient authority — forbidden (CLAUDE.md #3).
          if (!options.loadIsolated) {
            throw new Error("load: untrusted module requires the isolate runner (loadIsolated not provided)");
          }
          // No bundle available for a live module; the shell must supply bundle/url for untrusted.
          throw new Error("load: run an untrusted app from a bundle/url source, not a live module");
        }
        const direct = new DirectLoadedApp(source.app, "trusted");
        // Its translations (docs/30): found by `localize()`, `word()` and `ctx.t` through the definition.
        attachCatalogs(direct.definition, source.catalogs);
        return direct;
      }

      // bundle / url → untrusted by default → isolate runner.
      const provenance = source.provenance ?? "untrusted";
      if (provenance === "trusted") {
        throw new Error("load: refusing to run a bundle/url source as trusted; import it as a module instead");
      }
      if (!options.loadIsolated) {
        throw new Error("load: untrusted app requires the isolate runner (loadIsolated not provided)");
      }
      if (source.kind === "url") {
        throw new Error("load: url sources must be fetched to a bundle by the shell first");
      }
      // The box gets them too, for `ctx.t` inside it; the definition read out of it gets them here.
      const sealed = await options.loadIsolated({ code: source.code, provenance, catalogs: source.catalogs });
      attachCatalogs(sealed.definition, source.catalogs);
      return sealed;
    },

    makeCtx(app: LoadedApp, base: MakeCtxBase): Ctx {
      return buildCtx(app, base);
    },

    async promote(appId: string): Promise<void> {
      promoted.add(appId);
    },
  };
}
