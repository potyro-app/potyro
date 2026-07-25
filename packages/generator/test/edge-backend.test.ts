import { describe, expect, it } from "vitest";
import {
  HybridBackend,
  SYSTEM_PROMPT,
  WebLLMBackend,
  runEval,
  type ChatEngine,
  type ChatRequest,
  type ModelBackend,
} from "../src/index.js";

const GOOD = `import { defineApp } from "karta";
export default defineApp({
  id: "todo", name: "Todo", version: "1.0.0", schemaVersion: 1,
  entities: { task: { label: "Task", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Tasks", view: { type: "list", entity: "task", display: { primary: "title" } } }],
});`;
const BROKEN = "export default {};";

function fakeEngine(reply: (r: ChatRequest) => string): { engine: ChatEngine; reqs: ChatRequest[] } {
  const reqs: ChatRequest[] = [];
  const engine: ChatEngine = {
    chat: { completions: { create: async (r) => (reqs.push(r), { choices: [{ message: { content: reply(r) } }] }) } },
  };
  return { engine, reqs };
}

function tracker(name: string, gen: string, rep: string) {
  let genCalls = 0;
  let repCalls = 0;
  const backend: ModelBackend = {
    name,
    generate: async () => {
      genCalls += 1;
      return gen;
    },
    repair: async () => {
      repCalls += 1;
      return rep;
    },
  };
  return {
    backend,
    get genCalls() {
      return genCalls;
    },
    get repCalls() {
      return repCalls;
    },
  };
}

describe("WebLLMBackend", () => {
  it("sends the contract system prompt + the description and strips fences", async () => {
    const { engine, reqs } = fakeEngine(() => "```ts\n" + GOOD + "\n```");
    const backend = new WebLLMBackend(engine, "Qwen2.5-Coder-1.5B");

    const src = await backend.generate({ id: "t", description: "a todo list" });

    expect(src).toBe(GOOD);
    expect(reqs[0]!.messages[0]).toMatchObject({ role: "system", content: SYSTEM_PROMPT });
    expect(reqs[0]!.messages[1]!.content).toContain("a todo list");
    expect(backend.name).toBe("webllm:Qwen2.5-Coder-1.5B");
  });
});

describe("HybridBackend routing", () => {
  it("generates + repairs on edge for N attempts, then escalates to cloud", async () => {
    const edge = tracker("edge", BROKEN, BROKEN); // edge never converges
    const cloud = tracker("cloud", BROKEN, GOOD); // cloud repair fixes it
    const hybrid = new HybridBackend(edge.backend, cloud.backend, 1); // escalate after 1 edge repair

    const report = await runEval(hybrid, [{ id: "t", description: "a todo list" }], { maxRepairs: 2 });

    expect(report.validWithinN).toBe(1);
    expect(report.renders).toBe(1);
    expect(report.outcomes[0]!.repairsUsed).toBe(2);

    expect(edge.genCalls).toBe(1); // generate is always on-device
    expect(edge.repCalls).toBe(1); // one edge repair (escalateAfter = 1)
    expect(cloud.genCalls).toBe(0); // cloud never generates
    expect(cloud.repCalls).toBe(1); // escalated repair went to cloud
    expect(hybrid.name).toContain("hybrid");
  });
});
