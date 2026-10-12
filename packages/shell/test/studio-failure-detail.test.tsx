// @vitest-environment happy-dom
//
// A failure on the Studio's card reads plainly; the developer's words behind it travel with the
// message and are shown folded away under "Details" — closed until someone opens it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryStore } from "@potyro/store";

vi.mock("../src/open-store.js", () => ({
  openStore: async (namespace: string) => {
    const store = new MemoryStore();
    await store.open(namespace);
    return store;
  },
}));

const chat = await import("../src/studio-chat.js");
const { ThreadView } = await import("../src/studio-thread-view.js");

afterEach(cleanup);
beforeEach(() => {
  globalThis.localStorage.clear();
  chat.resetChatStore();
});

const PLAIN = "I couldn't make this change: every version I tried failed the app's own checks. Try asking for a smaller step, or say it another way.";
const DETAIL = "4 candidates failed the check — the candidate budget is spent";
const noop = () => {};

describe("a failure's detail", () => {
  it("is kept with the message and shown folded away under the plain words", async () => {
    await chat.appendMessage("reader", { kind: "ask", text: "make it blue" }, "2026-01-01T00:00:00.000Z");
    await chat.appendMessage("reader", { kind: "failure", text: PLAIN, detail: DETAIL }, "2026-01-01T00:00:01.000Z");
    const items = chat.threadItems(await chat.listMessages("reader"), []);
    expect(items.at(-1)).toMatchObject({ type: "agent", tone: "failure", text: PLAIN, detail: DETAIL });

    const { container } = render(
      <ThreadView items={items} app={null} working={null} held={null} onOpen={noop} onGoBack={noop} onFix={noop} onKeep={noop} onLook={noop} onSuggest={noop} existing />,
    );
    expect(screen.getByText(PLAIN)).toBeTruthy();
    const details = container.querySelector("details.k-thread-detail") as HTMLDetailsElement | null;
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.querySelector("summary")!.textContent).toBe("Details");
    expect(details!.textContent).toContain(DETAIL);
    // The plain words carry none of it.
    expect(screen.getByText(PLAIN).textContent).not.toContain("candidate");
  });

  it("a message with no detail shows none", async () => {
    await chat.appendMessage("reader", { kind: "failure", text: "Stopped. Nothing was changed." }, "2026-01-01T00:00:01.000Z");
    const items = chat.threadItems(await chat.listMessages("reader"), []);
    const { container } = render(
      <ThreadView items={items} app={null} working={null} held={null} onOpen={noop} onGoBack={noop} onFix={noop} onKeep={noop} onLook={noop} onSuggest={noop} existing />,
    );
    expect(container.querySelector("details.k-thread-detail")).toBeNull();
  });
});
