import { describe, expect, it } from "vitest";
import { createOpenRouterBackend, createOpenRouterEngine, thinkingOptions, REASONING_LEVELS, type FetchLike } from "../src/openrouter-backend.js";
import { runModifyLoop, type ModifyLoopDeps } from "../src/agent/modify-loop.js";
import type { ChatEngine, ChatRequest, ChatResponse } from "../src/chat-backend.js";

// #280: how hard the model thinks, as a level the person chooses (off / low / medium / high), and
// the loop's own escalation to `high` for the one turn after it got stuck (docs/19 F6). Reasoning
// comes out of the same `max_tokens` budget as the answer, so a level that thinks more must also
// be given more room, or the answer comes back empty.

function capture(): { fetch: FetchLike; bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = [];
  const fetch: FetchLike = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  };
  return { fetch, bodies };
}

describe("thinkingOptions", () => {
  it("off is today's default: reasoning none, the usual budget", () => {
    expect(thinkingOptions("off")).toEqual({ reasoning: { effort: "none" }, maxTokens: 32_000 });
  });

  it("raises max_tokens with every level, so thinking cannot crowd out the answer", () => {
    const budgets = REASONING_LEVELS.map((l) => thinkingOptions(l).maxTokens);
    expect(budgets).toEqual([...budgets].sort((a, b) => a - b));
    expect(new Set(budgets).size).toBe(REASONING_LEVELS.length);
    expect(thinkingOptions("high")).toMatchObject({ reasoning: { effort: "high", exclude: true } });
    expect(thinkingOptions("high").maxTokens).toBeGreaterThanOrEqual(64_000);
  });
});

describe("a level reaches the wire", () => {
  it("an engine built at a level sends its effort and its budget", async () => {
    const { fetch, bodies } = capture();
    const engine = createOpenRouterEngine({ apiKey: "k", fetch, ...thinkingOptions("medium") });
    await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }] });
    expect(bodies[0]).toMatchObject({ reasoning: { effort: "medium", exclude: true }, max_tokens: thinkingOptions("medium").maxTokens });
  });

  it("a backend built at a level (create, repair, the one-turn modify) sends them too", async () => {
    const { fetch, bodies } = capture();
    const backend = await createOpenRouterBackend({ apiKey: "k", fetch, ...thinkingOptions("high") });
    await backend.modify("export default defineApp({});", "rename it", { id: "x", description: "rename it" });
    expect(bodies[0]).toMatchObject({ reasoning: { effort: "high" }, max_tokens: thinkingOptions("high").maxTokens });
  });

  it("one request can think harder than the engine's level, with the budget to match, and the next is back to the level", async () => {
    const { fetch, bodies } = capture();
    const engine = createOpenRouterEngine({ apiKey: "k", fetch, ...thinkingOptions("off") });
    await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }], reasoning: "high" });
    await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }] });
    expect(bodies[0]).toMatchObject({ reasoning: { effort: "high" }, max_tokens: thinkingOptions("high").maxTokens });
    expect(bodies[1]).toMatchObject({ reasoning: { effort: "none" }, max_tokens: 32_000 });
  });

  it("a request never thinks LESS than the engine's level", async () => {
    const { fetch, bodies } = capture();
    const engine = createOpenRouterEngine({ apiKey: "k", fetch, ...thinkingOptions("high") });
    await engine.chat.completions.create({ messages: [{ role: "user", content: "hi" }], reasoning: "low" });
    expect(bodies[0]).toMatchObject({ reasoning: { effort: "high" }, max_tokens: thinkingOptions("high").maxTokens });
  });
});

describe("the loop thinks hard for one turn after it got stuck (F6)", () => {
  const SOURCE = ["export default defineApp({", '  id: "x",', "  entities: { city: {}, place: {} },", "});"].join("\n");
  const edit = (to: string) => ({ content: `Rename to ${to}.\n\`\`\`ts\n<<<<<<< SEARCH\n  id: "x",\n=======\n  id: "${to}",\n>>>>>>> REPLACE\n\`\`\`\n` });
  function scripted(turns: ChatResponse["choices"][number]["message"][]): { engine: ChatEngine; seen: ChatRequest[] } {
    const seen: ChatRequest[] = [];
    let i = 0;
    return { seen, engine: { chat: { completions: { create: async (req) => (seen.push(req), { choices: [{ message: turns[i++] ?? { content: "" } }] }) } } } };
  }
  const base = (over: Partial<ModifyLoopDeps>): ModifyLoopDeps => ({
    engine: scripted([]).engine,
    tools: [],
    system: "contract",
    instruction: "rename the id",
    source: SOURCE,
    check: async (src) => (/id: "ok"/.test(src) ? [] : ["id must be ok"]),
    shapeOf: async () => ({ entities: { city: {}, place: {} }, pages: [] }),
    before: { entities: { city: {}, place: {} }, pages: [] },
    ...over,
  });

  it("the turn after a rollback asks for high, once", async () => {
    const { engine, seen } = scripted([edit("bad"), edit("bad"), { content: "Hmm." }, edit("ok")]);
    const out = await runModifyLoop(base({ engine, escalate: true }));
    expect(out.kind).toBe("source");
    expect(seen.map((r) => r.reasoning)).toEqual([undefined, undefined, "high", undefined]);
  });

  it("the turn after a fresh start asks for high, once", async () => {
    const { engine, seen } = scripted([edit("b1"), edit("b2"), { content: "Hmm." }, edit("ok")]);
    const out = await runModifyLoop(base({ engine, escalate: true }));
    expect(out.kind).toBe("source");
    expect(seen.map((r) => r.reasoning)).toEqual([undefined, undefined, "high", undefined]);
  });

  it("does nothing of the kind when escalation is off", async () => {
    const { engine, seen } = scripted([edit("bad"), edit("bad"), edit("ok")]);
    await runModifyLoop(base({ engine }));
    expect(seen.every((r) => r.reasoning === undefined)).toBe(true);
  });
});
