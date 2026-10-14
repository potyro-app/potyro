import { describe, expect, it } from "vitest";
import { runModifyLoop, type ModifyLoopDeps } from "../src/agent/modify-loop.js";
import type { LoopStep } from "../src/agent/loop.js";
import type { AgentTool } from "../src/agent/tools.js";
import type { ChatEngine, ChatRequest, ChatResponse } from "../src/chat-backend.js";
import { NOT_IN_APP } from "../src/prompt.js";
import { regressionGate } from "../src/run-report.js";

// #278 and docs/19 F1–F2: a repeat is rolled back, not appended to; a second repeat stops; after
// the second failed candidate the conversation starts again from the app and the request, with a
// one-line note per attempt that was turned back. Engines are scripted; nothing calls a model.

const SOURCE = ["export default defineApp({", '  id: "x",', "  entities: { city: {}, place: {} },", "});"].join("\n");
const edit = (prose: string, search: string, replace: string) => `${prose}\n\`\`\`ts\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n\`\`\`\n`;
const rename = (to: string) => ({ content: edit(`Rename to ${to}.`, '  id: "x",', `  id: "${to}",`) });
const call = (q: string, id = `t-${q}-${Math.random()}`) => ({ content: "", tool_calls: [{ id, type: "function" as const, function: { name: "lookup", arguments: JSON.stringify({ query: q }) } }] });

function scripted(turns: ChatResponse["choices"][number]["message"][]): { engine: ChatEngine; seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  let i = 0;
  return {
    seen,
    engine: { chat: { completions: { create: async (req) => (seen.push({ ...req, messages: [...req.messages] }), { choices: [{ message: turns[i++] ?? { content: "" } }] }) } } },
  };
}

let lookups = 0;
const lookup: AgentTool = {
  name: "lookup",
  description: "look",
  parameters: { type: "object", properties: { query: { type: "string" } } },
  run: async (a) => ((lookups += 1), { ok: true, detail: `declaration of ${String(a.query)}` }),
};

/** Refuses any candidate whose id is not "ok" or "good", with the validator's words. */
const picky = async (src: string): Promise<string[]> => (/id: "(ok|good)"/.test(src) || src === SOURCE ? [] : [`id must be "ok" (got ${/id: "([^"]*)"/.exec(src)?.[1]})`]);

const base = (over: Partial<ModifyLoopDeps>): ModifyLoopDeps => ({
  engine: scripted([]).engine,
  tools: [lookup],
  system: "contract",
  instruction: "rename the id",
  source: SOURCE,
  check: picky,
  shapeOf: async () => ({ entities: { city: {}, place: {} }, pages: [] }),
  before: { entities: { city: {}, place: {} }, pages: [] },
  ...over,
});

const assistantTexts = (req: ChatRequest) => req.messages.filter((m) => m.role === "assistant").map((m) => m.content);

