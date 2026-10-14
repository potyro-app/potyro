import { describe, expect, it } from "vitest";
import {
  buildConversationTool,
  conversationRecap,
  conversationRounds,
  recapCoverage,
  DEFAULT_RECAP_ROUNDS,
  type ConversationEntry,
} from "../src/agent/conversation.js";

// #279: what was said about EARLIER versions of the app reaches the modify loop as ONE consolidated
// recap (docs/19 F4), and older requests can be paged with `read_conversation`. Chat text only.

const chat: ConversationEntry[] = [
  { kind: "ask", text: "Add a rating to each session." },
  { kind: "question", text: "Stars out of 5, or a score out of 10?" },
  { kind: "ask", text: "Out of 10. Actually leave it for now." },
  { kind: "answer", text: "Okay, I didn't change anything." },
  { kind: "ask", text: "Add a page with the sunny plants." },
  { kind: "version", text: "Added a Sunny plants page." },
  { kind: "event", text: "went back to version 2" },
  { kind: "ask", text: "Text my partner when I water." },
  { kind: "refusal", text: "I didn't change the app: it cannot send texts." },
  { kind: "ask", text: "Make it purple.", about: "the Plants list" },
  { kind: "failure", text: "I couldn't make this change." },
];

describe("conversationRounds", () => {
  it("groups a request with its questions, answers and outcome, oldest first", () => {
    const rounds = conversationRounds(chat);
    expect(rounds.map((r) => r.n)).toEqual([1, 2, 3, 4, 5]);
    expect(rounds[0]!.text).toContain('They asked: "Add a rating to each session."');
    expect(rounds[0]!.text).toContain('You asked them: "Stars out of 5, or a score out of 10?"');
    expect(rounds[0]!.text).toContain('They answered: "Out of 10. Actually leave it for now."');
    expect(rounds[0]!.text).toMatch(/Nothing was changed/);
    expect(rounds[1]!.text).toMatch(/Changed: "Added a Sunny plants page."/);
    // A rollback is the person turning a version down: said as such.
    expect(rounds[2]!.text).toMatch(/went back to version 2/);
    expect(rounds[3]!.text).toMatch(/Not done/);
    expect(rounds[4]!.text).toContain("About the Plants list");
    expect(rounds[4]!.text).toMatch(/Could not be done/);
  });

  it("clips a long message, and keeps a request that never got an answer", () => {
    const rounds = conversationRounds([{ kind: "ask", text: "x".repeat(2000) }]);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.text.length).toBeLessThan(600);
    expect(rounds[0]!.text).toMatch(/no answer/i);
  });
});

describe("conversationRecap", () => {
  it("is null with nothing earlier", () => {
    expect(conversationRecap([], { rounds: 3, tool: true })).toBeNull();
  });

  it("shows the last N requests, numbered, and points at the tool for the rest", () => {
    const recap = conversationRecap(chat, { rounds: 2, tool: true })!;
    expect(recap).toMatch(/EARLIER/);
    expect(recap).toContain("#4");
    expect(recap).toContain("#5");
    expect(recap).not.toContain("#3 ");
    expect(recap).not.toContain("Add a rating");
    expect(recap).toContain("read_conversation");
    expect(recap).toMatch(/before: 4/);
  });

  it("says nothing about a tool it does not have", () => {
    const recap = conversationRecap(chat, { rounds: 2, tool: false })!;
    expect(recap).not.toContain("read_conversation");
  });

  it("shows everything when N covers it, with no pointer", () => {
    const recap = conversationRecap(chat, { rounds: 99, tool: true })!;
    expect(recap).toContain("#1");
    expect(recap).not.toContain("read_conversation");
  });

  it("with N = 0 and the tool, only says that there is more and how to read it", () => {
    const recap = conversationRecap(chat, { rounds: 0, tool: true })!;
    expect(recap).not.toContain("Add a rating");
    expect(recap).toContain("read_conversation");
    expect(recap).toMatch(/5 earlier requests/);
    expect(conversationRecap(chat, { rounds: 0, tool: false })).toBeNull();
  });

  it("keeps to a size budget by dropping the oldest requests first", () => {
    const long: ConversationEntry[] = Array.from({ length: 40 }, (_, i) => [
      { kind: "ask" as const, text: `request ${i} ${"words ".repeat(40)}` },
      { kind: "version" as const, text: `done ${i} ${"words ".repeat(40)}` },
    ]).flat();
    const recap = conversationRecap(long, { rounds: 40, tool: true })!;
    expect(recap.length).toBeLessThanOrEqual(4000);
    expect(recap).toContain("request 39");
    expect(recap).not.toContain("request 0 ");
    expect(recap).toContain("read_conversation");
  });

  it("has a default N", () => {
    expect(DEFAULT_RECAP_ROUNDS).toBeGreaterThan(0);
  });
});

describe("read_conversation", () => {
  const tool = buildConversationTool(chat, { shownFrom: 4 });

  it("pages older requests, newest of them last, and says how to go further back", async () => {
    const r = await tool.run({ before: 4, count: 2 });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("#2");
    expect(r.detail).toContain("#3");
    expect(r.detail).not.toContain("#1 ");
    expect(r.detail).not.toContain("#4");
    expect(r.detail).toMatch(/before: 2/);
  });

  it("defaults to the requests just before the recap", async () => {
    const r = await tool.run({});
    expect(r.detail).toContain("#3");
    expect(r.detail).not.toContain("#4");
  });

  it("caps how many it returns at once", async () => {
    const many: ConversationEntry[] = Array.from({ length: 30 }, (_, i) => [
      { kind: "ask" as const, text: `r${i}` },
      { kind: "answer" as const, text: `a${i}` },
    ]).flat();
    const r = await buildConversationTool(many, { shownFrom: 31 }).run({ before: 31, count: 50 });
    expect((r.detail.match(/^#\d+/gm) ?? []).length).toBeLessThanOrEqual(5);
  });

  it("says when it reached the start", async () => {
    const r = await tool.run({ before: 2, count: 3 });
    expect(r.detail).toContain("#1");
    expect(r.detail).toMatch(/start of the conversation/i);
    const none = await tool.run({ before: 1 });
    expect(none.detail).toMatch(/nothing earlier/i);
  });

  it("returns the conversation's words and nothing else", async () => {
    const withCode: ConversationEntry[] = [{ kind: "ask", text: "make it blue" }, { kind: "version", text: "Applied 1 edit." }];
    const r = await buildConversationTool(withCode, { shownFrom: 2 }).run({ before: 2 });
    const body = r.detail.split("\n").filter((l) => l.trim() && !/^(Earlier requests|That is the start)/.test(l));
    expect(body.every((l) => /make it blue|Applied 1 edit|^#1/.test(l))).toBe(true);
  });
});

describe("recapCoverage", () => {
  it("says whether the request that decides a case is inside the last N", () => {
    expect(recapCoverage(5, 2, 2)).toBe(true);
    expect(recapCoverage(5, 2, 1)).toBe(false);
    expect(recapCoverage(5, 5, 1)).toBe(false);
    expect(recapCoverage(5, 1, 5)).toBe(true);
  });
});
