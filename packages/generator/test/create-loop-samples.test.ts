import { describe, expect, it } from "vitest";
import type { EntityDef } from "potyro";
import { runCreateLoop, type CreateLoopDeps } from "../src/agent/create-loop.js";
import type { ChatEngine, ChatRequest, ChatResponse } from "../src/chat-backend.js";
import type { RunReport } from "../src/run-report.js";
import type { LoopStep } from "../src/agent/loop.js";

// The create loop's one call for sample records (#486): once an app passed its run — and only then —
// the loop asks the model once more, through the SAME engine (so the call is metered like the loop's
// own), for plausible records in the app's shape. A reply that is not JSON, or a call that fails, is
// no samples: the app was made all the same. Engines are scripted; nothing reaches a model.

const app = (name: string) => `import { defineApp } from "potyro";\nexport default defineApp({ id: "x", name: "${name}" });`;
const fenced = (src: string) => `\`\`\`ts\n${src}\n\`\`\``;
type Turn = ChatResponse["choices"][number]["message"];

function scripted(turns: Array<Turn | Error>): { engine: ChatEngine; seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  let i = 0;
  return {
    seen,
    engine: {
      chat: {
        completions: {
          create: async (req) => {
            seen.push({ ...req, messages: [...req.messages] });
            const turn = turns[i++] ?? { content: "" };
            if (turn instanceof Error) throw turn;
            return { choices: [{ message: turn }], usage: { cost: 0.001 } };
          },
        },
      },
    },
  };
}

const check = async (): Promise<string[]> => [];
const run = async (src: string): Promise<RunReport> => ({ errors: src.includes("THROWS") ? ["computed total: ctx.nope is not a function"] : [], warnings: [], ran: "1 page" });
const PLANTS = {
  plant: { label: "Plant", fields: { name: { type: "text", label: "Plant", required: true }, light: { type: "enum", options: ["sun", "shade"] }, photo: { type: "media" } } },
} as unknown as Record<string, EntityDef>;
const ROWS = { plant: [{ id: "plant-1", name: "Monstera", light: "shade" }, { id: "plant-2", name: "Lemon tree", light: "sun" }] };
const TODAY = new Date("2026-10-31T09:00:00.000Z");

const base = (over: Partial<CreateLoopDeps>): CreateLoopDeps => ({ engine: scripted([]).engine, tools: [], system: "contract", brief: "the plants I water", check, run, today: TODAY, ...over });

describe("the create loop's sample records", () => {
  it("asks once more, through the same engine, after the app passed: the entities, today, the person's language", async () => {
    const { engine, seen } = scripted([{ content: fenced(app("Watering")) }, { content: JSON.stringify(ROWS) }]);
    const steps: LoopStep[] = [];
    const out = await runCreateLoop(base({ engine, samples: () => PLANTS, language: "pt-BR", onStep: (s) => steps.push(s) }));
    expect(out).toMatchObject({ kind: "source", candidate: 1, samples: ROWS });
    expect(seen).toHaveLength(2);
    const ask = seen[1]!;
    expect(ask.tools).toBeUndefined();
    const prompt = ask.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("Today is 2026-10-31.");
    expect(prompt).toContain('entity plant ("Plant")');
    expect(prompt).toContain('light ("Light"): one of: sun, shade');
    expect(prompt).toContain("Brazilian Portuguese");
    // A photo cannot be made up: it is not asked for.
    expect(prompt).not.toContain("photo");
    // The call says it is working, as every call does.
    expect(steps.filter((s) => s.kind === "thinking")).toHaveLength(2);
  });

  it("says nothing of the language in English, as every English turn does", async () => {
    const { engine, seen } = scripted([{ content: fenced(app("Watering")) }, { content: JSON.stringify(ROWS) }]);
    await runCreateLoop(base({ engine, samples: () => PLANTS, language: "en" }));
    expect(seen[1]!.messages.map((m) => m.content).join("\n")).not.toMatch(/Write every name/);
  });

  it("makes no call without the entities: the eval's loop, or an app whose run said nothing of them", async () => {
    const plain = scripted([{ content: fenced(app("Watering")) }, { content: JSON.stringify(ROWS) }]);
    expect(await runCreateLoop(base({ engine: plain.engine }))).not.toHaveProperty("samples");
    expect(plain.seen).toHaveLength(1);
    const none = scripted([{ content: fenced(app("Watering")) }, { content: JSON.stringify(ROWS) }]);
    expect(await runCreateLoop(base({ engine: none.engine, samples: () => undefined }))).not.toHaveProperty("samples");
    expect(none.seen).toHaveLength(1);
  });

  it("makes none for an app kept although its run threw: it did not pass", async () => {
    const { engine, seen } = scripted([{ content: fenced(app("One THROWS")) }, { content: fenced(app("Two THROWS")) }]);
    const out = await runCreateLoop(base({ engine, samples: () => PLANTS, drafts: 2, maxSteps: 2 }));
    expect(out.kind).toBe("source");
    expect(out).not.toHaveProperty("samples");
    expect(seen).toHaveLength(2);
  });

  it("a reply that is not JSON, or a call that fails, is no samples — the app is made all the same", async () => {
    const malformed = scripted([{ content: fenced(app("Watering")) }, { content: "Here are some plants: Monstera, Lemon tree" }]);
    const out = await runCreateLoop(base({ engine: malformed.engine, samples: () => PLANTS }));
    expect(out).toMatchObject({ kind: "source" });
    expect(out).not.toHaveProperty("samples");

    const failing = scripted([{ content: fenced(app("Watering")) }, new Error("402 the allowance is used up")]);
    const kept = await runCreateLoop(base({ engine: failing.engine, samples: () => PLANTS }));
    expect(kept).toMatchObject({ kind: "source" });
    expect(kept).not.toHaveProperty("samples");
  });
});
