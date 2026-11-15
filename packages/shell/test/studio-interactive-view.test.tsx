// @vitest-environment happy-dom
//
// The interactive session as it is kept and shown (#75): a question's choices and a version's guesses
// travel with the conversation and are buttons on screen; a plan is a card with Go; and a conversation
// kept before any of this existed still reads as it did.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
const said = async (chatId = "wine") => chat.threadItems(await chat.listMessages(chatId), []);
const OPTIONS = ["Euros", "Dollars", "Each bottle says its own"];

describe("the conversation keeps what #75 adds, and reads what was kept before it", () => {
  it("a question keeps its choices; a version, its guesses; an answer, that it was a plan", async () => {
    await chat.appendMessage("wine", { kind: "ask", text: "add a price" }, at(1));
    await chat.appendMessage("wine", { kind: "question", text: "Which currency?", options: OPTIONS, allowOther: false }, at(2));
    await chat.appendMessage("wine", { kind: "ask", text: "Euros" }, at(3));
    await chat.appendMessage("wine", { kind: "version", text: "Each bottle has a price.", seq: 2, assumed: ["A bottle has one price."] }, at(4));
    await chat.appendMessage("wine", { kind: "ask", text: "drop the grape" }, at(5));
    await chat.appendMessage("wine", { kind: "answer", text: "Removed from “Bottle”: the “Grape” field.", plan: { consequences: ["2 records of “Bottle” will lose what is in “Grape”."] } }, at(6));

    const all = await chat.listMessages("wine");
    expect(all[1]).toMatchObject({ kind: "question", options: OPTIONS, allowOther: false });
    expect(all[3]).toMatchObject({ kind: "version", assumed: ["A bottle has one price."] });
    expect(all[5]).toMatchObject({ kind: "answer", plan: { consequences: ["2 records of “Bottle” will lose what is in “Grape”."] } });
    const items = chat.threadItems(all, []);
    expect(items[1]).toMatchObject({ type: "agent", tone: "question", options: OPTIONS, allowOther: false });
    expect(items[3]).toMatchObject({ type: "version", assumed: ["A bottle has one price."] });
    expect(items[5]).toMatchObject({ type: "agent", tone: "answer", plan: { consequences: [expect.any(String)] } });
  });

  it("a conversation kept before these fields existed still loads, with none of them", () => {
    const old = { id: "m1", chatId: "wine", n: 2, at: at(1), kind: "question", text: "Indoor plants, or a garden?" };
    expect(chat.readChatMessage(old)).toEqual(old);
    const version = { id: "m2", chatId: "wine", n: 3, at: at(2), kind: "version", text: "Made it.", seq: 1, name: "Wine Cellar" };
    expect(chat.readChatMessage(version)).toEqual(version);
  });

  it("fields that are not what they say are left out, never trusted: they may come from another device", () => {
    const read = (extra: Record<string, unknown>, kind = "question") => chat.readChatMessage({ id: "m", chatId: "wine", n: 1, at: at(1), kind, text: "x", ...extra })!;
    // One choice is no choice; choices on something that is not a question are not choices.
    expect("options" in read({ options: ["only"] })).toBe(false);
    expect("options" in read({ options: "Euros" })).toBe(false);
    expect(read({ options: ["a", 3, "", "b"] }).options).toEqual(["a", "b"]);
    expect("options" in read({ options: ["a", "b"] }, "answer")).toBe(false);
    expect("assumed" in read({ assumed: ["x"] }, "ask")).toBe(false);
    expect(read({ assumed: ["a guess", 7] }, "version").assumed).toEqual(["a guess"]);
    expect(read({ plan: { consequences: "all of it" } }, "answer").plan).toEqual({ consequences: [] });
  });

  it("counts the questions the open request has had", () => {
    const kinds = (...k: string[]) => k.map((kind) => ({ kind })) as Array<{ kind: chat.ChatKind }>;
    expect(chat.questionsAsked(kinds("ask"))).toBe(0);
    expect(chat.questionsAsked(kinds("ask", "question", "ask"))).toBe(1);
    expect(chat.questionsAsked(kinds("ask", "question", "ask", "question", "ask"))).toBe(2);
    // A version, a refusal or a failure closes a request: the next one starts from none.
    expect(chat.questionsAsked(kinds("ask", "question", "ask", "version", "ask"))).toBe(0);
    expect(chat.questionsAsked(kinds("ask", "question", "ask", "failure", "ask", "question", "ask"))).toBe(1);
  });

  it("the next run is told what the LAST version guessed, and a plan that became a version is said once", async () => {
    const v = (seq: number, n: number): AppVersion => ({ id: `v${seq}`, appId: "wine", seq, createdAt: at(n), source: "", origin: "modified" }) as unknown as AppVersion;
    await chat.appendMessage("wine", { kind: "ask", text: "a wine cellar" }, at(1));
    await chat.appendMessage("wine", { kind: "version", text: "Made “Wine Cellar”.", seq: 1, assumed: ["A bottle has one grape."] }, at(2));
    await chat.appendMessage("wine", { kind: "ask", text: "drop the grape" }, at(3));
    await chat.appendMessage("wine", { kind: "answer", text: "Removed the grape.", plan: { consequences: [] } }, at(4));
    await chat.appendMessage("wine", { kind: "version", text: "Removed the grape.", seq: 2, assumed: ["Nothing else uses the grape."] }, at(5));
    await chat.appendMessage("wine", { kind: "ask", text: "add a price" }, at(6));
    await chat.appendMessage("wine", { kind: "answer", text: "Added a price, and four pages.", plan: { consequences: [] } }, at(7));
    await chat.appendMessage("wine", { kind: "ask", text: "fewer pages" }, at(8));

    const earlier = chat.earlierConversation(await chat.listMessages("wine"), [v(2, 5), v(1, 2)]);
    expect(earlier).toEqual([
      { kind: "ask", text: "a wine cellar" },
      // An older version's guesses are not the ones in front of the person.
      { kind: "version", text: "Made “Wine Cellar”." },
      { kind: "ask", text: "drop the grape" },
      { kind: "version", text: "Removed the grape.", assumed: ["Nothing else uses the grape."] },
    ]);
  });
});

