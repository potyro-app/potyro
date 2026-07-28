// Score a generated `.app.ts` source across three gates that mirror what "a usable app" means:
//   compiles  — esbuild bundles it (syntax + imports resolve; `karta` is bundled in)
//   validates — importing the module runs defineApp() (Zod validation) and yields a KartaApp
//   renders   — the first page's query runs through the real runtime without throwing
// Deterministic and offline; no network. This is the measurement KA-05/KA-07 report against.

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { createRuntime } from "@karta/runtime";
import { MemoryStore } from "@karta/store";

export interface ScoreResult {
  compiles: boolean;
  validates: boolean;
  renders: boolean;
  errors: string[];
}

// Package root — resolves the `karta` import when bundling generated sources.
const RESOLVE_DIR = fileURLToPath(new URL("..", import.meta.url));

const UI: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const NAV: NavBridge = { navigate: () => {} };

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface LoadedKartaApp {
  id: string;
  pages: { id: string }[];
  __kartaApp?: boolean;
}

async function bundle(source: string): Promise<string> {
  const res = await build({
    // `tsx` + automatic runtime: custom views are React components, so app source may contain JSX.
    // Must match the shell's bundler (packages/shell/src/app-bundler.ts) or the eval scores a
    // different language than the product runs.
    stdin: { contents: source, resolveDir: RESOLVE_DIR, loader: "tsx", sourcefile: "gen.app.tsx" },
    jsx: "automatic",
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2020",
    logLevel: "silent",
  });
  return res.outputFiles[0]!.text;
}

/** Import a bundled ESM string via a temp file (native import; bypasses any test transform). */
async function importModule(code: string): Promise<{ default?: unknown }> {
  const dir = mkdtempSync(join(tmpdir(), "karta-eval-"));
  const file = join(dir, "gen.mjs");
  try {
    writeFileSync(file, code);
    return (await import(pathToFileURL(file).href)) as { default?: unknown };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Bundle + import a generated source, returning the validated app. Throws on compile/validate
 *  failure — `scoreSource` reports those as gates; `smoke.ts` needs the app itself. */
export async function loadApp(source: string): Promise<LoadedKartaApp> {
  const mod = await importModule(await bundle(source));
  const candidate = mod.default as LoadedKartaApp | undefined;
  if (!candidate?.__kartaApp) throw new Error("default export is not a validated KartaApp");
  return candidate;
}

export async function scoreSource(source: string): Promise<ScoreResult> {
  const errors: string[] = [];

  let bundled: string;
  try {
    bundled = await bundle(source);
  } catch (e) {
    errors.push(`compile: ${message(e)}`);
    return { compiles: false, validates: false, renders: false, errors };
  }

  let app: LoadedKartaApp;
  try {
    const mod = await importModule(bundled); // defineApp() runs (validates) at import time
    const candidate = mod.default as LoadedKartaApp | undefined;
    if (!candidate?.__kartaApp) throw new Error("default export is not a validated KartaApp");
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
