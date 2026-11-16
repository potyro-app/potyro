// @vitest-environment happy-dom
//
// What a version did not do of what was asked (#73), as it is kept and shown: the parts travel with
// the conversation, a version's card lists them under what it did — every version's, not only the
// current one — and the next run is told about them.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryStore } from "@potyro/store";

vi.mock("../src/open-store.js", () => ({
  openStore: async (namespace: string) => {
    const store = new MemoryStore();
    await store.open(namespace);
    return store;
  },
  accountNode: async () => null,
}));

const chat = await import("../src/studio-chat.js");
const { ThreadView } = await import("../src/studio-thread-view.js");
const { withNotDoneLine } = await import("../src/studio-summary.js");
import type { ChatItem } from "../src/studio-chat.js";
import type { ThreadViewProps } from "../src/studio-thread-view.js";
import type { AppVersion } from "../src/app-history.js";

afterEach(cleanup);
beforeEach(() => {
  globalThis.localStorage.clear();
  chat.resetChatStore();
});

const at = (n: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
const noop = () => {};
const show = (items: readonly ChatItem[], over: Partial<ThreadViewProps> = {}) =>
  render(<ThreadView items={items} app={{ id: "wine", name: "Wine Cellar" }} working={null} held={null} onOpen={noop} onGoBack={noop} onFix={noop} onKeep={noop} onLook={noop} onSuggest={noop} existing {...over} />);
const said = async () => chat.threadItems(await chat.listMessages("wine"), []);

const DID = "Grape now takes any text.";
const COUNTRY = "Country still takes only the countries in its list, because a list cannot learn new values";
const ADD = "Adding a new value to a list while scanning";

describe("a version keeps what it did not do", () => {
  it("with the conversation, and only on a version", async () => {
    await chat.appendMessage("wine", { kind: "ask", text: "do not fail on an unknown grape or country" }, at(1));
    await chat.appendMessage("wine", { kind: "version", text: DID, seq: 2, notDone: [COUNTRY, ADD] }, at(2));
    const all = await chat.listMessages("wine");
    expect(all[1]).toMatchObject({ kind: "version", text: DID, notDone: [COUNTRY, ADD] });
    expect(chat.threadItems(all, [])[1]).toMatchObject({ type: "version", notDone: [COUNTRY, ADD] });

    const read = (extra: Record<string, unknown>, kind: string) => chat.readChatMessage({ id: "m", chatId: "wine", n: 1, at: at(1), kind, text: "x", ...extra })!;
    expect("notDone" in read({ notDone: ["x"] }, "answer")).toBe(false);
    expect(read({ notDone: ["a part", 7, ""] }, "version").notDone).toEqual(["a part"]);
    expect("notDone" in read({ notDone: [] }, "version")).toBe(false);
  });

  it("a conversation kept before it existed reads as it did", () => {
    const old = { id: "m1", chatId: "wine", n: 2, at: at(1), kind: "version", text: "Grape now takes any text. Not done yet: Country stays a list", seq: 2 };
    expect(chat.readChatMessage(old)).toEqual(old);
  });

  it("the next run is told, with the version, in the loop's own word for it", async () => {
    const v = (seq: number, n: number): AppVersion => ({ id: `v${seq}`, appId: "wine", seq, createdAt: at(n), source: "", origin: "modified" }) as unknown as AppVersion;
    await chat.appendMessage("wine", { kind: "ask", text: "do not fail on an unknown grape or country" }, at(1));
    await chat.appendMessage("wine", { kind: "version", text: DID, seq: 2, notDone: [COUNTRY, ADD] }, at(2));
    await chat.appendMessage("wine", { kind: "ask", text: "and the country?" }, at(3));
    expect(chat.earlierConversation(await chat.listMessages("wine"), [v(2, 2)])).toEqual([
      { kind: "ask", text: "do not fail on an unknown grape or country" },
      { kind: "version", text: `${DID} Not done: ${COUNTRY}; ${ADD}` },
    ]);
  });

  it("a saved version's note says it in one line", () => {
    expect(withNotDoneLine(DID, [COUNTRY, ADD])).toBe(`${DID} Not done yet: ${COUNTRY}; ${ADD}`);
    expect(withNotDoneLine(DID, [])).toBe(DID);
    expect(withNotDoneLine(DID, undefined)).toBe(DID);
  });
});

describe("a version's card lists what was not done", () => {
  const made = async () => {
    await chat.appendMessage("wine", { kind: "ask", text: "do not fail on an unknown grape or country" }, at(1));
    await chat.appendMessage("wine", { kind: "version", text: DID, seq: 2, name: "Wine Cellar", notDone: [COUNTRY, ADD], assumed: ["A bottle has one grape."] }, at(2));
    return said();
  };

  it("under what it did, in the model's words, the words around them Potyro's", async () => {
    const { container } = show(await made(), { onAssumption: noop });
    const card = container.querySelector(".k-card[data-current]")!;
    const what = card.querySelector(".k-card-what")!;
    const block = card.querySelector(".k-notdone")!;
    expect(what.textContent).toBe(DID);
    expect(what.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Before the guesses: what is missing matters more than what was guessed.
    expect(block.compareDocumentPosition(card.querySelector(".k-assumed")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Not done, from what you asked:")).toBeTruthy();
    const list = screen.getByRole("list", { name: "What was not done" });
    expect([...list.querySelectorAll("li")].map((li) => li.textContent)).toEqual([COUNTRY, ADD]);
  });

  it("on an older version's card too: it is a fact about that version", async () => {
    await made();
    await chat.appendMessage("wine", { kind: "version", text: "Added a rating.", seq: 3, name: "Wine Cellar" }, at(3));
    const { container } = show(await said());
    const cards = [...container.querySelectorAll(".k-card")];
    expect(cards).toHaveLength(2);
    expect(cards[0]!.querySelector(".k-notdone")).not.toBeNull();
    expect(cards[1]!.querySelector(".k-notdone")).toBeNull();
  });

  it("a version with everything done shows no list", async () => {
    await chat.appendMessage("wine", { kind: "version", text: "Made it.", seq: 1 }, at(1));
    expect(show(await said()).container.querySelector(".k-notdone")).toBeNull();
  });

  it("a change shown as a plan lists it before Go", async () => {
    await chat.appendMessage("wine", { kind: "version", text: "Made “Wine Cellar”.", seq: 1, name: "Wine Cellar" }, at(1));
    await chat.appendMessage("wine", { kind: "ask", text: "drop the grape and the country" }, at(2));
    await chat.appendMessage("wine", { kind: "answer", text: "Removed the grape.", plan: { consequences: [] } }, at(3));
    const { container } = show(await said(), { plan: { name: "Wine Cellar", summary: "Removed the grape.", consequences: [], notDone: [COUNTRY] }, onGo: noop, onChangePlan: noop });
    const plan = container.querySelector(".k-card-plan")!;
    expect(plan.querySelector(".k-notdone-item")!.textContent).toBe(COUNTRY);
  });
});
