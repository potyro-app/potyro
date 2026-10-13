import { describe, expect, it } from "vitest";
import { runModifyLoop, type ModifyLoopDeps } from "../src/agent/modify-loop.js";
import type { ChatEngine, ChatResponse } from "../src/chat-backend.js";
import { meteredEngine, newMeter, rate, refusingCheck, scriptedLoopEngine, stepTracer, summarizeLoop, wilson, type LoopRecord } from "../src/loop-eval.js";

// The modify eval's measurement parts (#277 F9): cost, causes and intervals. Scripted engines only;
// nothing here calls a model.

const SOURCE = ["export default defineApp({", '  id: "x",', "  entities: { city: {}, place: {} },", "});"].join("\n");
const base = (over: Partial<ModifyLoopDeps>): ModifyLoopDeps => ({
  engine: scriptedLoopEngine("scripted-loop"),
  tools: [{ name: "lookup", description: "look", parameters: { type: "object", properties: {} }, run: async () => ({ ok: true, detail: "found" }) }],
  system: "contract",
  instruction: "rename it",
  source: SOURCE,
  check: async () => [],
  shapeOf: async () => ({ entities: { city: {}, place: {} }, pages: [] }),
  before: { entities: { city: {}, place: {} }, pages: [] },
  ...over,
});

describe("wilson", () => {
  it("gives the 95% interval the research quotes for 48/51", () => {
    const w = wilson(48, 51)!;
    expect(Math.round(w.lo * 100)).toBe(84);
    expect(Math.round(w.hi * 100)).toBe(98);
  });

  it("stays inside 0..1 at the edges, and is null with no denominator", () => {
    expect(wilson(0, 10)!.lo).toBe(0);
    expect(wilson(10, 10)!.hi).toBeCloseTo(1, 10);
    expect(wilson(0, 0)).toBeNull();
  });

  it("is written with its counts, the rate and the interval", () => {
    expect(rate(48, 51)).toBe("48/51 (94%, 95% CI 84–98%)");
    expect(rate(0, 0)).toBe("0/0 (—)");
  });
});

describe("meteredEngine", () => {
  it("counts calls and adds up the provider's usage, and says when a call carried no cost", async () => {
    const replies: ChatResponse[] = [
      { choices: [{ message: { content: "a" } }], usage: { promptTokens: 100, completionTokens: 10, cost: 0.001 } },
      { choices: [{ message: { content: "b" } }] },
    ];
    let i = 0;
    const inner: ChatEngine = { chat: { completions: { create: async () => replies[i++]! } } };
    const meter = newMeter();
    const seen: string[] = [];
    const engine = meteredEngine(inner, meter, (text) => seen.push(text));
    await engine.chat.completions.create({ messages: [] });
    await engine.chat.completions.create({ messages: [] });
    expect(meter).toEqual({ calls: 2, promptTokens: 100, completionTokens: 10, cost: 0.001, unpriced: 1 });
    expect(seen).toEqual(["a", "b"]);
  });
});

describe("the scripted loop engines prove the harness", () => {
  it("scripted-loop: one lookup, then an edit that passes", async () => {
    const tracer = stepTracer();
    const meter = newMeter();
    const out = await runModifyLoop(base({ engine: meteredEngine(scriptedLoopEngine("scripted-loop"), meter), onStep: tracer.onStep }));
    expect(out.kind).toBe("source");
    expect(meter.calls).toBe(2);
    expect(meter.promptTokens).toBeGreaterThan(0);
    expect(tracer.read()).toMatchObject({ candidates: 1, passedOn: 1, repeats: 0 });
  });

  it("a #276-like gate refuses every candidate; the scripted model resends the same edit and the loop gives up on the second repeat", async () => {
    const tracer = stepTracer();
    const check = refusingCheck(async () => [], "maplibre-gl 4.7.1 needs a full web page to work");
    const out = await runModifyLoop(base({ check, onStep: tracer.onStep }));
    expect(out).toMatchObject({ kind: "failed", cause: "repeated" });
    expect(tracer.read()).toMatchObject({ candidates: 1, passedOn: null, repeats: 2 });
  });

  it("counts a fresh start", () => {
    const tracer = stepTracer();
    tracer.onStep({ kind: "unusable", detail: "starting again", restart: true });
    expect(tracer.read().restarts).toBe(1);
  });

  it("scripted-loop-tools: looks things up until the steps run out", async () => {
    const out = await runModifyLoop(base({ engine: scriptedLoopEngine("scripted-loop-tools"), maxSteps: 5 }));
    expect(out).toMatchObject({ kind: "failed", cause: "steps" });
  });

  it("a refusing check refuses as the compiler does: by throwing", async () => {
    await expect(refusingCheck(async () => [], "boom")("anything")).rejects.toThrow("boom");
  });
});

describe("summarizeLoop", () => {
  const rec = (over: Partial<LoopRecord>): LoopRecord => ({
    ended: "source",
    cause: null,
    calls: 2,
    promptTokens: 1000,
    completionTokens: 100,
    cost: 0.01,
    candidates: 1,
    passedOn: 1,
    repeats: 0,
    ...over,
  });

  it("counts each give-up by its cause, questions apart, and adds up tokens and cost", () => {
    const s = summarizeLoop([
      rec({}),
      rec({ ended: "failed", cause: "repeated", passedOn: null, repeats: 1, cost: 0.02 }),
      rec({ ended: "failed", cause: "candidates", candidates: 4, passedOn: null }),
      rec({ ended: "failed", cause: "steps", passedOn: null }),
      rec({ ended: "question", passedOn: null }),
      rec({ passedOn: 3, candidates: 3 }),
    ]);
    expect(s.gaveUp).toEqual({ repeated: 1, candidates: 1, steps: 1, engine: 0 });
    expect(s.asked).toBe(1);
    expect(s.calls).toBe(12);
    expect(s.promptTokens).toBe(6000);
    expect(s.completionTokens).toBe(600);
    expect(s.cost).toBeCloseTo(0.07, 10);
    expect(s.costPerCase).toBeCloseTo(0.07 / 6, 10);
    expect(s.repeatsSeen).toBe(1);
    expect(s.restarts).toBe(0);
    expect(s.passedOn).toEqual({ "1": 1, "2": 0, "3": 1, "4+": 0 });
  });

  it("counts the cases it was given", () => {
    expect(summarizeLoop([]).cases).toBe(0);
    expect(summarizeLoop([rec({})]).cases).toBe(1);
  });
});
