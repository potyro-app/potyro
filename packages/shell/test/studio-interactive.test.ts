// @vitest-environment happy-dom
//
// The Studio's session is interactive (#75). A request used to get a change or a failure; now the
// agent may ask with choices and the run WAITS for the answer, what it guessed is said, and a change
// that is not small is shown before it is saved.
//
// Everything is real but the model (a scripted OpenRouter reply) and esbuild (Node's): the loops, the
// check, the shape gate, the run in the isolate, and the app loaded before and after.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { defineApp, type AppDefinition } from "potyro";
import type { AppShape } from "@potyro/runtime";
import type { EsbuildLike } from "../src/app-bundler.js";
import type { ModuleSource } from "../src/package-modules.js";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "../src/engines.js";

const mocks = vi.hoisted(() => ({ chatCreate: vi.fn(), cli: vi.fn() }));

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

vi.mock("../src/generate-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/generate-client.js")>()),
  generateViaCli: mocks.cli,
}));

const { studioEngine } = await import("../src/studio-engine.js");
const { describedIn } = await import("../src/studio-summary.js");
const { loadTrustedModule } = await import("../src/trusted-loader.js");
const { PLAN_MAX_PARTS, goWith, partsTouched, planFor, planTriggers, refineInstruction } = await import("../src/studio-plan.js");
const { dropPaused, hasPaused, holdPaused, takePaused } = await import("../src/studio-paused.js");

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
      },
    },
  },