describe("a repeated reply is rolled back (#278, F1)", () => {
  it("drops the repeated candidate and the refusal that answered it, and says what to do instead", async () => {
    const { engine, seen } = scripted([rename("bad"), rename("bad"), rename("ok")]);
    const steps: LoopStep[] = [];
    const out = await runModifyLoop(base({ engine, onStep: (s) => steps.push(s) }));
    expect(out.kind === "source" && out.source).toContain('id: "ok"');
    const third = seen[2]!;
    // The repeated attempt is gone from the conversation: no copy of it, no refusal of it.
    expect(assistantTexts(third).some((t) => t.includes('id: "bad"'))).toBe(false);
    expect(third.messages.filter((m) => m.role === "user")).toHaveLength(2);
    const note = third.messages.at(-1)!;
    expect(note.role).toBe("user");
    // What was tried, the gate's reason, and the ways out that exist.
    expect(note.content).toContain("Rename to bad.");
    expect(note.content).toContain('id must be "ok" (got bad)');
    expect(note.content).toMatch(/different/i);
    expect(note.content).toContain("ASK:");
    expect(note.content).toContain(NOT_IN_APP);
    // Not offered: it does not exist yet (#263).
    expect(note.content).not.toContain("NEEDS-PLATFORM");
    expect(steps.filter((s) => s.kind === "unusable" && s.repeat)).toHaveLength(1);
  });

  it("stops on the second repeat, with cause `repeated`", async () => {
    const { engine, seen } = scripted([rename("bad"), rename("bad"), rename("bad"), rename("ok")]);
    const out = await runModifyLoop(base({ engine }));
    expect(out).toMatchObject({ kind: "failed", cause: "repeated" });
    expect(seen).toHaveLength(3);
  });

  it("rolls back prose said twice, too", async () => {
    const { engine, seen } = scripted([{ content: "Let me think about it." }, { content: "Let me think about it." }, rename("ok")]);
    const out = await runModifyLoop(base({ engine }));
    expect(out.kind).toBe("source");
    expect(assistantTexts(seen[2]!)).toEqual([]);
    expect(seen[2]!.messages.at(-1)!.content).toContain("Let me think about it.");
  });

  it("a reply that is one line said over and over gets one more go, not a stop", async () => {
    const line = "Let me write the edits now.";
    const { engine, seen } = scripted([{ content: Array.from({ length: 8 }, () => line).join("\n") }, rename("ok")]);
    const out = await runModifyLoop(base({ engine }));
    expect(out.kind).toBe("source");
    expect(assistantTexts(seen[1]!)).toEqual([]);
  });

  it("resending a candidate to confirm a warning is a confirmation, not a repeat", async () => {
    const { engine, seen } = scripted([rename("ok"), rename("ok")]);
    const steps: LoopStep[] = [];
    const run = regressionGate(async (src: string) => ({ errors: [], warnings: src === SOURCE ? [] : ['page "overdue" showed nothing'], ran: "2 pages" }), SOURCE);
    const out = await runModifyLoop(base({ engine, run, onStep: (s) => steps.push(s) }));
    expect(out.kind === "source" && out.source).toContain('id: "ok"');
    expect(seen).toHaveLength(2);
    expect(steps.some((s) => s.kind === "unusable" && s.repeat)).toBe(false);
  });

  it("a refusal said again after it was sent to the tools is the model's answer, not a repeat", async () => {
    const { engine } = scripted([{ content: `${NOT_IN_APP} nothing on ctx holds a trip.` }, { content: `${NOT_IN_APP} nothing on ctx holds a trip.` }]);
    expect(await runModifyLoop(base({ engine }))).toEqual({ kind: "diagnosis", text: "nothing on ctx holds a trip." });
  });
});

describe("repeated identical tool calls (F1)", () => {
  it("the third identical call in a row is not run; the earlier two are rolled back with a note", async () => {
    lookups = 0;
    const { engine, seen } = scripted([call("Ctx"), call("Ctx"), call("Ctx"), rename("ok")]);
    const steps: LoopStep[] = [];
    const out = await runModifyLoop(base({ engine, onStep: (s) => steps.push(s) }));
    expect(out.kind).toBe("source");
    expect(lookups).toBe(2);
    const fourth = seen[3]!;
    expect(fourth.messages.some((m) => m.role === "tool")).toBe(false);
    expect(fourth.messages.at(-1)!.content).toContain("lookup");
    expect(fourth.messages.at(-1)!.content).toContain("declaration of Ctx");
    expect(steps.filter((s) => s.kind === "unusable" && s.repeat)).toHaveLength(1);
  });

  it("different arguments are not a repeat", async () => {
    lookups = 0;
    const { engine } = scripted([call("a"), call("b"), call("c"), rename("ok")]);
    expect((await runModifyLoop(base({ engine }))).kind).toBe("source");
    expect(lookups).toBe(3);
  });

  it("a tool repeat and then a reply repeat stop the loop: both count", async () => {
    const { engine, seen } = scripted([call("Ctx"), call("Ctx"), call("Ctx"), rename("bad"), rename("bad")]);
    expect(await runModifyLoop(base({ engine }))).toMatchObject({ kind: "failed", cause: "repeated" });
    expect(seen).toHaveLength(5);
  });
});

