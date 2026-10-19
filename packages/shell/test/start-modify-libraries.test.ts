// @vitest-environment happy-dom
//
// Changing an app that imports a library which needs a full web page (#266): the Studio checks and
// runs a candidate in the sealed box, where such a library cannot start — so before this fix the
// ORIGINAL app failed the check too, every candidate was rejected with "X needs a full web page", and
// the loop could never accept a change. The checks now stand the app's libraries in with inert
// values, the same for the original and the candidate; its own modules stay real.
//
// Everything is real here but the model (a scripted OpenRouter reply) and esbuild (Node's, in place
// of the browser's esbuild-wasm — see verify-candidate.test.ts): the loop, the check, the shape gate,
// the run in the QuickJS isolate and the regression gate.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import { lockEntryFor, moduleFileFor, srcKey, type AppLock } from "@potyro/store";
import type { AppShape } from "@potyro/runtime";
import type { EsbuildLike } from "../src/app-bundler.js";
import { memoryModules, type ModuleSource } from "../src/package-modules.js";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "../src/engines.js";

const mocks = vi.hoisted(() => ({ chatCreate: vi.fn() }));

vi.mock("@potyro/generator/backends", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@potyro/generator/backends")>();
  return {
    ...actual,
    createOpenRouterEngine: () => ({ chat: { completions: { create: mocks.chatCreate } } }),
    loadCorpus: async () => ({ files: [] }),
  };
});

vi.mock("../src/app-bundler.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/app-bundler.js")>();
  const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
  const stubs = {
    potyro: readFileSync(here("../src/isolate-stubs/potyro.ts"), "utf8"),
    react: readFileSync(here("../src/isolate-stubs/react.ts"), "utf8"),
  };
  const esbuild = { build } as unknown as EsbuildLike;
  return {
    ...actual,
    createAppBundler: async () => (source: string, modules?: ModuleSource, opts?: Parameters<typeof actual.bundleAppSource>[4]) =>
      actual.bundleAppSource(source, esbuild, stubs, modules, opts),
  };
});

const { startModify } = await import("../src/start-modify.js");
const { buildAndValidate } = await import("../src/validate-app.js");
const { verifyCandidate } = await import("../src/verify-candidate.js");

const enc = (s: string) => new TextEncoder().encode(s);
const NEEDS_WINDOW = "https://esm.sh/needs-window@1.0.0?bundle";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const NEEDS_WINDOW_CODE = readFileSync(resolve(ROOT, "e2e/fixtures/esm/needs-window.mjs"), "utf8");

/** An app space holding the given libraries and own modules, and the lock that vouches for them. */
async function space(libs: Record<string, string>, src: Record<string, string> = {}): Promise<ModuleSource> {
  const lock: AppLock = {};
  const files = new Map<string, Uint8Array>();
  for (const [url, text] of Object.entries(libs)) {
    const file = await moduleFileFor(enc(text));
    lock[url] = await lockEntryFor(file, enc(text));
    files.set(file, enc(text));
  }
  for (const [path, text] of Object.entries(src)) {
    const file = `.src/${path}`;
    lock[srcKey(path)] = await lockEntryFor(file, enc(text));
    files.set(file, enc(text));
  }
  return memoryModules(lock, files);
}

// A library that touches `window` as it loads, used at the top level, in a computed, and from a
// module of the app's own.
const APP = `import { defineApp } from "potyro";
import { width } from "${NEEDS_WINDOW}";
import { shelfName } from "./shelf.js";
const start = width + 1;
export default defineApp({
  id: "reader",
  name: "Reader",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } }, computed: { span: () => width.toFixed(0) } } },
  pages: [{ id: "all", title: shelfName("Books"), view: { type: "list", entity: "book", display: { primary: "title" } } }],
});`;
const SHELF = `export const shelfName = (s: string): string => s;\n`;

const RENAME = [
  "Renaming the page.",
  "```ts",
  "<<<<<<< SEARCH",
  '  pages: [{ id: "all", title: shelfName("Books"), view: { type: "list", entity: "book", display: { primary: "title" } } }],',
  "=======",
  '  pages: [{ id: "all", title: shelfName("My books"), view: { type: "list", entity: "book", display: { primary: "title" } } }],',
  ">>>>>>> REPLACE",
  "```",
].join("\n");

const BEFORE: AppShape = {
  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book" } }],
} as never;

const engine: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "test-key" };
type Sent = { messages: Array<{ role: string; content: string }> };

