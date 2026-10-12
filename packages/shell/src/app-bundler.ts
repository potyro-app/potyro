// Runtime app bundler: turn a `.app.ts` source string (an AI-generated app, or an imported shared
// bundle's logic) into the self-contained IIFE the QuickJS isolate expects — the same shape the
// build-time sandbox plugin produces, but on demand in the browser. `potyro`/`react` resolve to the
// isolate stubs so Zod and React never enter the untrusted bundle. The generated/imported code then
// runs *untrusted in the isolate*, which is exactly what makes running unknown app logic safe.
//
// Anything else the source imports — a library by URL (#266), or one of the package's own modules
// (#258) — comes from the app's file space through `package-modules.ts`, checked against the lock.
// Both bundles, isolate and trusted, use that same plugin; neither ever fetches.
//
// The core is env-agnostic (esbuild + stub sources are injected), so it's testable in Node with the
// native esbuild; `createAppBundler` wires esbuild-wasm + the inlined stubs for the browser.
import { APP_CODE_MARK, hasLibraries, packageModulesPlugin, unwrapBuildError, wrapForIsolate, type ModuleSource } from "./package-modules.js";

const FOOTER = "globalThis.__potyroApp = (__sandbox && __sandbox.default) ? __sandbox.default : __sandbox;";

// Minimal structural views of the esbuild surface we use — satisfied by both `esbuild` and
// `esbuild-wasm`, so this module never depends on a concrete esbuild package.
type Maybe<T> = T | Promise<T>;
interface ResolveArgs {
  path: string;
  importer: string;
  namespace: string;
}
interface LoadResult {
  contents: string;
  loader: string;
}
interface PluginBuild {
  onResolve(opts: { filter: RegExp; namespace?: string }, cb: (a: ResolveArgs) => Maybe<{ path: string; namespace: string } | undefined>): void;
  onLoad(opts: { filter: RegExp; namespace?: string }, cb: (a: { path: string; namespace: string }) => Maybe<LoadResult>): void;
}
export interface EsbuildPlugin {
  name: string;
  setup(build: PluginBuild): void;
}
export interface EsbuildLike {
  build(options: {
    stdin: { contents: string; loader: string; sourcefile?: string };
    /** "automatic" uses react/jsx-runtime (resolved by the stub plugins) instead of React.createElement. */
    jsx?: "automatic" | "transform" | "preserve";
    bundle: boolean;
    write: boolean;
    format: string;
    globalName?: string;
    platform?: string;
    target?: string;
    logLevel?: string;
    footer?: { js?: string };
    plugins?: EsbuildPlugin[];
  }): Promise<{ outputFiles: Array<{ text: string }>; warnings?: Array<{ text: string }> }>;
}

export interface IsolateStubs {
  potyro: string;
  react: string;
}

export interface BundleOptions {
  /** Inspect only: libraries not fetched yet stand in as inert values (see `package-modules.ts`). */
  standIns?: boolean;
}

/** esbuild, with the plugin's own sentence surfacing as the error rather than esbuild's framing. */
async function run(esbuild: EsbuildLike, options: Parameters<EsbuildLike["build"]>[0]): Promise<string> {
  try {
    const result = await esbuild.build(options);
    return result.outputFiles[0]!.text;
  } catch (e) {
    throw unwrapBuildError(e);
  }
}

/**
 * Bundle `source` to the isolate IIFE, resolving `potyro`/`react` to the provided stub sources and
 * everything else from `modules` — the app's package — when it has one.
 */