${PAGE}
});
`;
const PRICE = `${GRAPE}\n        price: { type: "number" },`;

const BEFORE: AppShape = { entities: { bottle: {} }, pages: [{ id: "bottles", view: { type: "list", entity: "bottle" } }] };
const engine: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "test-key" };
type Message = { role: string; content: string; tool_call_id?: string };
type Sent = { messages: Message[]; tool_choice?: string };
const sent = (n: number): Sent => mocks.chatCreate.mock.calls[n]![0] as Sent;
const reply = (content: string) => ({ choices: [{ message: { content } }] });
const call = (name: string, args: Record<string, unknown>, id: string) => ({ choices: [{ message: { content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] });
const edit = (prose: string, search: string, replace: string) => [prose, "```ts", "<<<<<<< SEARCH", search, "=======", replace, ">>>>>>> REPLACE", "```"].filter(Boolean).join("\n");
const CURRENCY = { question: "Which currency are the prices in?", options: ["Euros", "Dollars"] };

beforeEach(() => {
  mocks.chatCreate.mockReset();
  mocks.cli.mockReset();
});

describe("a question with choices pauses the run, and the answer goes back into it", () => {
  it("modify: the question comes with its choices and the run that waits; answering makes ONE more request, in the same conversation", async () => {
    mocks.chatCreate.mockResolvedValueOnce(call("lookup", { query: "NumberField" }, "t1")).mockResolvedValueOnce(call("ask_person", CURRENCY, "q1"));
    const asked = await studioEngine(engine, () => {}).modify(APP, BEFORE, "add a price to each bottle");
    expect(asked).toMatchObject({ kind: "question", text: CURRENCY.question, options: CURRENCY.options, paused: { pending: "q1", asked: 1, steps: 2 } });
    // The run holds nothing open while the person thinks: two requests were made, and no third.
    expect(mocks.chatCreate).toHaveBeenCalledTimes(2);
    if (asked.kind !== "question" || !asked.paused) throw new Error("no paused run");

    mocks.chatCreate.mockResolvedValueOnce(reply(edit("Each bottle has a price, in dollars.", GRAPE, PRICE)));
    const out = await studioEngine(engine, () => {}).modify(APP, BEFORE, "add a price to each bottle", undefined, undefined, { resume: { paused: asked.paused, answer: "Dollars" } });
    expect(out).toMatchObject({ kind: "source", summary: "Each bottle has a price, in dollars." });
    // Resumed, not restarted: one request more, carrying what was looked up before the question and
    // the answer as the result of the call that asked — and the app in it exactly once.
    expect(mocks.chatCreate).toHaveBeenCalledTimes(3);
    const messages = sent(2).messages;
    expect(messages.at(-1)).toEqual({ role: "tool", tool_call_id: "q1", content: "The person answered: Dollars" });
    expect(messages.some((m) => m.role === "tool" && m.tool_call_id === "t1" && /NumberField/.test(m.content))).toBe(true);
    expect(messages.filter((m) => m.role === "user" && m.content.includes('id: "wine"'))).toHaveLength(1);
  }, 60_000);

  it("create: the first draft's question keeps its choices and its conversation, and the answer makes the app there", async () => {
    mocks.chatCreate.mockResolvedValueOnce(reply("QUESTION: Wine you own, or wine you have tasted?\n- Wine I own\n- Wine I have tasted"));
    const asked = await studioEngine(engine, () => {}).create("something for wine");
    expect(asked).toMatchObject({ kind: "question", text: "Wine you own, or wine you have tasted?", options: ["Wine I own", "Wine I have tasted"], paused: { asked: 1, steps: 1 } });
    expect(mocks.chatCreate).toHaveBeenCalledTimes(1);
    if (asked.kind !== "question" || !asked.paused) throw new Error("no paused run");

    // The app, then the loop's one call for sample records.
    mocks.chatCreate.mockResolvedValueOnce(reply(["Assumed:", "- A bottle has one grape.", "```ts", APP, "```"].join("\n"))).mockResolvedValue(reply("{}"));
    const brief = "something for wine\n\nYou asked: Wine you own, or wine you have tasted?\nThe answer: Wine I own";
    const out = await studioEngine(engine, () => {}).create(brief, { resume: { paused: asked.paused, answer: "Wine I own" } });
    expect(out).toMatchObject({ kind: "source", assumed: ["A bottle has one grape."] });
    expect(out.kind === "source" && out.summary).toMatch(/^Made “Wine Cellar”\./);
    const messages = sent(1).messages;
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages.at(-1)!.content).toBe("The answer: Wine I own");
    expect(sent(1).tool_choice).toBe("none");
  }, 60_000);

  it("a fresh run is told how many questions the request has had: past two, the next is not put to the person", async () => {
    mocks.chatCreate.mockResolvedValueOnce(call("ask_person", { question: "Rounded?" }, "q3")).mockResolvedValueOnce(reply(edit("Each bottle has a price.\n\nAssumed:\n- Prices are not rounded.", GRAPE, PRICE)));
    const out = await studioEngine(engine, () => {}).modify(APP, BEFORE, "add a price", undefined, undefined, { asked: 2 });
    expect(out).toMatchObject({ kind: "source", assumed: ["Prices are not rounded."] });
    expect(sent(1).messages.at(-1)!.content).toMatch(/already asked 2 questions[\s\S]*Assumed:/);
  }, 60_000);

  it("an engine without tools asks with a marker: its choices are read, and no run waits — the answer starts the next turn", async () => {
    mocks.cli.mockResolvedValue("QUESTION: Wine you own, or wine you have tasted?\n- Wine I own\n- Wine I have tasted");
    const out = await studioEngine({ ...DEFAULT_ENGINE_CONFIG, engine: "cli" }, () => {}).create("something for wine");
    expect(out).toEqual({ kind: "question", text: "Wine you own, or wine you have tasted?", options: ["Wine I own", "Wine I have tasted"] });
  });
});

describe("what was guessed is on the outcome, not in the card's words", () => {
  it("a change's Assumed list rides beside the summary, which does not repeat it", async () => {
    mocks.chatCreate.mockResolvedValue(reply(edit("Each bottle has a price.\n\nAssumed:\n- Prices are in euros.\n- A bottle has one price.", GRAPE, PRICE)));
    const out = await studioEngine(engine, () => {}).modify(APP, BEFORE, "add a price");
    expect(out).toMatchObject({ kind: "source", assumed: ["Prices are in euros.", "A bottle has one price."] });
    expect(out.kind === "source" && out.summary).toBe("Each bottle has a price.");
  }, 60_000);

  it("a change that guessed nothing has no list", async () => {
    mocks.chatCreate.mockResolvedValue(reply(edit("Each bottle has a price.", GRAPE, PRICE)));
    const out = await studioEngine(engine, () => {}).modify(APP, BEFORE, "add a price");
    expect(out.kind === "source" && "assumed" in out).toBe(false);
  }, 60_000);
});

describe("runs that stopped to ask are held by their conversation", () => {
  const run = { transcript: [], asked: 1, steps: 1 };

  it("the answer takes the run out; a second answer finds none", () => {
    holdPaused("chat-1", run, "APP");
    expect(hasPaused("chat-1")).toBe(true);
    expect(takePaused("chat-1", "APP")).toBe(run);
    expect(takePaused("chat-1", "APP")).toBeNull();
  });

  it("an app changed since the question (a hand edit, a rollback) does not go on from it", () => {
    holdPaused("chat-1", run, "APP");
    expect(takePaused("chat-1", "APP, edited")).toBeNull();
    expect(hasPaused("chat-1")).toBe(false);
  });

  it("another conversation's run is not this one's, and a dropped one is gone", () => {
    holdPaused("chat-1", run, null);
    expect(takePaused("chat-2", null)).toBeNull();
    dropPaused("chat-1");
    expect(takePaused("chat-1", null)).toBeNull();
  });
});

// ---- The plan gate ---------------------------------------------------------------------------------

type Fields = Record<string, { type: string; label?: string; options?: string[] }>;
const bottleFields: Fields = { name: { type: "text" }, grape: { type: "enum", options: ["merlot", "syrah"] } };
const wine = (over: { fields?: Fields; pages?: AppDefinition["pages"]; entities?: Record<string, unknown>; migrations?: AppDefinition["migrations"] } = {}) =>
  defineApp({
    id: "wine",
    name: "Wine Cellar",
    version: "1.0.0",
    schemaVersion: 1,
    entities: { bottle: { label: "Bottle", displayField: "name", fields: over.fields ?? bottleFields }, ...over.entities },
    pages: over.pages ?? [{ id: "bottles", title: "Bottles", view: { type: "list", entity: "bottle", display: { primary: "name" } } }],
    ...(over.migrations ? { migrations: over.migrations } : {}),
  } as Parameters<typeof defineApp>[0]);
const described = (app: AppDefinition) => ({ ...describedIn(app, ["en"]), migrations: app.migrations });
const BOTTLES = [
  { id: "1", name: "Morgon", grape: "merlot" },
  { id: "2", name: "Crozes", grape: "syrah" },
  { id: "3", name: "House red", grape: "" },
];
const rows = (records: Record<string, unknown[]> = { bottle: BOTTLES }) => async (entity: string) => (records[entity] ?? []) as Array<Record<string, unknown>>;
const plan = (after: AppDefinition, records?: Record<string, unknown[]>, before: AppDefinition = wine()) => planFor(described(before), described(after), rows(records));

describe("a change is shown before it is saved only when it is not small", () => {
  it("adding a field, a button or a page is small: no plan, it is saved directly", async () => {
    expect(await plan(wine({ fields: { ...bottleFields, price: { type: "number" } } }))).toBeNull();
    expect(
      await plan(wine({ pages: [{ id: "bottles", title: "My bottles", view: { type: "list", entity: "bottle", display: { primary: "name" } } }, { id: "syrah", title: "Syrah", view: { type: "list", entity: "bottle", display: { primary: "name" } } }] })),
    ).toBeNull();
    // Nothing changed at all.
    expect(await plan(wine())).toBeNull();
  });

  it("a field removed while records hold something in it: the plan says how many lose it", async () => {
    const out = await plan(wine({ fields: { name: { type: "text" } } }));
    expect(out?.triggers).toEqual([{ kind: "field-removed", entity: "bottle", entityLabel: "Bottle", field: "grape", label: "Grape", records: 2 }]);
    // Two of the three bottles have a grape; the empty one loses nothing.
    expect(out?.consequences).toEqual(["2 records of “Bottle” will lose what is in “Grape”."]);
  });

  it("a field removed that no record holds anything in is small", async () => {
    expect(await plan(wine({ fields: { name: { type: "text" } } }), { bottle: [{ id: "1", name: "Morgon" }, { id: "2", name: "Crozes", grape: null }] })).toBeNull();
    expect(await plan(wine({ fields: { name: { type: "text" } } }), {})).toBeNull();
  });

  it("a field renamed with a migration is shown too, and says the records are kept", async () => {
    const renamed = wine({
      fields: { name: { type: "text" }, variety: { type: "enum", label: "Variety", options: ["merlot", "syrah"] } },
      migrations: [{ from: "1.0.0", to: "1.1.0", steps: [{ op: "renameField", entity: "bottle", from: "grape", to: "variety" }] }],
    });
    const out = await plan(renamed);
    expect(out?.triggers).toMatchObject([{ kind: "field-removed", field: "grape", records: 2, renamedTo: "Variety" }]);
    expect(out?.consequences).toEqual(["What 2 records of “Bottle” have in “Grape” is kept, under “Variety”."]);
  });

  it("a field that changes kind is shown, with what it means for the records that hold something", async () => {
    const out = await plan(wine({ fields: { name: { type: "text" }, grape: { type: "text" } } }));
    expect(out?.triggers).toEqual([{ kind: "field-kind", entity: "bottle", entityLabel: "Bottle", field: "grape", label: "Grape", from: "enum", to: "text", records: 2 }]);
    expect(out?.consequences).toEqual(["2 records of “Bottle” have something in “Grape”, which becomes a different kind of field: it may not read the same."]);
    // With no records it is still shown — the kind of a field is the shape of the data — and has no consequence to say.
    const empty = await plan(wine({ fields: { name: { type: "text" }, grape: { type: "text" } } }), {});
    expect(empty?.triggers).toHaveLength(1);
    expect(empty?.consequences).toEqual([]);
    // The same kind with other options is not a change of kind.
    expect(await plan(wine({ fields: { name: { type: "text" }, grape: { type: "enum", options: ["merlot", "syrah", "gamay"] } } }))).toBeNull();
  });

  it("a page removed is shown", async () => {
    const two = wine({ pages: [{ id: "bottles", title: "Bottles", view: { type: "list", entity: "bottle", display: { primary: "name" } } }, { id: "syrah", title: "Syrah", view: { type: "list", entity: "bottle", display: { primary: "name" } } }] });
    const out = await planFor(described(two), described(wine()), rows());
    expect(out?.triggers).toEqual([{ kind: "page-removed", page: "syrah" }]);
    expect(out?.consequences).toEqual([]);
  });

  it("a kind of record removed while it has records: the plan says they will be gone; with none, nothing is taken", async () => {
    const withTastings = wine({ entities: { tasting: { label: "Tasting", fields: { note: { type: "text" } } } } });
    const gone = await planFor(described(withTastings), described(wine()), rows({ tasting: [{ id: "t1", note: "plum" }] }));
    expect(gone?.triggers).toEqual([{ kind: "entity-removed", entity: "tasting", label: "Tasting", records: 1 }]);
    expect(gone?.consequences).toEqual(["1 record of “Tasting” will no longer be in the app."]);
    expect(await planFor(described(withTastings), described(wine()), rows({}))).toBeNull();
  });

  it(`more than ${PLAN_MAX_PARTS} pages and kinds of record touched at once is shown; ${PLAN_MAX_PARTS} is not`, async () => {
    const list = (id: string, entity: string) => ({ id, title: id, view: { type: "list", entity, display: { primary: "name" } } });
    const kind = (label: string) => ({ label, displayField: "name", fields: { name: { type: "text" } } });
    const bottles = { id: "bottles", title: "Bottles", view: { type: "list", entity: "bottle", display: { primary: "name" } } };
    // Two new kinds of record and a page for each: four parts.
    const four = wine({ entities: { cellar: kind("Cellar"), shop: kind("Shop") }, pages: [bottles, list("cellars", "cellar"), list("shops", "shop")] as AppDefinition["pages"] });
    expect(partsTouched(described(wine()), described(four))).toBe(PLAN_MAX_PARTS);
    expect(await plan(four)).toBeNull();
    // …and the bottle changed too: five.
    const five = wine({
      fields: { ...bottleFields, price: { type: "number" } },
      entities: { cellar: kind("Cellar"), shop: kind("Shop") },
      pages: [bottles, list("cellars", "cellar"), list("shops", "shop")] as AppDefinition["pages"],
    });
    expect((await plan(five))?.triggers).toEqual([{ kind: "many-parts", parts: 5 }]);
  });

  it("records that cannot be read hold nothing back: the triggers that need none still fire", async () => {
    const broken = async (): Promise<never> => Promise.reject(new Error("storage unavailable"));
    const out = await planTriggers(described(wine()), described(wine({ fields: { name: { type: "text" }, grape: { type: "text" } } })), broken);
    expect(out).toMatchObject([{ kind: "field-kind", records: 0 }]);
  });
});

describe("Go keeps exactly what was made", () => {
  it("the change the model made is the one saved: the same source and words, and no request more", async () => {
    mocks.chatCreate.mockResolvedValue(reply(edit("Grape now takes any text.", GRAPE, '        grape: { type: "text" },')));
    const out = await studioEngine(engine, () => {}).modify(APP, BEFORE, "let me type any grape");
    if (out.kind !== "source") throw new Error(out.kind);
    const requests = mocks.chatCreate.mock.calls.length;
    expect(requests).toBe(1);

    // The gate, as the Studio runs it: the saved app against the one just made, and the records there.
    const [was, now] = (await Promise.all([loadTrustedModule(APP), loadTrustedModule(out.source)])) as AppDefinition[];
    const gate = await planFor(describedIn(was!, ["en"]), { ...describedIn(now!, ["en"]), migrations: now!.migrations }, rows());
    expect(gate?.triggers).toMatchObject([{ kind: "field-kind", field: "grape", records: 2 }]);

    const held = { source: out.source, built: { build: 7 }, summary: out.summary, note: "let me type any grape", consequences: gate!.consequences, libraries: null, extra: {} };
    const go = goWith(held);
    expect(go).toEqual({ source: out.source, built: held.built, summary: out.summary, note: "let me type any grape", libraries: null, extra: {} });
    // Go asked nothing of a model.
    expect(mocks.chatCreate).toHaveBeenCalledTimes(requests);
  }, 60_000);

  it("a change asked for while a plan waits is made to the planned app, and says so", () => {
    const said = refineInstruction("keep the list, but let me add to it", { note: "let me type\nany grape" });
    expect(said.startsWith("keep the list, but let me add to it")).toBe(true);
    expect(said).toContain('"let me type any grape"');
    expect(said).toMatch(/not kept yet/);
  });
});
