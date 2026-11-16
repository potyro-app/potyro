import { describe, expect, it } from "vitest";
import { EXPLAIN_NOTE, KEPT_NO_QUESTION_NOTE, REVIEW_EXPLAIN, REVIEW_HEAD, REVIEW_WAYS, runModifyLoop, type ModifyLoopDeps } from "../src/agent/modify-loop.js";
import type { ChatEngine, ChatRequest, ChatResponse } from "../src/chat-backend.js";

// #73: an accepted change is held against the request's own parts, and the model is asked ONCE about
// what it left unanswered. The engines are scripted; nothing here calls a model. What counts as
// unanswered is request-parts.test.ts's; this is what the loop does with it.

const SOURCE = `import { defineApp } from "potyro";

export default defineApp({
  id: "cellar",
  name: "Cellar",
  entities: {
    bottle: {
      fields: {
        name: { type: "text", label: "Name", required: true },
        grape: { type: "enum", label: "Grape", options: ["merlot", "syrah"] },
        country: { type: "enum", label: "Country", options: ["france", "italy"] },
        region: { type: "enum", label: "Region", options: ["north", "south"] },
      },
    },
  },
  pages: [{ id: "cellar", title: "Cellar", view: { type: "list", entity: "bottle" } }],
});
`;

const LIST = { grape: '["merlot", "syrah"]', country: '["france", "italy"]', region: '["north", "south"]' } as const;
const label = (key: keyof typeof LIST): string => key[0]!.toUpperCase() + key.slice(1);
const block = (key: keyof typeof LIST): string =>
  `<<<<<<< SEARCH\n        ${key}: { type: "enum", label: "${label(key)}", options: ${LIST[key]} },\n=======\n        ${key}: { type: "text", label: "${label(key)}" },\n>>>>>>> REPLACE`;
/** A reply that makes these fields free text, with `prose` before the block. */
const freeText = (prose: string, ...keys: Array<keyof typeof LIST>): string => `${prose}\n\`\`\`ts\n${keys.map(block).join("\n")}\n\`\`\`\n`;

function scripted(turns: string[]): { engine: ChatEngine; seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  let i = 0;
  const message = (): ChatResponse["choices"][number]["message"] => ({ content: turns[i++] ?? "" });
  return { seen, engine: { chat: { completions: { create: async (req) => (seen.push({ ...req, messages: [...req.messages] }), { choices: [{ message: message() }] }) } } } };
}

const SHAPE = { entities: { bottle: {} }, pages: [{ id: "cellar", view: { type: "list", entity: "bottle" } }] };
const base = (over: Partial<ModifyLoopDeps>): ModifyLoopDeps => ({
  engine: scripted([]).engine,
  tools: [],
  system: "contract",
  instruction: "Make Grape and Country free text",
  source: SOURCE,
  check: async () => [],
  shapeOf: async () => SHAPE,
  before: SHAPE,
  askPerson: false,
  ...over,
});
const lastNote = (seen: ChatRequest[], call: number): string => seen[call]!.messages.at(-1)!.content;
// The request of #73: it names no field.
const GENERIC = "do not cause an error when a field is not recognized; if the value does not exist in the list, add it";

