import { describe, expect, it } from "vitest";
import { runModifyLoop, type ModifyLoopDeps } from "../src/agent/modify-loop.js";
import type { AgentTool } from "../src/agent/tools.js";
import type { ConversationEntry } from "../src/agent/conversation.js";
import type { ChatEngine, ChatRequest, ChatResponse } from "../src/chat-backend.js";

// #279: the earlier conversation reaches the loop's single opening message as a recap, and older
// requests are paged with `read_conversation`. Engines are scripted; nothing calls a model.

const SOURCE = ["export default defineApp({", '  id: "x",', "  entities: { session: {} },", "});"].join("\n");
const edit = (prose: string, search: string, replace: string) => `${prose}\n\`\`\`ts\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n\`\`\`\n`;
const rename = (to: string) => ({ content: edit(`Rename to ${to}.`, '  id: "x",', `  id: "${to}",`) });
const read = (args: Record<string, unknown>, id = `r${Math.random()}`) => ({
  content: "",
  tool_calls: [{ id, type: "function" as const, function: { name: "read_conversation", arguments: JSON.stringify(args) } }],
});

type Turn = ChatResponse["choices"][number]["message"];
function scripted(turns: Turn[]): { engine: ChatEngine; seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  let i = 0;
  return {
    seen,
    engine: { chat: { completions: { create: async (req) => (seen.push({ ...req, messages: [...req.messages] }), { choices: [{ message: turns[i++] ?? { content: "" } }] }) } } },
  };
}

const picky = async (src: string): Promise<string[]> => (/id: "(ok|good)"/.test(src) || src === SOURCE ? [] : [`id must be "ok"`]);

const base = (over: Partial<ModifyLoopDeps>): ModifyLoopDeps => ({
  engine: scripted([]).engine,
  tools: [],
  system: "contract",
  instruction: "Ok, now add the rating to each session.",
  source: SOURCE,
  check: picky,
  shapeOf: async () => ({ entities: { session: {} }, pages: [] }),
  before: { entities: { session: {} }, pages: [] },
  ...over,
});

const RATING: ConversationEntry[] = [
  { kind: "ask", text: "Add a rating to each session." },
  { kind: "question", text: "Stars out of 5, or a score out of 10?" },
  { kind: "ask", text: "Out of 10, I score everything out of 10. Actually leave it for now." },
  { kind: "answer", text: "Okay, I didn't change anything." },
];

/** Ten earlier requests, the one that matters first. */
const LONG: ConversationEntry[] = [
  { kind: "ask", text: "Never add pages, the menu is long enough." },
  { kind: "version", text: "Okay." },
  ...Array.from({ length: 9 }, (_, i) => [
    { kind: "ask" as const, text: `small change ${i + 2}` },
    { kind: "version" as const, text: `done ${i + 2}` },
  ]).flat(),
];

const occurrences = (req: ChatRequest, needle: string) => req.messages.reduce((k, m) => k + m.content.split(needle).length - 1, 0);

