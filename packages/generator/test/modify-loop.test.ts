import { describe, expect, it } from "vitest";
import { runModifyLoop, type ModifyLoopDeps } from "../src/agent/modify-loop.js";
import type { AgentTool } from "../src/agent/tools.js";
import type { ChatEngine, ChatRequest, ChatResponse } from "../src/chat-backend.js";
import { NOT_IN_APP } from "../src/prompt.js";

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
  });

  it("counts search_corpus as looking before a refusal (#262)", async () => {
    const search: AgentTool = { ...lookup, name: "search_corpus" };
    const { engine } = scripted([
      { content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "search_corpus", arguments: '{"query":"bluetooth"}' } }] },
      { content: `${NOT_IN_APP} nothing in the apps or docs uses bluetooth.` },
    ]);
    const out = await runModifyLoop(base({ engine, tools: [search] }));
    expect(out.kind).toBe("diagnosis");
  });
});