export async function bundleAppSource(source: string, esbuild: EsbuildLike, stubs: IsolateStubs, modules?: ModuleSource, opts: BundleOptions = {}): Promise<string> {
  const plugin: EsbuildPlugin = {
    name: "potyro-isolate-stubs",
    setup(build) {
      build.onResolve({ filter: /^(potyro|karta|react)(\/jsx-(dev-)?runtime)?$/ }, (args) => ({ path: args.path, namespace: "potyro-stub" }));
      build.onLoad({ filter: /.*/, namespace: "potyro-stub" }, (args) => ({
        contents: args.path === "potyro" || args.path === "karta" ? stubs.potyro : stubs.react,
        loader: "ts",
      }));
    },
  };
  // Only an app with libraries pays for the loading marks — and keeps its line numbers either way.
  const marked = hasLibraries(modules);

  const code = await run(esbuild, {
    // `tsx`, not `ts`: a custom view is a React component, so app source may contain JSX. The `ts`
    // loader rejects it outright, which left generated apps no way to express UI at all — they
    // invented `ctx.ui.stack()`-style frameworks instead. `react/jsx-runtime` already resolves above.
    stdin: { contents: marked ? APP_CODE_MARK + source : source, loader: "tsx", sourcefile: "gen.app.tsx" },
    jsx: "automatic",
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__sandbox",
    platform: "browser",
    target: "es2020",
    logLevel: "silent",
    footer: { js: FOOTER },
    plugins: [plugin, packageModulesPlugin(modules, { markLibraries: marked, standIns: opts.standIns })],
  });
  return marked ? wrapForIsolate(code) : code;
}

let esbuildReady: Promise<EsbuildLike> | null = null;

/** Lazily load + initialise esbuild-wasm once; shared by the isolate and trusted bundlers. */
export async function getEsbuild(): Promise<EsbuildLike> {
  if (!esbuildReady) {
    esbuildReady = (async () => {
      const esbuild = await import("esbuild-wasm");
      await esbuild.initialize({ wasmURL: new URL("esbuild-wasm/esbuild.wasm", import.meta.url).href });
      return esbuild as unknown as EsbuildLike;
    })();
  }
  return esbuildReady;
}

/** Bundles a source for the isolate; `modules` is the app's package, when it has one. */
export type AppBundler = (source: string, modules?: ModuleSource, opts?: BundleOptions) => Promise<string>;

/**
 * Browser factory: inlines the isolate stubs and returns a `bundle(source)` closure producing the
 * untrusted-isolate IIFE. The wasm asset is resolved locally (offline-first) via Vite.
 */
export async function createAppBundler(): Promise<AppBundler> {
  const esbuild = await getEsbuild();
  const [potyro, react] = await Promise.all([
    import("./isolate-stubs/potyro.ts?raw"),
    import("./isolate-stubs/react.ts?raw"),
  ]);
  return (source, modules, opts) => bundleAppSource(source, esbuild, { potyro: potyro.default, react: react.default }, modules, opts);
}

/** `bundleTrustedModule`'s core, with esbuild injected (tests run it on the native one). */
export async function bundleTrustedWith(source: string, esbuild: EsbuildLike, modules?: ModuleSource): Promise<string> {
  const real = (name: string) => `module.exports = globalThis.${name};`;
  const plugin: EsbuildPlugin = {
    name: "potyro-real-modules",
    setup(build) {
      build.onResolve({ filter: /^(potyro|karta|react)(\/jsx-(dev-)?runtime)?$/ }, (args) => ({ path: args.path, namespace: "potyro-real" }));
      build.onLoad({ filter: /.*/, namespace: "potyro-real" }, (args) => ({
        contents: args.path === "potyro" || args.path === "karta" ? real("__potyroReal") : args.path.startsWith("react/jsx") ? real("__reactJsxReal") : real("__reactReal"),
        loader: "js",
      }));
    },
  };
  return run(esbuild, {
    stdin: { contents: source, loader: "tsx", sourcefile: "app.tsx" }, // see bundleAppSource
    jsx: "automatic",
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    logLevel: "silent",
    plugins: [plugin, packageModulesPlugin(modules)],
  });
}

/**
 * Bundle a `.app.ts` source to a self-contained ES module for TRUSTED (direct) execution. Unlike the
 * isolate bundle, `potyro`/`react` resolve to the SHELL's real modules (read from globals at eval
 * time), so the real `defineApp` runs — validating the app and yielding live functions + a branded
 * PotyroApp. Used only after the user promotes an app to trusted (see trusted-loader).
 */
export async function bundleTrustedModule(source: string, modules?: ModuleSource): Promise<string> {
  return bundleTrustedWith(source, await getEsbuild(), modules);
}