describe("changing an app whose library needs a full web page", () => {
  beforeEach(() => mocks.chatCreate.mockReset());

  it("the app itself still cannot start in the sealed box (what the fix works around, not changes)", async () => {
    const mods = await space({ [NEEDS_WINDOW]: NEEDS_WINDOW_CODE }, { "shelf.ts": SHELF });
    await expect(buildAndValidate(APP, mods)).rejects.toThrow(/needs-window 1\.0\.0 needs a full web page/);
  });

  it("accepts a trivial valid change on the first candidate, and the run says the library was stood in for", async () => {
    mocks.chatCreate.mockResolvedValue({ choices: [{ message: { content: RENAME } }] });
    const mods = await space({ [NEEDS_WINDOW]: NEEDS_WINDOW_CODE }, { "shelf.ts": SHELF });
    const steps: Array<{ kind: string; passed?: boolean; detail?: string }> = [];
    const out = await startModify({ source: APP, instruction: "call the page My books", before: BEFORE, engine, modules: mods, onStep: (s) => steps.push(s as never) });

    expect(out.kind === "failed" ? out.reason : out.kind).toBe("source");
    expect(out.kind === "source" && out.source).toContain('shelfName("My books")');
    expect(mocks.chatCreate).toHaveBeenCalledTimes(1);
    const accepted = steps.find((s) => s.kind === "candidate");
    expect(accepted?.passed).toBe(true);
    expect(accepted?.detail).toMatch(/needs-window 1\.0\.0/);
    expect(accepted?.detail).toMatch(/stand-in/);
  }, 60_000);

  it("a library the app does not have is still refused by the check", async () => {
    const mods = await space({ [NEEDS_WINDOW]: NEEDS_WINDOW_CODE }, { "shelf.ts": SHELF });
    const withNew = APP.replace('import { shelfName }', 'import extra from "https://esm.sh/not-installed@1.0.0?bundle";\nvoid extra;\nimport { shelfName }');
    mocks.chatCreate.mockResolvedValue({ choices: [{ message: { content: ["Adding a library.", "```ts", withNew, "```"].join("\n") } }] });
    const out = await startModify({ source: APP, instruction: "use another library", before: BEFORE, engine, modules: mods });
    expect(out.kind).toBe("failed");
    const sentBack = (mocks.chatCreate.mock.calls[1]?.[0] as Sent).messages.at(-1)!.content;
    expect(sentBack).toMatch(/not-installed 1\.0\.0, which is not part of this app yet/);
  }, 60_000);

  it("a computed that fails on the stand-in fails the same way in the original, so it does not hold the change back", async () => {
    const throwing = APP.replace("computed: { span: () => width.toFixed(0) }", 'computed: { span: () => { if (typeof width !== "number") throw new Error("width is not a number"); return width; } }');
    mocks.chatCreate.mockResolvedValue({ choices: [{ message: { content: RENAME } }] });
    const mods = await space({ [NEEDS_WINDOW]: NEEDS_WINDOW_CODE }, { "shelf.ts": SHELF });
    const steps: Array<{ kind: string; passed?: boolean; detail?: string }> = [];
    const out = await startModify({ source: throwing, instruction: "call the page My books", before: BEFORE, engine, modules: mods, onStep: (s) => steps.push(s as never) });
    expect(out.kind === "failed" ? out.reason : out.kind).toBe("source");
    expect(mocks.chatCreate).toHaveBeenCalledTimes(1);
    // It ran, and it threw: the original's run and the candidate's agree, so it is pre-existing.
    const run = await (await import("../src/run-candidate.js")).runCandidate(throwing, { modules: mods });
    expect(run.errors.join("\n")).toMatch(/width is not a number/);
  }, 60_000);

  it("apps/photo-garden, its own modules real and a p5 that needs a page: a renamed page is accepted on the first candidate", async () => {
    const dir = resolve(ROOT, "apps/photo-garden");
    const source = readFileSync(resolve(dir, "photo-garden.app.ts"), "utf8");
    const P5 = "https://esm.sh/p5@1.11.11?bundle";
    // Like p5 1.x: it reads the page as it loads.
    const p5 = "const doc = window.document;\nexport default class p5 { constructor(sketch) { sketch(this); } }\n";
    const mods = await space({ [P5]: p5 }, { "garden.ts": readFileSync(resolve(dir, "garden.ts"), "utf8"), "styles.ts": readFileSync(resolve(dir, "styles.ts"), "utf8") });
    await expect(buildAndValidate(source, mods)).rejects.toThrow(/p5 1\.11\.11 needs a full web page/);

    // One language in the source (docs/30): the rename is one string; its catalogs catch up on request.
    const line = '      title: "Gallery",';
    const renamed = '      title: "My garden",';
    expect(source).toContain(line);
    const reply = ["Renaming the gallery.", "```ts", "<<<<<<< SEARCH", line, "=======", renamed, ">>>>>>> REPLACE", "```"].join("\n");
    mocks.chatCreate.mockResolvedValue({ choices: [{ message: { content: reply } }] });
    const { loadDefinition } = await import("../src/validate-app.js");
    const { withLibrariesStoodIn } = await import("../src/package-modules.js");
    const before = await loadDefinition(source, withLibrariesStoodIn(mods));
    const steps: Array<{ kind: string; passed?: boolean; detail?: string }> = [];
    const out = await startModify({ source, instruction: "call the gallery My garden", before, engine, modules: mods, onStep: (s) => steps.push(s as never) });

    expect(out.kind === "failed" ? out.reason : out.kind).toBe("source");
    expect(out.kind === "source" && out.source).toContain('title: "My garden"');
    expect(mocks.chatCreate).toHaveBeenCalledTimes(1);
    expect(steps.find((s) => s.kind === "candidate")?.detail).toMatch(/p5 1\.11\.11 was not run here/);
  }, 60_000);

  it("a Fix agent's candidate is verified with the same stand-ins", async () => {
    const mods = await space({ [NEEDS_WINDOW]: NEEDS_WINDOW_CODE }, { "shelf.ts": SHELF });
    const { addStep, newCase } = await import("@potyro/runtime");
    const theCase = addStep(newCase("reader", "open the books"), { kind: "open", page: "all" });
    const verdict = await verifyCandidate({ source: APP.replace('"Books"', '"My books"'), theCase, original: BEFORE, modules: mods });
    expect(verdict.detail).not.toMatch(/needs a full web page/);
    expect(verdict.detail).toMatch(/NOTE: needs-window 1\.0\.0 was not run here/);
    expect(verdict.passed).toBe(true);
  }, 60_000);
});
