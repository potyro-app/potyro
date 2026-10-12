// @vitest-environment happy-dom
//
// The Studio's conversation is a record of its own (#261). Before it, the thread was rebuilt from
// version notes, so everything that did NOT produce a version — the agent's questions, the person's
// answers, a refusal — was gone the moment the Studio closed. These drive the real module with only
// the durable-store factory faked, as app-history.test.ts does.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@potyro/store";

vi.mock("../src/open-store.js", () => ({
  openStore: async (namespace: string) => {
    const store = new MemoryStore();
    await store.open(namespace);
    return store;
  },
}));

const chat = await import("../src/studio-chat.js");
const { resetHistoryStore } = await import("../src/app-history.js");
const { saveUserApp, removeUserApp } = await import("../src/user-apps.js");
import type { AppVersion } from "../src/app-history.js";

const at = (n: number): string => new Date(Date.UTC(2026, 0, n)).toISOString();

beforeEach(() => {
  globalThis.localStorage.clear();
  chat.resetChatStore();
  resetHistoryStore();
});

describe("the record", () => {
  it("keeps every message in order, questions and refusals included", async () => {
    await chat.appendMessage("reader", { kind: "ask", text: "a reading tracker" }, at(1));
    await chat.appendMessage("reader", { kind: "question", text: "Do you want to rate the books?" }, at(2));
    await chat.appendMessage("reader", { kind: "ask", text: "yes, five stars" }, at(3));
    await chat.appendMessage("reader", { kind: "version", text: "Created it.", seq: 1, name: "Reader" }, at(4));
    await chat.appendMessage("reader", { kind: "refusal", text: "That needs the platform." }, at(5));

    const all = await chat.listMessages("reader");
    expect(all.map((m) => [m.n, m.kind, m.text])).toEqual([
      [1, "ask", "a reading tracker"],
      [2, "question", "Do you want to rate the books?"],
      [3, "ask", "yes, five stars"],
      [4, "version", "Created it."],
      [5, "refusal", "That needs the platform."],
    ]);
    expect(all[3]).toMatchObject({ seq: 1, name: "Reader" });
  });

  it("keeps one chat apart from another", async () => {
    await chat.appendMessage("a", { kind: "ask", text: "one" }, at(1));
    await chat.appendMessage("b", { kind: "ask", text: "two" }, at(2));
    expect((await chat.listMessages("a")).map((m) => m.text)).toEqual(["one"]);
  });
});

describe("drafts", () => {
  it("a conversation with no app yet is a draft, titled by what was first asked", async () => {
    const id = chat.newDraftId();
    expect(chat.isDraftId(id)).toBe(true);
    await chat.appendMessage(id, { kind: "ask", text: "something to track my plants and when I water them" }, at(1));
    await chat.appendMessage(id, { kind: "question", text: "Indoor or outdoor?" }, at(2));

    const drafts = await chat.listDrafts();
    expect(drafts).toEqual([{ id, title: "something to track my plants and when I water them", updatedAt: at(2) }]);
  });

  it("an opened draft nobody wrote in is not a draft", async () => {
    chat.newDraftId();
    expect(await chat.listDrafts()).toEqual([]);
  });

  it("becomes the app's conversation when the app is made, and stops being a draft", async () => {
    const id = chat.newDraftId();
    await chat.appendMessage(id, { kind: "ask", text: "a reading tracker" }, at(1));
    await chat.adoptDraft(id, "reader");

    expect(await chat.listDrafts()).toEqual([]);
    expect((await chat.listMessages("reader")).map((m) => m.text)).toEqual(["a reading tracker"]);
    // And the next message continues the numbering rather than starting again.
    const next = await chat.appendMessage("reader", { kind: "version", text: "Created it.", seq: 1 }, at(2));
    expect(next.n).toBe(2);
  });

  it("is deleted only when the person deletes it", async () => {
    const id = chat.newDraftId();
    await chat.appendMessage(id, { kind: "ask", text: "a reading tracker" }, at(1));
    await chat.clearChat(id);
    expect(await chat.listDrafts()).toEqual([]);
  });
});