describe("the earlier conversation in the opening message (#279)", () => {
  it("is one recap, before the app, with the current request after it — and the app is there once", async () => {
    const { engine, seen } = scripted([rename("ok")]);
    await runModifyLoop(base({ engine, conversation: RATING }));
    const opening = seen[0]!.messages[1]!.content;
    expect(seen[0]!.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(opening).toContain("WHAT WAS SAID EARLIER");
    // The earlier answer reaches the model beside the question it answered.
    expect(opening).toContain("Stars out of 5, or a score out of 10?");
    expect(opening).toContain("Out of 10, I score everything out of 10.");
    const recapAt = opening.indexOf("WHAT WAS SAID EARLIER");
    const appAt = opening.indexOf(SOURCE);
    const requestAt = opening.indexOf("Ok, now add the rating");
    expect(recapAt).toBeLessThan(appAt);
    expect(appAt).toBeLessThan(requestAt);
    expect(occurrences(seen[0]!, SOURCE)).toBe(1);
  });

  it("with nothing earlier, the opening message is as it was", async () => {
    const a = scripted([rename("ok")]);
    const b = scripted([rename("ok")]);
    await runModifyLoop(base({ engine: a.engine }));
    await runModifyLoop(base({ engine: b.engine, conversation: [] }));
    expect(b.seen[0]!.messages[1]!.content).toBe(a.seen[0]!.messages[1]!.content);
    expect(b.seen[0]!.tools?.map((t) => t.function.name)).not.toContain("read_conversation");
  });

  it("can be switched off, for the eval's ablations", async () => {
    const { engine, seen } = scripted([rename("ok")]);
    await runModifyLoop(base({ engine, conversation: LONG, conversationAccess: { recapRounds: 0, tool: false } }));
    expect(seen[0]!.messages[1]!.content).not.toContain("small change");
    expect(seen[0]!.tools?.map((t) => t.function.name) ?? []).not.toContain("read_conversation");
  });

  it("survives a fresh start and a rollback", async () => {
    // Two candidates turned back → a fresh chain; then a repeat → rolled back.
    const { engine, seen } = scripted([rename("bad1"), rename("bad2"), rename("bad3"), rename("bad3"), rename("ok")]);
    const out = await runModifyLoop(base({ engine, conversation: RATING }));
    expect(out.kind).toBe("source");
    for (const req of seen) {
      const opening = req.messages.find((m) => m.role === "user")!.content;
      expect(opening).toContain("Out of 10, I score everything out of 10.");
      expect(occurrences(req, SOURCE)).toBe(1);
      expect(occurrences(req, "WHAT WAS SAID EARLIER")).toBe(1);
    }
  });
});

describe("read_conversation (#279)", () => {
  it("is offered when the recap left requests out, and pages them on demand", async () => {
    const { engine, seen } = scripted([read({}), read({ before: 3, count: 2 }), rename("ok")]);
    await runModifyLoop(base({ engine, conversation: LONG, conversationAccess: { recapRounds: 3 } }));
    expect(seen[0]!.tools?.map((t) => t.function.name)).toContain("read_conversation");
    const opening = seen[0]!.messages[1]!.content;
    // The recap shows the last three; the first request is not in it.
    expect(opening).toContain("small change 10");
    expect(opening).not.toContain("Never add pages");
    expect(opening).toContain("read_conversation({ before: 8 })");
    const first = seen[1]!.messages.at(-1)!;
    expect(first.role).toBe("tool");
    expect(first.content).toContain("#7");
    expect(first.content).toContain("#5");
    expect(first.content).not.toContain("#8");
    expect(first.content).not.toContain("Never add pages");
    const second = seen[2]!.messages.at(-1)!;
    expect(second.content).toContain("Never add pages");
    expect(second.content).toContain("#2");
    expect(second.content).toMatch(/start of the conversation/);
    // Only the conversation's words: never the app.
    expect(second.content).not.toContain("defineApp");
  });

  it("is not offered when the recap shows everything", async () => {
    const { engine, seen } = scripted([rename("ok")]);
    await runModifyLoop(base({ engine, conversation: RATING }));
    expect(seen[0]!.tools?.map((t) => t.function.name) ?? []).not.toContain("read_conversation");
  });

  it("alone (no recap), the opening message only says there is a conversation to read", async () => {
    const { engine, seen } = scripted([read({}), rename("ok")]);
    await runModifyLoop(base({ engine, conversation: LONG, conversationAccess: { recapRounds: 0, tool: true } }));
    const opening = seen[0]!.messages[1]!.content;
    expect(opening).toMatch(/10 earlier requests/);
    expect(opening).not.toContain("small change");
    expect(seen[1]!.messages.at(-1)!.content).toContain("small change 10");
  });

  it("reading the conversation is not looking at the app: a refusal after it is still sent to the tools", async () => {
    const lookup: AgentTool = { name: "lookup", description: "", parameters: {}, run: async () => ({ ok: true, detail: "x" }) };
    const { engine, seen } = scripted([read({}), { content: "NOT-IN-APP: no." }, { content: "NOT-IN-APP: no." }]);
    const out = await runModifyLoop(base({ engine, tools: [lookup], conversation: LONG, conversationAccess: { recapRounds: 3 } }));
    expect(out.kind).toBe("diagnosis");
    expect(seen.at(-1)!.messages.at(-1)!.content).toMatch(/Before answering NOT-IN-APP/);
  });
});
