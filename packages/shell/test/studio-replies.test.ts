// @vitest-environment happy-dom
//
// What the Studio says after a turn (#72, #73, #77). A person made a wine cellar app in four turns
// and read "Made “Wine Cellar”.", "Applied 1 edit.", "Applied 6 edits.", "Applied 3 edits.": the
// turn that added the button they asked for never said so, and a request done in part said nothing
// of the rest.
//
// Everything is real but the model (a scripted OpenRouter reply) and esbuild (Node's): the loop, the
// check, the shape gate, the run in the isolate — and the app loaded before and after, which is what
// the card is written from.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { AppShape } from "@potyro/runtime";
import type { EsbuildLike } from "../src/app-bundler.js";
import type { ModuleSource } from "../src/package-modules.js";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "../src/engines.js";
import { draftIsSaved } from "../src/studio-draft.js";

const mocks = vi.hoisted(() => ({ chatCreate: vi.fn(), created: undefined as unknown }));

vi.mock("@potyro/generator/backends", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@potyro/generator/backends")>();
  return { ...actual, createOpenRouterEngine: () => ({ chat: { completions: { create: mocks.chatCreate } } }), loadCorpus: async () => ({ files: [] }) };
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

// The app loaded as the shell loads a person's own — the real \`defineApp\` — bundled by Node's esbuild
// where the browser uses the wasm one.
vi.mock("../src/trusted-loader.js", async () => {
  const potyro = await import("potyro");
  const { bundleTrustedWith } = await vi.importActual<typeof import("../src/app-bundler.js")>("../src/app-bundler.js");
  return {
    loadTrustedModule: async (source: string, modules?: ModuleSource) => {
      (globalThis as unknown as Record<string, unknown>).__potyroReal = potyro;
      const esm = await bundleTrustedWith(source, { build } as unknown as EsbuildLike, modules);
      const mod = (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(esm).toString("base64")}`)) as { default: unknown };
      return mod.default;
    },
  };
});

// A new app: the loop's own work is create-loop.test.ts's; here, what the Studio says of what it made.
vi.mock("../src/start-create.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/start-create.js")>()),
  startCreate: async () => mocks.created,
}));

const { studioEngine } = await import("../src/studio-engine.js");

const PAGE = '  pages: [{ id: "bottles", title: "Bottles", view: { type: "list", entity: "bottle", display: { primary: "name" } } }],';
const GRAPE = '        grape: { type: "enum", options: ["merlot", "syrah"] },';
const APP = `import { defineApp } from "potyro";
export default defineApp({
  id: "wine",
  name: "Wine Cellar",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    bottle: {
      label: "Bottle",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
${GRAPE}
        country: { type: "enum", options: ["france", "italy"] },
      },
    },
  },
${PAGE}
});
`;
const WITH_SCAN = PAGE.replace('title: "Bottles",', 'title: "Bottles", actions: [{ label: "Scan label", run: async () => {} }],');

const BEFORE: AppShape = { entities: { bottle: {} }, pages: [{ id: "bottles", view: { type: "list", entity: "bottle" } }] };
const engine: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "test-key" };
type Sent = { messages: Array<{ role: string; content: string }> };
const reply = (content: string) => ({ choices: [{ message: { content } }] });
const edit = (prose: string, search: string, replace: string) => [prose, "```ts", "<<<<<<< SEARCH", search, "=======", replace, ">>>>>>> REPLACE", "```"].filter(Boolean).join("\n");
const modify = async (asked: string) => {
  const out = await studioEngine(engine, () => {}).modify(APP, BEFORE, asked);
  expect(out.kind === "failed" ? `${out.text} ${out.detail}` : out.kind).toBe("source");
  return out.kind === "source" ? out : null;
};

describe("a change's card says what is different and where to find it (#72)", () => {
  beforeEach(() => mocks.chatCreate.mockReset());

  it("edits sent without a word: the model is asked once, and with still nothing said the host says it from the app", async () => {
    mocks.chatCreate.mockResolvedValueOnce(reply(edit("", PAGE, WITH_SCAN))).mockResolvedValue(reply(""));
    const out = await modify("let me photograph a label to add a bottle");
    expect(out?.summary).toBe("New on the “Bottles” page: a “Scan label” button.");
    expect(out?.source).toContain("Scan label");
    // Asked once, with the change already accepted — never sent through the gate a second time.
    expect(mocks.chatCreate).toHaveBeenCalledTimes(2);
    expect((mocks.chatCreate.mock.calls[1]![0] as Sent).messages.at(-1)!.content).toMatch(/passed every check[\s\S]*where to find it[\s\S]*Not done:/);
  }, 60_000);

  it("the model's own words lead, and the host adds where to find it when they do not say", async () => {
    mocks.chatCreate.mockResolvedValue(reply(edit("You can now photograph a label and the bottle is filled in for you.", PAGE, WITH_SCAN)));
    const out = await modify("let me photograph a label to add a bottle");
    expect(out?.summary).toBe("You can now photograph a label and the bottle is filled in for you. New on the “Bottles” page: a “Scan label” button.");
    expect(mocks.chatCreate).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("words that already name the button and its page are not followed by the same thing again", async () => {
    mocks.chatCreate.mockResolvedValue(reply(edit("The Bottles page has a new **Scan label** button.", PAGE, WITH_SCAN)));
    expect((await modify("let me photograph a label"))?.summary).toBe("The Bottles page has a new Scan label button.");
  }, 60_000);

  it("a change nobody can see in the app's pages, buttons or fields, sent without a word, still says something", async () => {
    mocks.chatCreate.mockResolvedValueOnce(reply(edit("", '  version: "1.0.0",', '  version: "1.0.1",'))).mockResolvedValue(reply(""));
    expect((await modify("bump the version"))?.summary).toBe("Applied 1 edit.");
  }, 60_000);
});

describe("a request done in part says what was not done (#73)", () => {
  beforeEach(() => mocks.chatCreate.mockReset());
  const prose = ["Grape now takes any text, so a grape that is not in the list no longer fails.", "", "Not done:", "- Country still takes only the countries in its list, because a list cannot learn new values"].join("\n");

  it("the Not done lines ride beside what was done, and are not said twice", async () => {
    mocks.chatCreate.mockResolvedValue(reply(edit(prose, GRAPE, '        grape: { type: "text" },')));
    const out = await modify("do not fail on an unknown grape or country; add new values to the list");
    expect(out?.notDone).toEqual(["Country still takes only the countries in its list, because a list cannot learn new values"]);
    // Beside what was done, not inside it: the card lists the parts under the explanation (studio-thread-view.tsx).
    expect(out?.summary).toBe("Grape now takes any text, so a grape that is not in the list no longer fails. Changed in “Bottle”: the “Grape” field.");
  }, 60_000);

  it("left out of a reply with no words, it is asked for — and what comes back is on the card", async () => {
    mocks.chatCreate.mockResolvedValueOnce(reply(edit("", GRAPE, '        grape: { type: "text" },'))).mockResolvedValue(reply(prose));
    const out = await modify("do not fail on an unknown grape or country; add new values to the list");
    expect(out?.notDone).toHaveLength(1);
    expect(out?.notDone?.[0]).toMatch(/^Country still takes only/);
    expect(out?.summary).toMatch(/^Grape now takes any text/);
    expect(out?.summary).not.toMatch(/Not done/);
    expect(out?.source).toContain('grape: { type: "text" }');
  }, 60_000);
});

describe("a new app's card says what it is and the first thing to do in it (#72)", () => {
  it("its name, and where to start", async () => {
    mocks.created = { kind: "source", source: APP, warnings: [], draft: 1, candidate: 1 };
    const out = await studioEngine(engine, () => {}).create("a wine cellar");
    expect(out).toMatchObject({ kind: "source", summary: "Made “Wine Cellar”. To start, add your first entry on the “Bottles” page." });
  }, 60_000);

  it("with a button of its own, that is the first thing to do", async () => {
    mocks.created = { kind: "source", source: APP.replace(PAGE, WITH_SCAN), warnings: [], draft: 1, candidate: 1 };
    const out = await studioEngine(engine, () => {}).create("a wine cellar");
    expect(out).toMatchObject({ summary: "Made “Wine Cellar”. To start, tap “Scan label” on the “Bottles” page." });
  }, 60_000);
});

describe("Save in the code view with nothing changed records nothing (#77)", () => {
  it("the saved code, untouched, is not a version to keep", () => {
    expect(draftIsSaved(APP, APP, 0)).toBe(true);
  });

  it("an edit to the entry or to a module is; so is code that is not an app yet", () => {
    expect(draftIsSaved(`${APP}\n`, APP, 0)).toBe(false);
    expect(draftIsSaved(APP, APP, 1)).toBe(false);
    expect(draftIsSaved(APP, null, 0)).toBe(false);
  });
});
