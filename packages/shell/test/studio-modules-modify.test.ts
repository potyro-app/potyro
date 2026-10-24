// @vitest-environment happy-dom
//
// The Studio changing an app made of several files (#448). Before, the model was shown the entry
// alone: a change whose code is in one of the app's own modules could not be made there. Now the
// model is shown every file, joined under marker lines; its SEARCH/REPLACE edit lands in the module,
// and what comes back is the entry plus the modules — checked as files, and kept as files.
//
// Everything is real but the model (a scripted OpenRouter reply) and esbuild (Node's): the loop, the
// check, the shape gate and the run in the isolate, as in start-modify-libraries.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { lockEntryFor, srcKey, type AppLock } from "@potyro/store";
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

const { studioEngine } = await import("../src/studio-engine.js");

const enc = (s: string) => new TextEncoder().encode(s);

async function ownModules(src: Record<string, string>): Promise<ModuleSource> {
  const lock: AppLock = {};
  const files = new Map<string, Uint8Array>();
  for (const [path, text] of Object.entries(src)) {
    const file = `.src/${path}`;
    lock[srcKey(path)] = await lockEntryFor(file, enc(text));
    files.set(file, enc(text));
  }
  return memoryModules(lock, files);
}

const APP = `import { defineApp } from "potyro";
import { shelfName } from "./shelf.ts";
export default defineApp({
  id: "reader",
  name: "Reader",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: shelfName("Books"), view: { type: "list", entity: "book", display: { primary: "title" } } }],
});
`;
const SHELF = 'export const shelfName = (s: string): string => s;\n';
const SHELF_STARRED = 'export const shelfName = (s: string): string => `★ ${s} ★`;\n';

const BEFORE: AppShape = {
  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book" } }],
} as never;

const engine: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "test-key" };
type Sent = { messages: Array<{ role: string; content: string }> };
const reply = (content: string) => ({ choices: [{ message: { content } }] });
const edit = (search: string, replace: string) =>
  ["Stars around every shelf's name.", "```ts", "<<<<<<< SEARCH", search, "=======", replace, ">>>>>>> REPLACE", "```"].join("\n");

describe("the Studio changing an app made of several files", () => {
  beforeEach(() => mocks.chatCreate.mockReset());

  it("shows the model every file, and an edit to a module comes back as that module", async () => {
    mocks.chatCreate.mockResolvedValue(reply(edit(SHELF.trimEnd(), SHELF_STARRED.trimEnd())));
    const out = await studioEngine(engine, () => {}, await ownModules({ "shelf.ts": SHELF })).modify(APP, BEFORE, "put stars around the shelf names");

    const opening = (mocks.chatCreate.mock.calls[0]![0] as Sent).messages.find((m) => m.role === "user")!.content;
    expect(opening).toContain("//// FILE: (the app)");
    expect(opening).toContain("//// FILE: shelf.ts");
    expect(opening).toContain(SHELF.trimEnd());
    expect(opening).toMatch(/This app is 2 files/);

    expect(out.kind === "failed" ? `${out.text} ${out.detail}` : out.kind).toBe("source");
    if (out.kind !== "source") return;
    expect(out.source).toBe(APP);
    expect(out.modules).toEqual({ "shelf.ts": SHELF_STARRED });
  }, 60_000);

  it("a change to the entry alone leaves the modules out of what comes back", async () => {
    mocks.chatCreate.mockResolvedValue(reply(edit('  pages: [{ id: "all", title: shelfName("Books"), view: { type: "list", entity: "book", display: { primary: "title" } } }],', '  pages: [{ id: "all", title: shelfName("My books"), view: { type: "list", entity: "book", display: { primary: "title" } } }],')));
    const out = await studioEngine(engine, () => {}, await ownModules({ "shelf.ts": SHELF })).modify(APP, BEFORE, "call it My books");
    expect(out.kind === "failed" ? `${out.text} ${out.detail}` : out.kind).toBe("source");
    if (out.kind !== "source") return;
    expect(out.source).toContain('shelfName("My books")');
    expect(out.source).not.toContain("//// FILE");
    expect(out.modules).toBeUndefined();
  }, 60_000);

  it("an edit that breaks a file's marker line is sent back with what to keep", async () => {
    mocks.chatCreate
      .mockResolvedValueOnce(reply(edit(`//// FILE: shelf.ts\n${SHELF.trimEnd()}`, SHELF_STARRED.trimEnd())))
      .mockResolvedValue(reply(edit(SHELF.trimEnd(), SHELF_STARRED.trimEnd())));
    const out = await studioEngine(engine, () => {}, await ownModules({ "shelf.ts": SHELF })).modify(APP, BEFORE, "put stars around the shelf names");
    const sentBack = (mocks.chatCreate.mock.calls[1]![0] as Sent).messages.at(-1)!.content;
    expect(sentBack).toMatch(/\/\/\/\/ FILE: ` line of shelf\.ts is gone|shelf\.ts is gone/);
    expect(out.kind === "source" && out.modules).toEqual({ "shelf.ts": SHELF_STARRED });
  }, 60_000);

  it("an app that is one file is shown as it always was", async () => {
    const single = APP.replace('import { shelfName } from "./shelf.ts";\n', "const shelfName = (s: string): string => s;\n");
    mocks.chatCreate.mockResolvedValue(reply(edit('  pages: [{ id: "all", title: shelfName("Books"), view: { type: "list", entity: "book", display: { primary: "title" } } }],', '  pages: [{ id: "all", title: shelfName("My books"), view: { type: "list", entity: "book", display: { primary: "title" } } }],')));
    const out = await studioEngine(engine, () => {}).modify(single, BEFORE, "call it My books");
    const opening = (mocks.chatCreate.mock.calls[0]![0] as Sent).messages.find((m) => m.role === "user")!.content;
    expect(opening).not.toContain("//// FILE");
    expect(opening).not.toMatch(/This app is \d+ files/);
    expect(out.kind === "failed" ? `${out.text} ${out.detail}` : out.kind).toBe("source");
    expect(out.kind === "source" ? out.modules : "not a source").toBeUndefined();
  }, 60_000);
});
