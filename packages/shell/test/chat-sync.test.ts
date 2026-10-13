// @vitest-environment happy-dom
//
// The Studio's conversation follows you across your own devices (#283). Messages are only added, so
// merging two devices' copies is keeping every message either has, once each — by id — and leaving
// out what was forgotten. These pin that, and that only apps whose data syncs take part.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountChat, AccountChatMessage } from "@potyro/store";
import type { ChatMessage } from "../src/studio-chat.js";

vi.mock("../src/app-history.js", () => ({ recordVersion: async () => {}, clearHistory: async () => {}, listVersions: async () => [] }));
vi.mock("../src/app-diagnoses.js", () => ({ clearDiagnoses: async () => {} }));
vi.mock("../src/app-cases.js", () => ({ clearCases: async () => {} }));
vi.mock("../src/open-store.js", async () => {
  const { MemoryStore } = await import("@potyro/store");
  const s = new MemoryStore();
  await s.open("studio-chat");
  return { openStore: async () => s };
});

const { forgetChat, mergeChat, syncChat } = await import("../src/chat-sync.js");
const { appendMessage, listMessages, resetChatStore } = await import("../src/studio-chat.js");
const { saveUserApp, setUserAppSync } = await import("../src/user-apps.js");

const msg = (id: string, n: number, at: string, text: string): ChatMessage => ({ id, chatId: "notes", n, at, kind: "ask", text });

describe("merging two devices' copies of a conversation", () => {
  const a1 = msg("a1", 1, "2026-10-13T10:00:00.000Z", "first, on the laptop");
  const a2 = msg("a2", 2, "2026-10-13T10:01:00.000Z", "second, on the laptop, offline");
  const b2 = msg("b2", 2, "2026-10-13T10:02:00.000Z", "second, on the phone, offline");

  it("keeps every message either side has, once each", () => {
    const remote: AccountChat = { messages: [a1, b2], removed: [] };
    const merged = mergeChat([a1, a2], remote);
    expect(merged.add.map((m) => m.id)).toEqual(["b2"]);
    expect(merged.push.map((m) => m.id)).toEqual(["a2"]);
    expect(merged.remove).toEqual([]);
  });

  it("does nothing when both sides already agree", () => {
    expect(mergeChat([a1, a2], { messages: [a1, a2], removed: [] })).toEqual({ add: [], push: [], remove: [] });
  });

  it("drops a message forgotten elsewhere, and never sends it back", () => {
    const merged = mergeChat([a1, a2], { messages: [a1], removed: ["a2"] });
    expect(merged.remove).toEqual(["a2"]);
    expect(merged.push).toEqual([]);
  });

  it("takes a message from the account as the app's, whatever conversation it was written in", () => {
    const fromElsewhere = { ...b2, chatId: "something-else" } as unknown as AccountChatMessage;
    const merged = mergeChat([], { messages: [fromElsewhere], removed: [] }, "notes");
    expect(merged.add[0]?.chatId).toBe("notes");
  });

  it("ignores a stored entry that is not a message", () => {
    const broken = { id: "x", text: 3 } as unknown as AccountChatMessage;
    expect(mergeChat([], { messages: [broken], removed: [] }).add).toEqual([]);
  });
});

describe("syncing an app's conversation with your account", () => {
  let account: Map<string, AccountChatMessage | "">;
  const deps = () => ({
    node: async () => ({}),
    read: async (_node: unknown, appId: string): Promise<AccountChat> => {
      const out: AccountChat = { messages: [], removed: [] };
      for (const [key, v] of account) {
        const [app, id] = key.split("|");
        if (app !== appId) continue;
        if (v === "") out.removed.push(id!);
        else out.messages.push(v);
      }
      return out;
    },
    publish: async (_node: unknown, appId: string, messages: readonly AccountChatMessage[]) => {
      for (const m of messages) if (!account.has(`${appId}|${m.id}`)) account.set(`${appId}|${m.id}`, m);
      return true;
    },
  });

  beforeEach(async () => {
    localStorage.clear();
    resetChatStore();
    account = new Map();
    const s = await (await import("../src/open-store.js")).openStore("studio-chat");
    for (const r of await s.all("message")) await s.delete("message", r.id);
  });

  it("sends what this device said and brings in what another said", async () => {
    await saveUserApp({ id: "notes", name: "Notes", source: "x" }, "2026-10-13T09:00:00.000Z");
    setUserAppSync("notes", true, "2026-10-13T09:00:00.000Z");
    const mine = await appendMessage("notes", { kind: "ask", text: "said here" }, "2026-10-13T10:00:00.000Z");
    account.set("notes|elsewhere", { id: "elsewhere", n: 1, at: "2026-10-13T09:30:00.000Z", kind: "question", text: "said on the phone" });

    expect(await syncChat("notes", deps())).toBe(true);
    expect([...account.keys()].sort()).toEqual(["notes|elsewhere", `notes|${mine.id}`].sort());
    expect((await listMessages("notes")).map((m) => m.text)).toEqual(expect.arrayContaining(["said here", "said on the phone"]));

    // Again: nothing new either way.
    expect(await syncChat("notes", deps())).toBe(false);
  });

  it("leaves an app that does not sync on this device alone", async () => {
    await saveUserApp({ id: "solo", name: "Solo", source: "x" }, "2026-10-13T09:00:00.000Z");
    await appendMessage("solo", { kind: "ask", text: "stays here" }, "2026-10-13T10:00:00.000Z");
    expect(await syncChat("solo", deps())).toBe(false);
    expect(account.size).toBe(0);
  });

  it("forgets a deleted app's conversation on the account too, and never a draft's", async () => {
    const removed: Array<[string, readonly string[]]> = [];
    const d = { node: async () => ({}), remove: async (_n: unknown, appId: string, ids: readonly string[]) => (removed.push([appId, ids]), true) };
    await forgetChat("notes", ["m1", "m2"], d);
    await forgetChat("draft-abc", ["m3"], d);
    expect(removed).toEqual([["notes", ["m1", "m2"]]]);
  });

  it("does nothing where there is no account to sync with", async () => {
    await saveUserApp({ id: "notes", name: "Notes", source: "x" }, "2026-10-13T09:00:00.000Z");
    setUserAppSync("notes", true, "2026-10-13T09:00:00.000Z");
    await appendMessage("notes", { kind: "ask", text: "offline" }, "2026-10-13T10:00:00.000Z");
    expect(await syncChat("notes", { ...deps(), node: async () => null })).toBe(false);
    expect((await listMessages("notes")).map((m) => m.text)).toContain("offline");
  });
});