describe("an app's thread", () => {
  const version = (seq: number, extra: Partial<AppVersion>): AppVersion => ({
    id: `v${seq}`,
    appId: "notes",
    seq,
    source: `s${seq}`,
    createdAt: at(seq),
    origin: "edited",
    ...extra,
  });

  it("an app made before the record existed reads its history as the conversation", () => {
    const items = chat.threadItems(
      [],
      [version(2, { note: "add a tag", rationale: "Applied 1 edit." }), version(1, { origin: "created", note: "example app" })],
    );
    expect(items.map((i) => [i.type, "text" in i ? i.text : ""])).toEqual([
      ["event", "example app"],
      ["ask", "add a tag"],
      ["version", "Applied 1 edit."],
    ]);
  });

  it("a version the conversation already tells is not told twice", () => {
    const items = chat.threadItems(
      [
        { id: "m1", chatId: "notes", n: 1, at: at(1), kind: "ask", text: "a notes app" },
        { id: "m2", chatId: "notes", n: 2, at: at(1), kind: "version", text: "Created it.", seq: 1, name: "Notes" },
      ],
      [version(1, { origin: "created", note: "a notes app" })],
    );
    expect(items.map((i) => i.type)).toEqual(["ask", "version"]);
  });

  it("a change made outside the Studio still shows up, where it happened in time", () => {
    const items = chat.threadItems(
      [
        { id: "m1", chatId: "notes", n: 1, at: at(1), kind: "ask", text: "a notes app" },
        { id: "m2", chatId: "notes", n: 2, at: at(1), kind: "version", text: "Created it.", seq: 1 },
        { id: "m3", chatId: "notes", n: 3, at: at(5), kind: "ask", text: "add a date" },
      ],
      [version(2, { origin: "adjusted", note: "renamed the page to Jottings", createdAt: at(3) }), version(1, { origin: "created" })],
    );
    expect(items.map((i) => ("text" in i ? i.text : ""))).toEqual(["a notes app", "Created it.", "renamed the page to Jottings", "add a date"]);
  });

  it("marks the newest version as the current one", () => {
    const items = chat.threadItems([], [version(2, { note: "b" }), version(1, { note: "a" })]);
    const cards = items.filter((i) => i.type === "version");
    expect(cards.map((c) => (c.type === "version" ? [c.seq, c.current] : null))).toEqual([
      [1, false],
      [2, true],
    ]);
  });
});

describe("what the agent is told", () => {
  it("everything since the last version, with its own questions, in order", () => {
    const brief = chat.briefSince([
      { kind: "ask", text: "a notes app" },
      { kind: "version", text: "Created it.", seq: 1 },
      { kind: "ask", text: "add tags" },
      { kind: "question", text: "Free text or a fixed list?" },
      { kind: "ask", text: "a fixed list: work, home" },
    ]);
    expect(brief).toBe("add tags\n\nYou asked: Free text or a fixed list?\nThe answer: a fixed list: work, home");
  });

  it("a single request is passed as it was typed", () => {
    expect(chat.briefSince([{ kind: "ask", text: "a reading tracker" }])).toBe("a reading tracker");
  });
});

describe("sharing how an app was made", () => {
  it("travels as a portable record and lands as the receiver's conversation", async () => {
    await chat.appendMessage("reader", { kind: "ask", text: "a reading tracker" }, at(1));
    await chat.appendMessage("reader", { kind: "version", text: "Created it.", seq: 1, name: "Reader" }, at(2));
    const record = await chat.exportChat("reader");
    expect(record).toEqual({
      format: "potyro-chat/1",
      messages: [
        { at: at(1), kind: "ask", text: "a reading tracker" },
        { at: at(2), kind: "version", text: "Created it.", seq: 1, name: "Reader" },
      ],
    });

    await chat.importChat("reader-2", record, at(9));
    const landed = await chat.listMessages("reader-2");
    expect(landed.map((m) => [m.kind, m.text])).toEqual([
      ["ask", "a reading tracker"],
      ["version", "Created it."],
      // Said where it came from, so the receiver's own requests are not mistaken for the author's.
      ["event", "how it was made, as shared by its author"],
    ]);
  });

  it("refuses anything that is not a conversation", () => {
    expect(chat.parseChatRecord({ format: "potyro-chat/1", messages: [{ kind: "ask", text: "x", at: at(1) }] })).not.toBeNull();
    expect(chat.parseChatRecord({ format: "other" })).toBeNull();
    expect(chat.parseChatRecord({ format: "potyro-chat/1", messages: [{ kind: "rm -rf", text: "x" }] })).toBeNull();
  });
});

describe("deleting the app", () => {
  it("deletes its conversation too, so an app later given the same id does not inherit it", async () => {
    await saveUserApp({ id: "notes", name: "Notes", source: "x" }, at(1));
    await chat.appendMessage("notes", { kind: "ask", text: "a notes app" }, at(1));
    await removeUserApp("notes");
    expect(await chat.listMessages("notes")).toEqual([]);
  });
});