describe("a question that waits shows its answers as buttons", () => {
  const ask = async (extra: { options?: string[]; allowOther?: boolean } = { options: OPTIONS }) => {
    await chat.appendMessage("wine", { kind: "ask", text: "add a price" }, at(1));
    await chat.appendMessage("wine", { kind: "question", text: "Which currency are the prices in?", ...extra }, at(2));
    return said();
  };

  it("each choice is a real button; one tap answers with its words", async () => {
    const onAnswer = vi.fn();
    const { container } = show(await ask(), { onAnswer });
    // The question keeps the mark specs and screen readers already find it by.
    expect(container.querySelector('.k-thread-answer[data-tone="question"]')!.textContent).toContain("Which currency are the prices in?");
    const list = screen.getByRole("list", { name: "Answers to choose from" });
    const buttons = [...list.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(OPTIONS);
    expect(buttons.every((b) => b.getAttribute("type") === "button" && b.tabIndex === 0)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Dollars" }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("Dollars");
    expect(screen.getByText("Or answer in your own words below.")).toBeTruthy();
  });

  it("when only the choices are asked for, the box is not offered as another way", async () => {
    show(await ask({ options: OPTIONS, allowOther: false }), { onAnswer: noop });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(OPTIONS);
    expect(screen.queryByText("Or answer in your own words below.")).toBeNull();
  });

  it("a question with no choices is the question, as before", async () => {
    const { container } = show(await ask({}), { onAnswer: noop });
    expect(container.querySelector(".k-question")).toBeNull();
    expect(container.querySelector('.k-thread-answer[data-tone="question"]')).not.toBeNull();
  });

  it("once answered, or while the agent works, its choices are no longer buttons", async () => {
    const items = await ask();
    const working = show(items, { onAnswer: noop, working: "Thinking" });
    expect(working.container.querySelector(".k-question")).toBeNull();
    cleanup();
    await chat.appendMessage("wine", { kind: "ask", text: "Euros" }, at(3));
    const answered = show(await said(), { onAnswer: noop });
    expect(answered.container.querySelector(".k-question")).toBeNull();
    expect(screen.getByText("Which currency are the prices in?")).toBeTruthy();
  });

  it("with nowhere to send an answer, the choices are not offered", async () => {
    const { container } = show(await ask());
    expect(container.querySelector(".k-question")).toBeNull();
  });
});

describe("a version's card lists what was guessed", () => {
  const made = async () => {
    await chat.appendMessage("wine", { kind: "ask", text: "a wine cellar" }, at(1));
    await chat.appendMessage("wine", { kind: "version", text: "Made “Wine Cellar”.", seq: 1, name: "Wine Cellar", assumed: ["Prices are in euros.", "A bottle has one photo."] }, at(2));
    return said();
  };

  it("under the explanation, each guess a button that hands its words over", async () => {
    const onAssumption = vi.fn();
    const { container } = show(await made(), { onAssumption });
    const card = container.querySelector(".k-card[data-current]")!;
    const what = card.querySelector(".k-card-what")!;
    const guesses = card.querySelector(".k-assumed")!;
    // After what changed, inside the same card.
    expect(what.compareDocumentPosition(guesses) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("I guessed these. Tap one to change it.")).toBeTruthy();
    const list = screen.getByRole("list", { name: "What was guessed" });
    expect([...list.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Prices are in euros.", "A bottle has one photo."]);
    fireEvent.click(screen.getByRole("button", { name: "A bottle has one photo." }));
    expect(onAssumption).toHaveBeenCalledWith("A bottle has one photo.");
  });

  it("only the current version's: an older card's guesses are not the app's any more", async () => {
    await made();
    await chat.appendMessage("wine", { kind: "version", text: "Added a rating.", seq: 2, name: "Wine Cellar" }, at(3));
    const { container } = show(await said(), { onAssumption: noop });
    expect(container.querySelector(".k-assumed")).toBeNull();
  });

  it("a card with nothing guessed shows no list", async () => {
    await chat.appendMessage("wine", { kind: "version", text: "Made it.", seq: 1 }, at(1));
    expect(show(await said(), { onAssumption: noop }).container.querySelector(".k-assumed")).toBeNull();
  });
});

describe("a change that is not small is a plan first", () => {
  const SUMMARY = "Removed from “Bottle”: the “Grape” field.";
  const CONSEQUENCE = "2 records of “Bottle” will lose what is in “Grape”.";
  const planned = async () => {
    await chat.appendMessage("wine", { kind: "version", text: "Made “Wine Cellar”.", seq: 1, name: "Wine Cellar" }, at(1));
    await chat.appendMessage("wine", { kind: "ask", text: "drop the grape" }, at(2));
    await chat.appendMessage("wine", { kind: "answer", text: SUMMARY, plan: { consequences: [CONSEQUENCE] } }, at(3));
    return said();
  };
  const plan = { name: "Wine Cellar", summary: SUMMARY, consequences: [CONSEQUENCE] };

  it("the card says what will change and what happens to the records, with Go and Change something", async () => {
    const onGo = vi.fn();
    const onChangePlan = vi.fn();
    const { container } = show(await planned(), { plan, onGo, onChangePlan });
    const card = container.querySelector(".k-card-plan")!;
    expect(card.getAttribute("aria-label")).toBe("Wine Cellar, a change not saved yet");
    expect(card.querySelector(".k-card-what")!.textContent).toBe(SUMMARY);
    expect(screen.getByRole("list", { name: "What happens to what you have entered" }).textContent).toBe(CONSEQUENCE);
    // Said once: the plan's words are its card, not a line above it as well.
    expect(screen.getAllByText(SUMMARY)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onGo).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Change something" }));
    expect(onChangePlan).toHaveBeenCalledTimes(1);
    // It is not a version: the app's current card is still the one before it.
    expect(container.querySelectorAll(".k-card[data-current]")).toHaveLength(1);
    expect(card.hasAttribute("data-current")).toBe(false);
  });

  it("while the agent works, Go waits", async () => {
    show(await planned(), { plan, onGo: noop, onChangePlan: noop, working: "Thinking" });
    expect((screen.getByRole("button", { name: "Go" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a plan with nothing to say of the records shows no such list", async () => {
    show(await planned(), { plan: { ...plan, consequences: [] }, onGo: noop, onChangePlan: noop });
    expect(screen.queryByRole("list", { name: "What happens to what you have entered" })).toBeNull();
  });

  it("the Studio was closed before Go: the plan is gone, and the conversation says it was not saved", async () => {
    const { container } = show(await planned());
    expect(container.querySelector(".k-card-plan")).toBeNull();
    expect(screen.getByText(SUMMARY)).toBeTruthy();
    expect(screen.getByText("This change was not saved. Ask again and I’ll make it.")).toBeTruthy();
  });

  it("Go made it a version: its words are said once, by the version's card", async () => {
    await planned();
    await chat.appendMessage("wine", { kind: "version", text: SUMMARY, seq: 2, name: "Wine Cellar" }, at(4));
    const { container } = show(await said());
    expect(screen.getAllByText(SUMMARY)).toHaveLength(1);
    expect(container.querySelector(".k-plan-gone")).toBeNull();
    expect(container.querySelector(".k-card[data-current] .k-card-what")!.textContent).toBe(SUMMARY);
  });

  it("a plan the conversation could not keep still shows, so it can still be answered", () => {
    const { container } = show([], { plan, onGo: noop, onChangePlan: noop });
    expect(container.querySelector(".k-card-plan")).not.toBeNull();
  });
});
