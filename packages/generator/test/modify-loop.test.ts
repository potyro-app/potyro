import { describe, expect, it } from "vitest";
import { runModifyLoop, type ModifyLoopDeps } from "../src/agent/modify-loop.js";
import type { AgentTool } from "../src/agent/tools.js";
import type { ChatEngine, ChatRequest, ChatResponse } from "../src/chat-backend.js";
import { NOT_IN_APP } from "../src/prompt.js";
import { regressionGate, type RunReport } from "../src/run-report.js";
import { buildCorpus } from "../src/corpus.js";

// The modify loop (#131): the Studio's "change this app" on the same footing as the fix loop —
// tools to discover with, a check gate every candidate must pass, and a refusal that is only
// accepted after the model has looked. Engines are scripted; nothing here calls a model.

const SOURCE = ["export default defineApp({", '  id: "x",', "  entities: { city: {}, place: {} },", "});"].join("\n");
const edit = (prose: string, search: string, replace: string) => `${prose}\n\`\`\`ts\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n\`\`\`\n`;

function scripted(turns: ChatResponse["choices"][number]["message"][]): { engine: ChatEngine; seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  let i = 0;
  // Snapshot the messages: the loop appends to one array, so a stored reference would show every
  // request with the final transcript.
  return {
    seen,
    engine: { chat: { completions: { create: async (req) => (seen.push({ ...req, messages: [...req.messages] }), { choices: [{ message: turns[i++] ?? { content: "" } }] }) } } },
  };
}

const lookup: AgentTool = {
  name: "lookup",
  description: "look",
  parameters: { type: "object", properties: { query: { type: "string" } } },
  run: async (a) => ({ ok: true, detail: `declaration of ${String(a.query)}` }),
};

const base = (over: Partial<ModifyLoopDeps>): ModifyLoopDeps => ({
  engine: scripted([]).engine,
  tools: [lookup],
  system: "contract",
  instruction: "rename the id",
  source: SOURCE,
  check: async () => [],
  shapeOf: async () => ({ entities: { city: {}, place: {} }, pages: [] }),
  before: { entities: { city: {}, place: {} }, pages: [] },
  ...over,
});

