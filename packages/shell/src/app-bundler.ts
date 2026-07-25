// Runtime app bundler: turn a `.app.ts` source string (an AI-generated app, or an imported shared
// bundle's logic) into the self-contained IIFE the QuickJS isolate expects — the same shape the
// build-time sandbox plugin produces, but on demand in the browser. `karta`/`react` resolve to the
// isolate stubs so Zod and React never enter the untrusted bundle. The generated/imported code then
// runs *untrusted in the isolate*, which is exactly what makes running unknown app logic safe.
//
// The core is env-agnostic (esbuild + stub sources are injected), so it's testable in Node with the
// native esbuild; `createAppBundler` wires esbuild-wasm + the inlined stubs for the browser.

const FOOTER = "globalThis.__kartaApp = (__sandbox && __sandbox.default) ? __sandbox.default : __sandbox;";

// Minimal structural views of the esbuild surface we use — satisfied by both `esbuild` and
// `esbuild-wasm`, so this module never depends on a concrete esbuild package.
interface PluginBuild {
  onResolve(opts: { filter: RegExp }, cb: (a: { path: string }) => { path: string; namespace: string } | undefined): void;
  onLoad(opts: { filter: RegExp; namespace?: string }, cb: (a: { path: string }) => { contents: string; loader: string }): void;
}
export interface EsbuildPlugin {
  name: string;
  setup(build: PluginBuild): void;
}
export interface EsbuildLike {
  build(options: {
    stdin: { contents: string; loader: string; sourcefile?: string };
    bundle: boolean;
    write: boolean;
    format: string;
    globalName?: string;
    platform?: string;
    target?: string;
    logLevel?: string;
    footer?: { js?: string };
    plugins?: EsbuildPlugin[];
  }): Promise<{ outputFiles: Array<{ text: string }> }>;
}

export interface IsolateStubs {
  karta: string;
  react: string;
}

/** Bundle `source` to the isolate IIFE, resolving `karta`/`react` to the provided stub sources. */
export async function bundleAppSource(source: string, esbuild: EsbuildLike, stubs: IsolateStubs): Promise<string> {
  const plugin: EsbuildPlugin = {
    name: "karta-isolate-stubs",
    setup(build) {
      build.onResolve({ filter: /^(karta|react)(\/jsx-(dev-)?runtime)?$/ }, (args) => ({ path: args.path, namespace: "karta-stub" }));
      build.onLoad({ filter: /.*/, namespace: "karta-stub" }, (args) => ({
        contents: args.path === "karta" ? stubs.karta : stubs.react,
        loader: "ts",
      }));
    },
  };

  const result = await esbuild.build({
    stdin: { contents: source, loader: "ts", sourcefile: "gen.app.ts" },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__sandbox",
    platform: "browser",
    target: "es2020",
    logLevel: "silent",
    footer: { js: FOOTER },
    plugins: [plugin],
  });
  return result.outputFiles[0]!.text;
}

let esbuildReady: Promise<EsbuildLike> | null = null;

/**
 * Browser factory: lazily loads + initialises esbuild-wasm (once) and inlines the isolate stubs,
 * returning a `bundle(source)` closure. The wasm asset is resolved locally (offline-first) via Vite.
 */
export async function createAppBundler(): Promise<(source: string) => Promise<string>> {
  if (!esbuildReady) {
    esbuildReady = (async () => {
      const esbuild = await import("esbuild-wasm");
      await esbuild.initialize({ wasmURL: new URL("esbuild-wasm/esbuild.wasm", import.meta.url).href });
      return esbuild as unknown as EsbuildLike;
    })();
  }
  const esbuild = await esbuildReady;
  const [karta, react] = await Promise.all([
    import("./isolate-stubs/karta.ts?raw"),
    import("./isolate-stubs/react.ts?raw"),
  ]);
  return (source: string) => bundleAppSource(source, esbuild, { karta: karta.default, react: react.default });
}