describe("a fresh start after the second failed candidate (F2)", () => {
  it("starts again from the system prompt and one message: the app, the request, and what was turned back", async () => {
    const { engine, seen } = scripted([rename("bad1"), rename("bad2"), rename("ok")]);
    const steps: LoopStep[] = [];
    const out = await runModifyLoop(base({ engine, onStep: (s) => steps.push(s) }));
    expect(out.kind === "source" && out.source).toContain('id: "ok"');
    const fresh = seen[2]!;
    expect(fresh.messages.map((m) => m.role)).toEqual(["system", "user"]);
    const first = fresh.messages[1]!.content;
    expect(first.split(SOURCE).length - 1).toBe(1);
    expect(first).toContain("rename the id");
    expect(first).toContain("Rename to bad1.");
    expect(first).toContain('id must be "ok" (got bad1)');
    expect(first).toContain("Rename to bad2.");
    expect(first).toContain('id must be "ok" (got bad2)');
    // The request stays the person's words, after the app; the note comes last.
    expect(first.indexOf("rename the id")).toBeLessThan(first.indexOf("Rename to bad1."));
    expect(steps.some((s) => s.kind === "unusable" && s.restart)).toBe(true);
  });

  it("keeps the candidate budget across the restart: 4 in all, not 4 a chain", async () => {
    const { engine, seen } = scripted([rename("b1"), rename("b2"), rename("b3"), rename("b4"), rename("ok")]);
    const out = await runModifyLoop(base({ engine }));
    expect(out).toMatchObject({ kind: "failed", cause: "candidates" });
    expect(out.kind === "failed" && out.reason).toMatch(/4 candidates/);
    expect(seen).toHaveLength(4);
  });

  it("keeps the step budget across the restart", async () => {
    const { engine, seen } = scripted([rename("b1"), rename("b2"), { content: "Hmm." }, rename("ok")]);
    const out = await runModifyLoop(base({ engine, maxSteps: 3 }));
    expect(out).toMatchObject({ kind: "failed", cause: "steps" });
    expect(seen).toHaveLength(3);
  });

  it("a candidate turned back before the restart, sent again after it, is a repeat", async () => {
    const { engine, seen } = scripted([rename("b1"), rename("b2"), rename("b1"), rename("ok")]);
    const steps: LoopStep[] = [];
    const out = await runModifyLoop(base({ engine, onStep: (s) => steps.push(s) }));
    expect(out.kind).toBe("source");
    expect(steps.filter((s) => s.kind === "unusable" && s.repeat)).toHaveLength(1);
    expect(seen[3]!.messages.at(-1)!.content).toContain('id must be "ok" (got b1)');
  });
});

describe("the part the person pointed at survives the recovery (#284)", () => {
  const context = { pointedAt: { words: 'the "Nights" list on the "Patterns" page', lines: [2, 2] as const, excerpt: '  id: "x",' } };
  const pointedIn = (content: string): void => {
    expect(content).toContain('They pointed at the "Nights" list on the "Patterns" page');
    expect(content).toContain("lines 2–2");
    // The slice is a slice: the app itself is still there exactly once.
    expect(content.split(SOURCE).length - 1).toBe(1);
  };

  it("a fresh start's single message still carries the target and its source slice", async () => {
    const { engine, seen } = scripted([rename("bad1"), rename("bad2"), rename("ok")]);
    const out = await runModifyLoop(base({ engine, context }));
    expect(out.kind === "source" && out.source).toContain('id: "ok"');
    const fresh = seen[2]!;
    expect(fresh.messages.map((m) => m.role)).toEqual(["system", "user"]);
    pointedIn(fresh.messages[1]!.content);
    expect(fresh.messages[1]!.content).toContain("Rename to bad1.");
  });

  it("a rolled-back repeat keeps the opening message, target and all", async () => {
    const { engine, seen } = scripted([rename("bad"), rename("bad"), rename("ok")]);
    const out = await runModifyLoop(base({ engine, context }));
    expect(out.kind).toBe("source");
    const third = seen[2]!;
    expect(third.messages.filter((m) => m.role === "user" && m.content.includes(SOURCE))).toHaveLength(1);
    pointedIn(third.messages[1]!.content);
  });
});

describe("the pointed-at part and the model's language travel together (#284, #306)", () => {
  it("are both in the opening message, and both again after a fresh start", async () => {
    const { engine, seen } = scripted([rename("bad1"), rename("bad2"), rename("ok")]);
    const context = { pointedAt: { words: 'the "Nights" list on the "Patterns" page', lines: [2, 2] as const, excerpt: '  id: "x",' } };
    const out = await runModifyLoop(base({ engine, context, language: "pt-BR" }));
    expect(out.kind).toBe("source");
    for (const req of [seen[0]!, seen[2]!]) {
      const opening = req.messages[1]!.content;
      expect(opening).toContain('They pointed at the "Nights" list on the "Patterns" page');
      expect(opening).toMatch(/Portuguese|português/i);
      expect(opening.split(SOURCE).length - 1).toBe(1);
    }
  });
});