describe("runModifyLoop", () => {
  it("applies edits that pass the check, carrying rationale and Not done", async () => {
    const { engine } = scripted([{ content: edit("Renamed.\n\nNot done:\n- the banner, needs ctx.scope", '  id: "x",', '  id: "y",') }]);
    const out = await runModifyLoop(base({ engine }));
    expect(out).toMatchObject({ kind: "source", via: "edits", applied: 1, notDone: ["the banner, needs ctx.scope"] });
    expect(out.kind === "source" && out.source).toContain('id: "y"');
  });

  it("does not accept a refusal the model has not looked into: it is sent back to the tools once", async () => {
    const { engine, seen } = scripted([
      { content: `${NOT_IN_APP} the map has no center option.` },
      { content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "lookup", arguments: '{"query":"MapView"}' } }] },
      { content: `${NOT_IN_APP} MapView declares camera: MapCamera, a literal only — no function of ctx.` },
    ]);
    const out = await runModifyLoop(base({ engine }));
    expect(out).toEqual({ kind: "diagnosis", text: "MapView declares camera: MapCamera, a literal only — no function of ctx." });
    // The nudge names the tool, and the transcript carries the lookup's answer before the verdict.
    const nudge = seen[1]!.messages.at(-1)!;
    expect(nudge.role).toBe("user");
    expect(nudge.content).toMatch(/lookup/);
    expect(seen[2]!.messages.some((m) => m.role === "tool" && m.content.includes("declaration of MapView"))).toBe(true);
  });

  it("accepts a refusal after a tool was used", async () => {
    const { engine } = scripted([
      { content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "lookup", arguments: '{"query":"Ctx"}' } }] },
      { content: `${NOT_IN_APP} nothing on ctx holds a current trip.` },
    ]);
    expect(await runModifyLoop(base({ engine }))).toEqual({ kind: "diagnosis", text: "nothing on ctx holds a current trip." });
  });

  it("sends a candidate that fails the check back with the validator's words", async () => {
    const { engine, seen } = scripted([
      { content: edit("Try 1.", '  id: "x",', '  id: "bad",') },
      { content: edit("Try 2.", '  id: "x",', '  id: "y",') },
    ]);
    const out = await runModifyLoop(
      base({ engine, check: async (src) => (src.includes("bad") ? ["id must be a lowercase slug"] : []) }),
    );
    expect(out.kind).toBe("source");
    expect(seen[1]!.messages.at(-1)!.content).toContain("id must be a lowercase slug");
    // The retry is told to edit the ORIGINAL, as the fix loop is: the failed candidate is not the app.
    expect(seen[1]!.messages.at(-1)!.content).toMatch(/app as first shown/);
  });

  it("sends a candidate that drops an entity back with the loss named", async () => {
    const { engine, seen } = scripted([
      { content: edit("Try 1.", "  entities: { city: {}, place: {} },", "  entities: { city: {} },") },
      { content: edit("Try 2.", '  id: "x",', '  id: "y",') },
    ]);
    const out = await runModifyLoop(
      base({ engine, shapeOf: async (src) => (src.includes("place") ? { entities: { city: {}, place: {} }, pages: [] } : { entities: { city: {} }, pages: [] }) }),
    );
    expect(out.kind).toBe("source");
    expect(seen[1]!.messages.at(-1)!.content).toMatch(/place/);
  });

  it("returns a question with the transcript, like the fix loop", async () => {
    const { engine } = scripted([{ content: "ASK: which trip should be the default?" }]);
    const out = await runModifyLoop(base({ engine }));
    expect(out.kind).toBe("question");
    expect(out.kind === "question" && out.text).toBe("which trip should be the default?");
  });

  it("gives up after the step budget, saying why", async () => {
    const { engine } = scripted([{ content: "I would rather not." }, { content: "Still no." }]);
    const out = await runModifyLoop(base({ engine, maxSteps: 2 }));
    expect(out.kind).toBe("failed");
    expect(out.kind === "failed" && out.reason).toMatch(/2 step/);
    expect(out.kind === "failed" && out.cause).toBe("steps");
  });

  describe("running the candidate (#262)", () => {
    const rename = (to: string) => ({ content: edit(`Rename to ${to}.`, '  id: "x",', `  id: "${to}",`) });

    it("sends a candidate that validates but throws when it runs back with the error", async () => {
      const { engine, seen } = scripted([rename("boom"), rename("y")]);
      const run = regressionGate(async (src: string) =>
        src.includes("boom") ? { errors: ["action city.visit: ctx.travel is not a function"], warnings: [], ran: "1 action" } : { errors: [], warnings: [], ran: "1 action" }, SOURCE);
      const out = await runModifyLoop(base({ engine, run }));
      expect(out.kind === "source" && out.source).toContain('id: "y"');
      expect(seen[1]!.messages.at(-1)!.content).toContain("ctx.travel is not a function");
      expect(seen[1]!.messages.at(-1)!.content).toMatch(/app as first shown/);
    });

    it("points a warning out once; the same candidate sent again is accepted as meant", async () => {
      const { engine, seen } = scripted([rename("y"), rename("y")]);
      const run = regressionGate(async (src: string) => ({ errors: [], warnings: src === SOURCE ? [] : ['page "overdue" showed nothing'], ran: "2 pages" }), SOURCE);
      const out = await runModifyLoop(base({ engine, run }));
      expect(out.kind).toBe("source");
      expect(seen).toHaveLength(2);
      expect(seen[1]!.messages.at(-1)!.content).toContain('page "overdue" showed nothing');
    });

    it("does not hold a change back when the run itself cannot start", async () => {
      const { engine } = scripted([rename("y"), rename("y")]);
      const out = await runModifyLoop(base({ engine, run: regressionGate(async () => { throw new Error("no DOM"); }, SOURCE) }));
      expect(out.kind).toBe("source");
    });

    it("accepts a change that leaves a failure the app already had as it was (#262 regression gate)", async () => {
      const { engine, seen } = scripted([rename("y")]);
      const failing = (): RunReport => ({ errors: ["computed city.population: no census for record 4f2a91c0"], warnings: [], ran: "1 page" });
      const out = await runModifyLoop(base({ engine, run: regressionGate(async () => failing(), SOURCE) }));
      expect(out.kind).toBe("source");
      expect(seen).toHaveLength(1);
    });

    it("sends back only what the change broke, with what was already failing as context", async () => {
      const { engine, seen } = scripted([rename("boom"), rename("y")]);
      const run = regressionGate(
        async (src: string) => ({
          errors: ["computed city.population: no census", ...(src.includes("boom") ? ["action city.visit: ctx.travel is not a function"] : [])],
          warnings: [],
          ran: "1 action",
        }),
        SOURCE,
      );
      const out = await runModifyLoop(base({ engine, run }));
      expect(out.kind).toBe("source");
      const sentBack = seen[1]!.messages.at(-1)!.content;
      expect(sentBack).toContain("ctx.travel is not a function");
      expect(sentBack).toMatch(/already failing before this change/i);
      expect(sentBack.indexOf("ctx.travel")).toBeLessThan(sentBack.indexOf("no census"));
    });

    it("counts search_corpus as looking before a refusal", async () => {
      const search: AgentTool = { ...lookup, name: "search_corpus" };
      const { engine } = scripted([
        { content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "search_corpus", arguments: '{"query":"bluetooth"}' } }] },
        { content: `${NOT_IN_APP} nothing in the apps or docs uses bluetooth.` },
      ]);
      const out = await runModifyLoop(base({ engine, tools: [search] }));
      expect(out.kind).toBe("diagnosis");
    });
  });

  describe("the first message is primed from the corpus (#262)", () => {
    const corpus = async () =>
      buildCorpus([
        { path: "examples/places.app.ts", text: 'export default defineApp({ id: "places", pages: [{ id: "map", view: { type: "map", entity: "place", camera: { lat: 1, lng: 2 } } }] });' },
        { path: "docs/04-app-module-api.md", text: "## Map camera\n\nA map view takes `camera` to open on a place." },
      ]);

    it("carries the relevant passages once, in the first user message, and the app exactly once", async () => {
      const { engine, seen } = scripted([{ content: edit("Done.", '  id: "x",', '  id: "y",') }]);
      await runModifyLoop(base({ engine, instruction: "open the map on the camera position", corpus }));
      const first = seen[0]!.messages[1]!.content;
      expect(first).toContain("examples/places.app.ts");
      expect(first.indexOf("search_corpus")).toBeGreaterThan(0);
      expect(first.split(SOURCE).length - 1).toBe(1);
    });

    it("adds nothing when the corpus has nothing to say", async () => {
      const { engine, seen } = scripted([{ content: edit("Done.", '  id: "x",', '  id: "y",') }]);
      await runModifyLoop(base({ engine, instruction: "rename the id", corpus }));
      expect(seen[0]!.messages[1]!.content).not.toMatch(/^--- /m);
    });
  });

  describe("the part the person pointed at (#284)", () => {
    it("is said beside the instruction in the first message, and the app is still there once", async () => {
      const { engine, seen } = scripted([{ content: edit("Done.", '  id: "x",', '  id: "y",') }]);
      await runModifyLoop(
        base({ engine, instruction: "sort this by date", context: { pointedAt: { words: 'the "Nights" list on the "Patterns" page', lines: [2, 2], excerpt: '  id: "x",' } } }),
      );
      const first = seen[0]!.messages[1]!.content;
      expect(first).toContain('They pointed at the "Nights" list on the "Patterns" page');
      expect(first).toContain("lines 2–2");
      expect(first.split(SOURCE).length - 1).toBe(1);
    });
  });

  describe("stopping on repetition (#262)", () => {
    const rename = (to: string) => ({ content: edit(`Rename to ${to}.`, '  id: "x",', `  id: "${to}",`) });

    it("a reply that repeats the previous one ends the loop with the best candidate so far", async () => {
      // The first candidate is held back only by a warning; the model repeats itself instead of
      // changing anything or confirming — that candidate is what it meant.
      const { engine, seen } = scripted([rename("y"), { content: "Let me write the edits now." }, { content: "Let me write the edits now." }]);
      const run = regressionGate(async (src: string) => ({ errors: [], warnings: src === SOURCE ? [] : ['page "overdue" showed nothing'], ran: "1 page", pages: ["overdue"] }), SOURCE);
      const out = await runModifyLoop(base({ engine, run }));
      expect(out.kind).toBe("source");
      expect(out.kind === "source" && out.source).toContain('id: "y"');
      expect(seen).toHaveLength(3);
    });

    it("with no acceptable candidate, a repeated reply is a failure that says so", async () => {
      const { engine } = scripted([{ content: "I would rather not." }, { content: "I would rather not." }]);
      const out = await runModifyLoop(base({ engine }));
      expect(out.kind).toBe("failed");
      expect(out.kind === "failed" && out.reason).toMatch(/repeat/i);
      expect(out.kind === "failed" && out.cause).toBe("repeated");
    });

    it("a reply that is mostly one line said over and over stops the loop", async () => {
      const line = "Let me write the edits now.";
      const { engine, seen } = scripted([{ content: Array.from({ length: 8 }, () => line).join("\n") + "\n" + edit("", '  id: "x",', '  id: "y",') }, rename("z")]);
      const out = await runModifyLoop(base({ engine }));
      expect(out.kind).toBe("failed");
      expect(out.kind === "failed" && out.reason).toMatch(/repeat/i);
      expect(out.kind === "failed" && out.cause).toBe("repeated");
      expect(seen).toHaveLength(1);
    });
  });

  describe("candidates are capped separately from tool reads (#262)", () => {
    const rename = (to: string) => ({ content: edit(`Rename to ${to}.`, '  id: "x",', `  id: "${to}",`) });
    const call = (q: string) => ({ content: "", tool_calls: [{ id: `t-${q}`, type: "function" as const, function: { name: "lookup", arguments: JSON.stringify({ query: q }) } }] });

    it("stops after the candidate budget, naming it, however many steps remain", async () => {
      const { engine, seen } = scripted([rename("bad1"), rename("bad2"), rename("bad3"), rename("ok")]);
      const out = await runModifyLoop(base({ engine, maxCandidates: 2, check: async (src) => (src.includes("bad") ? ["pages: bad"] : []) }));
      expect(out.kind).toBe("failed");
      expect(out.kind === "failed" && out.reason).toMatch(/2 candidates/);
      expect(out.kind === "failed" && out.cause).toBe("candidates");
      expect(seen).toHaveLength(2);
    });

    it("tool reads do not use up the candidate budget", async () => {
      const { engine } = scripted([call("a"), call("b"), call("c"), rename("y")]);
      const out = await runModifyLoop(base({ engine, maxCandidates: 1 }));
      expect(out.kind).toBe("source");
    });

    it("the step budget still bounds the whole conversation", async () => {
      const { engine } = scripted([call("a"), call("b"), call("c"), rename("y")]);
      const out = await runModifyLoop(base({ engine, maxSteps: 3 }));
      expect(out.kind).toBe("failed");
      expect(out.kind === "failed" && out.reason).toMatch(/3 steps/);
      expect(out.kind === "failed" && out.cause).toBe("steps");
    });
  });
});
