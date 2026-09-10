import { describe, expect, it } from "vitest";
import {
  ClaudeBackend,
  SYSTEM_PROMPT,
  extractSource,
  runEval,
  type CreateParams,
  type MessagesClient,
} from "../src/index.js";

// Drives the cloud backend with an injected fake client — no API key, deterministic.

const GOOD = `import { defineApp } from "karta";
export default defineApp({
  id: "todo", name: "Todo", version: "1.0.0", schemaVersion: 1,
  entities: { task: { label: "Task", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Tasks", view: { type: "list", entity: "task", display: { primary: "title" } } }],
});`;

function fakeClient(reply: (p: CreateParams) => string): { client: MessagesClient; calls: CreateParams[] } {
  const calls: CreateParams[] = [];
  const client: MessagesClient = {
    messages: {
      create: async (p) => {
        calls.push(p);
        return { content: [{ type: "text", text: reply(p) }] };
      },
    },
  };
  return { client, calls };
}

describe("extractSource", () => {
  it("strips a ```ts code fence", () => {
    expect(extractSource("intro\n```ts\nconst a = 1;\n```\noutro")).toBe("const a = 1;");
  });
  it("returns trimmed text when there is no fence", () => {
    expect(extractSource("  const a = 1;  ")).toBe("const a = 1;");
  });
});

describe("ClaudeBackend prompt assembly", () => {
  it("generate sends the contract system prompt + the description and strips fences", async () => {
    const { client, calls } = fakeClient(() => "```ts\n" + GOOD + "\n```");
    const backend = new ClaudeBackend(client, "claude-opus-4-8");

    const src = await backend.generate({ id: "t", description: "a simple todo list" });

    expect(src).toBe(GOOD);
    expect(calls[0]!.system).toBe(SYSTEM_PROMPT);
    expect(calls[0]!.model).toBe("claude-opus-4-8");
    expect(calls[0]!.messages[0]!.content).toContain("a simple todo list");
    expect(backend.name).toBe("claude:claude-opus-4-8");
  });

  it("repair feeds back the prior source and the errors", async () => {
    const { client, calls } = fakeClient(() => "```ts\n" + GOOD + "\n```");
    const backend = new ClaudeBackend(client);

    await backend.repair("BROKEN SOURCE", ["validate: boom"], { id: "t", description: "x" });

    const msgs = calls[0]!.messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[1]).toMatchObject({ role: "assistant" });
    expect(msgs[1]!.content).toContain("BROKEN SOURCE");
    expect(msgs[2]!.content).toContain("validate: boom");
  });

  it("modify feeds back the current source and the change instruction", async () => {
    const { client, calls } = fakeClient(() => "```ts\n" + GOOD + "\n```");
    const backend = new ClaudeBackend(client);

    const src = await backend.modify("CURRENT SOURCE", "add a 5-star rating field", { id: "t", description: "books" });

    // The reply comes back untouched: `guardedModify` reads it (edits, a whole file, or a verdict),
    // so a backend that extracted source here would throw the edits away.
    expect(src).toBe("```ts\n" + GOOD + "\n```");
    const msgs = calls[0]!.messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[1]).toMatchObject({ role: "assistant" });
    expect(msgs[1]!.content).toContain("CURRENT SOURCE"); // the app being adapted
    expect(msgs[2]!.content).toContain("add a 5-star rating field"); // the change, not framed as an error
  });
});

describe("ClaudeBackend drives the KA-06 eval repair loop", () => {
  it("repairs an initially-invalid app into a passing one", async () => {
    // generate() → 1 message (invalid); repair() → 3 messages (valid).
    const { client } = fakeClient((p) => (p.messages.length >= 3 ? "```ts\n" + GOOD + "\n```" : "export default {};"));
    const backend = new ClaudeBackend(client);

    const report = await runEval(backend, [{ id: "t", description: "a simple todo list" }], { maxRepairs: 2 });

    expect(report.singlePassValid).toBe(0);
    expect(report.validWithinN).toBe(1);
    expect(report.renders).toBe(1);
    expect(report.outcomes[0]!.repairsUsed).toBe(1);
  });
});