describe("the modify loop asks once about what a change left unanswered (#73)", () => {
  it("a named part with neither an edit nor a Not done line: asked, and the answer's Not done lines ride on the change", async () => {
    const { engine, seen } = scripted([freeText("Grape now takes any text.", "grape"), "Not done:\n- Country still takes only the countries in its list, because a list cannot learn new values"]);
    const out = await runModifyLoop(base({ engine }));
    expect(seen).toHaveLength(2);
    const note = lastNote(seen, 1);
    expect(note.startsWith(REVIEW_HEAD)).toBe(true);
    expect(note).toContain('- "Country": the field bottle.country');
    expect(note).toContain(REVIEW_WAYS);
    expect(note).not.toContain(REVIEW_EXPLAIN);
    expect(out).toMatchObject({
      kind: "source",
      applied: 1,
      rationale: "Grape now takes any text.",
      notDone: ["Country still takes only the countries in its list, because a list cannot learn new values"],
      review: { parts: ["Country"], siblings: [] },
    });
    expect(out.kind === "source" && out.source).toContain('grape: { type: "text"');
    expect(out.kind === "source" && out.source).toContain('country: { type: "enum"');
  });

  it("the rule lifted from one field and left on its siblings: named, and a fuller change replaces the first", async () => {
    const { engine, seen } = scripted([freeText("Grape now takes any text.", "grape"), freeText("Grape, Country and Region now take any text.", "grape", "country", "region")]);
    const out = await runModifyLoop(base({ engine, instruction: GENERIC }));
    expect(seen).toHaveLength(2);
    expect(lastNote(seen, 1)).toContain('In your change, "Grape" (bottle.grape) changed from an `enum` field to a `text` field and lost `options`. Left exactly as they were, with the same shape: "Country" (bottle.country), "Region" (bottle.region).');
    expect(out).toMatchObject({ kind: "source", applied: 3, rationale: "Grape, Country and Region now take any text.", review: { parts: [], siblings: ["bottle.country", "bottle.region"] } });
    expect(out.kind === "source" && out.source).not.toContain('type: "enum"');
  });

  it("asked once: the fuller change is not reviewed again, whatever it still leaves", async () => {
    const { engine, seen } = scripted([freeText("Grape now takes any text.", "grape"), freeText("Grape and Country now take any text.", "grape", "country"), "never asked"]);
    const out = await runModifyLoop(base({ engine, instruction: GENERIC }));
    expect(seen).toHaveLength(2);
    expect(out).toMatchObject({ kind: "source", applied: 2 });
  });

  it('"the request did not ask for that" adds nothing: the change stands with its own words', async () => {
    const { engine, seen } = scripted([freeText("Grape now takes any text.", "grape"), "The request was only about the grape list."]);
    const out = await runModifyLoop(base({ engine, instruction: GENERIC }));
    expect(seen).toHaveLength(2);
    expect(out).toMatchObject({ kind: "source", applied: 1, rationale: "Grape now takes any text." });
    expect(out.kind === "source" && out.notDone).toBeUndefined();
  });

  it("the lines it had already listed are kept, and one said twice is listed once", async () => {
    const { engine } = scripted([
      freeText("Grape now takes any text.\n\nNot done:\n- adding a value to a list, a list cannot learn new values", "grape"),
      "Not done:\n- adding a value to a list, a list cannot learn new values\n- Region and Country stay lists",
    ]);
    const out = await runModifyLoop(base({ engine, instruction: GENERIC }));
    expect(out.kind === "source" && out.notDone).toEqual(["adding a value to a list, a list cannot learn new values", "Region and Country stay lists"]);
  });

  it("a change without a word that also left a part unanswered: one note asks for both", async () => {
    const { engine, seen } = scripted([freeText("", "grape"), "Grape now takes any text; you see it when adding a bottle.\n\nNot done:\n- Country stays a list"]);
    const out = await runModifyLoop(base({ engine }));
    expect(seen).toHaveLength(2);
    expect(lastNote(seen, 1)).toContain(REVIEW_EXPLAIN);
    expect(lastNote(seen, 1)).not.toBe(EXPLAIN_NOTE);
    expect(out).toMatchObject({ kind: "source", notDone: ["Country stays a list"] });
    expect(out.kind === "source" && out.rationale).toMatch(/^Grape now takes any text/);
  });

  it("a fuller change that fails the check does not lose the one that passed", async () => {
    const { engine } = scripted([freeText("Grape now takes any text.", "grape"), freeText("All of them.", "grape", "country", "region"), "", ""]);
    const out = await runModifyLoop(base({ engine, instruction: GENERIC, maxSteps: 4, check: async (src) => (src.includes('region: { type: "text"') ? ["region is used as a list elsewhere"] : []) }));
    expect(out).toMatchObject({ kind: "source", applied: 1, rationale: "Grape now takes any text." });
  });

  it("a question in answer to the note is not put to the person: the run does not pause on a change that passed", async () => {
    const seen: ChatRequest[] = [];
    const turns: ChatResponse["choices"][number]["message"][] = [
      { content: freeText("Grape now takes any text.", "grape") },
      { content: "", tool_calls: [{ id: "q1", type: "function", function: { name: "ask_person", arguments: JSON.stringify({ question: "Country too?", options: ["Yes", "No"] }) } }] },
      { content: "Not done:\n- Country stays a list" },
    ];
    let i = 0;
    const engine: ChatEngine = { chat: { completions: { create: async (req) => (seen.push({ ...req, messages: [...req.messages] }), { choices: [{ message: turns[i++] ?? { content: "" } }] }) } } };
    const out = await runModifyLoop(base({ engine, askPerson: true }));
    expect(seen).toHaveLength(3);
    expect(seen[2]!.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "q1", content: KEPT_NO_QUESTION_NOTE });
    expect(out).toMatchObject({ kind: "source", applied: 1, rationale: "Grape now takes any text.", notDone: ["Country stays a list"] });
  });

  it("nothing left unanswered: accepted at once", async () => {
    for (const [instruction, reply] of [
      ["Make Grape and Country free text", freeText("Both now take any text.", "grape", "country")],
      ["Make Grape and Country free text", freeText("Grape now takes any text.\n\nNot done:\n- Country, its list is used by the map", "grape")],
      ["Make Grape free text", freeText("Grape now takes any text.", "grape")],
      [GENERIC, freeText("All three lists now take any text.", "grape", "country", "region")],
    ] as const) {
      const { engine, seen } = scripted([reply]);
      expect(await runModifyLoop(base({ engine, instruction }))).toMatchObject({ kind: "source" });
      expect(seen, instruction).toHaveLength(1);
    }
  });

  it("pointing at a part names it: its siblings are not asked about", async () => {
    const { engine, seen } = scripted([freeText("It now takes any text.", "grape")]);
    await runModifyLoop(base({ engine, instruction: "let me type anything here", context: { pointedAt: { words: 'the "Grape" field of the bottle form' } } }));
    expect(seen).toHaveLength(1);
  });

  it("turned off, it asks nothing (the eval's ablation)", async () => {
    const { engine, seen } = scripted([freeText("Grape now takes any text.", "grape")]);
    const out = await runModifyLoop(base({ engine, reviewParts: false }));
    expect(seen).toHaveLength(1);
    expect(out.kind === "source" && out.review).toBeUndefined();
  });

  it("no step left to hear the answer: nothing is asked", async () => {
    const { engine, seen } = scripted([freeText("Grape now takes any text.", "grape")]);
    expect(await runModifyLoop(base({ engine, maxSteps: 1 }))).toMatchObject({ kind: "source", applied: 1 });
    expect(seen).toHaveLength(1);
  });
});
