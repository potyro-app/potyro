// Score a generated `.app.ts` source across three gates that mirror what "a usable app" means:
//   compiles  — esbuild bundles it (syntax + imports resolve; `potyro` is bundled in)
//   validates — importing the module runs defineApp() (Zod validation) and yields a PotyroApp
//   renders   — the first page's query runs through the real runtime without throwing
// Deterministic and offline; no network. This is the measurement KA-05/KA-07 report against.

import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime } from "@potyro/runtime";
import { MemoryStore } from "@potyro/store";

export interface ScoreResult {
  compiles: boolean;
  validates: boolean;
  renders: boolean;
  errors: string[];
}

// Package root — resolves the `potyro` import when bundling generated sources.
const RESOLVE_DIR = fileURLToPath(new URL("..", import.meta.url));

const UI: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const NAV: NavBridge = { navigate: () => {} };

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface LoadedPotyroApp {
  id: string;
  pages: { id: string }[];
  __potyroApp?: boolean;
}

/**
 * `resolveDir` is where a relative import in `source` is resolved from. The default (RESOLVE_DIR)
 * serves generated apps, which import only `potyro`. The examples under examples/ also import their
 * own custom views and helpers (`./views/CookAlong`), so an eval that feeds THOSE through here has to
 * say where they live or the bundle fails before the app is ever judged.
 */
async function bundle(source: string, resolveDir: string = RESOLVE_DIR): Promise<string> {
  const res = await build({
    // `tsx` + automatic runtime: custom views are React components, so app source may contain JSX.
    // Must match the shell's bundler (packages/shell/src/app-bundler.ts) or the eval scores a
    // different language than the product runs.
    stdin: { contents: source, resolveDir, loader: "tsx", sourcefile: "gen.app.tsx" },
    jsx: "automatic",
    bundle: true,
    // Apps generated before the rename import the codename; the shell resolves both, so must this.
    alias: { karta: "potyro" },
    write: false,
    // CommonJS, evaluated as a function (`evaluateModule`) rather than imported: an imported module
    // is never released, and every candidate carries its own copy of potyro (#262 — the paid eval
    // died of it). A function's result is garbage the moment nothing refers to the app.
    format: "cjs",
    platform: "node",
    target: "es2020",
    logLevel: "silent",
    // React must stay EXTERNAL so the app shares the harness's single instance. Bundling it gives
    // the app a second copy whose hook dispatcher is null under react-dom/server — every hook-using
    // custom view then fails for a reason that has nothing to do with the app. The shell resolves
    // react to its own real module for exactly the same reason (trusted-loader.ts).
    external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  });
  return res.outputFiles[0]!.text;
}

// React must be the harness's own instance (see `external` above); resolved from this package, as the
// imported module used to be, so it is the same module react-dom/server uses.
const requireHere = createRequire(new URL("../package.json", import.meta.url));

/** Run a bundled CommonJS module and return its exports. Nothing keeps it once its exports are gone. */
function evaluateModule(code: string): { default?: unknown } {
  const module: { exports: Record<string, unknown> } = { exports: {} };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the bundle IS the code under test
  new Function("require", "module", "exports", code)(requireHere, module, module.exports);
  return module.exports as { default?: unknown };
}

/** Bundle + run a generated source, returning the validated app. Throws on compile/validate
 *  failure — `scoreSource` reports those as gates; `smoke.ts` needs the app itself. */
export async function loadApp(source: string, resolveDir?: string): Promise<LoadedPotyroApp> {
  const mod = evaluateModule(await bundle(source, resolveDir));
  const candidate = mod.default as LoadedPotyroApp | undefined;
  if (!candidate?.__potyroApp) throw new Error("default export is not a validated PotyroApp");
  return candidate;
}

export async function scoreSource(source: string, resolveDir?: string): Promise<ScoreResult> {
  const errors: string[] = [];

  let bundled: string;
  try {
    bundled = await bundle(source, resolveDir);
  } catch (e) {
    errors.push(`compile: ${message(e)}`);
    return { compiles: false, validates: false, renders: false, errors };
  }

  let app: LoadedPotyroApp;
  try {
    const mod = evaluateModule(bundled); // defineApp() runs (validates) as the module runs
    const candidate = mod.default as LoadedPotyroApp | undefined;
    if (!candidate?.__potyroApp) throw new Error("default export is not a validated PotyroApp");
    app = candidate;
  } catch (e) {
    errors.push(`validate: ${message(e)}`);
    return { compiles: true, validates: false, renders: false, errors };
  }

  try {
    const store = new MemoryStore();
    await store.open(app.id);
    const host = createHost();
    const loaded = await host.load({ kind: "module", app: app as never });
    const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui: UI, nav: NAV });
    const firstPage = app.pages[0]?.id;
    if (!firstPage) throw new Error("app has no pages to render");
    await runtime.queryPage(firstPage);
    return { compiles: true, validates: true, renders: true, errors };
  } catch (e) {
    errors.push(`render: ${message(e)}`);
    return { compiles: true, validates: true, renders: false, errors };
  }
}
