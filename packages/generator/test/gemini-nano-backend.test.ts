import { describe, expect, it } from "vitest";
import { GeminiNanoBackend, SYSTEM_PROMPT_COMPACT, type PromptModel, type PromptSession } from "../src/index.js";

const GOOD = `import { defineApp } from "potyro";
export default defineApp({
  id: "todo", name: "Todo", version: "1.0.0", schemaVersion: 1,
  entities: { task: { label: "Task", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Tasks", view: { type: "list", entity: "task", display: { primary: "title" } } }],
});`;

interface Recorder {
  systemPrompts: string[];
  prompts: string[];
  destroyed: number;
}

function fakeModel(reply: (input: string) => string): { model: PromptModel; rec: Recorder } {
  const rec: Recorder = { systemPrompts: [], prompts: [], destroyed: 0 };
  const model: PromptModel = {
    availability: async () => "available",
    create: async (opts) => {
      const sys = opts?.initialPrompts?.find((p) => p.role === "system")?.content;
      if (sys) rec.systemPrompts.push(sys);
      const session: PromptSession = {
        prompt: async (input) => {
          rec.prompts.push(input);
          return reply(input);
        },
        destroy: () => {
          rec.destroyed += 1;
        },
      };
      return session;
    },
  };
  return { model, rec };
}

describe("GeminiNanoBackend", () => {
  it("seeds the contract system prompt, sends the description, strips fences, and closes the session", async () => {
    const { model, rec } = fakeModel(() => "```ts\n" + GOOD + "\n```");
    const backend = new GeminiNanoBackend(model);

    const src = await backend.generate({ id: "t", description: "a todo list" });

    expect(src).toBe(GOOD);
    // Compact on purpose: Nano's context cannot hold the full schema reference (#130).
    expect(rec.systemPrompts[0]).toBe(SYSTEM_PROMPT_COMPACT);
    expect(rec.prompts[0]).toContain("a todo list");
    expect(rec.destroyed).toBe(1); // session cleaned up
    expect(backend.name).toBe("gemini-nano");
  });

  it("folds the prior source + errors into one repair turn", async () => {
    const { model, rec } = fakeModel(() => GOOD);
    const backend = new GeminiNanoBackend(model);

    const src = await backend.repair("export default {};", ["missing entities"], { id: "t", description: "a todo list" });

    expect(src).toBe(GOOD);
    expect(rec.prompts[0]).toContain("export default {};"); // prior attempt included
    expect(rec.prompts[0]).toContain("missing entities"); // error included
    expect(rec.destroyed).toBe(1);
  });
});
