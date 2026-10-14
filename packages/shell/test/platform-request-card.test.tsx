// @vitest-environment happy-dom
//
// "Potyro can't do this yet" (#263): the request in the person's words; the first tap shows exactly
// what will be sent, the second sends it; then the card says what came of it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { REQUEST_FORMAT, type PlatformRequestPayload } from "@potyro/platform-requests";
import { PlatformRequestCard } from "../src/platform-request-card.js";
import { ThreadView } from "../src/studio-thread-view.js";
import type { ChatItem } from "../src/studio-chat.js";

afterEach(cleanup);

const ask = { id: "req-1", title: "Scan barcodes", body: "I wanted to scan the barcode on a pot." };
const payload: PlatformRequestPayload = {
  format: REQUEST_FORMAT,
  id: "req-1",
  device: "d",
  title: ask.title,
  body: ask.body,
  structure: '{\n  "entities": { "plant": "(a function)" }\n}',
  language: "en",
};

describe("the card", () => {
  it("shows the request, and sends nothing until the person has seen what goes and tapped Send", async () => {
    const onSend = vi.fn(async () => {});
    render(<PlatformRequestCard ask={ask} review={async () => payload} onSend={onSend} />);
    expect(screen.getByText("Potyro can't do this yet")).toBeTruthy();
    expect(screen.getByText("Scan barcodes")).toBeTruthy();
    expect(screen.getByText(ask.body)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send to the Potyro team" }));
    await screen.findByRole("group", { name: "What will be sent" });
    expect(onSend).not.toHaveBeenCalled();
    // Exactly what goes: the structure as it will be sent, entries never.
    expect(screen.getByText(/"plant": "\(a function\)"/)).toBeTruthy();
    expect(screen.getByText(/None of your entries are in it/)).toBeTruthy();
    expect(screen.getByText(/public list/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(payload));
  });

  it("Not now sends nothing", async () => {
    const onSend = vi.fn(async () => {});
    render(<PlatformRequestCard ask={ask} review={async () => payload} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "Send to the Potyro team" }));
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send to the Potyro team" })).toBeTruthy();
  });

  it("says when it was sent, with the request's address", () => {
    render(<PlatformRequestCard ask={ask} sent={{ id: "req-1", state: "sent", url: "https://github.com/fuzue/potyro/issues/9" }} review={async () => payload} onSend={async () => {}} />);
    expect(screen.getByRole("status").textContent).toMatch(/Sent to the Potyro team/);
    expect(screen.getByRole("link", { name: "See the request" }).getAttribute("href")).toBe("https://github.com/fuzue/potyro/issues/9");
    expect(screen.queryByRole("button", { name: "Send to the Potyro team" })).toBeNull();
  });

  it("says when it is kept to send later, and can be tried again", () => {
    render(<PlatformRequestCard ask={ask} sent={{ id: "req-1", state: "saved" }} review={async () => payload} onSend={async () => {}} />);
    expect(screen.getByRole("status").textContent).toMatch(/saved on this device and will be sent later/);
    expect(screen.getByRole("button", { name: "Try sending again" })).toBeTruthy();
  });
});

describe("in the conversation", () => {
  const noop = () => {};
  it("rides under the agent's answer, and reads what came of sending it from the conversation", () => {
    const items: ChatItem[] = [
      { type: "ask", id: "a", text: "let me scan barcodes" },
      { type: "agent", id: "b", text: "I didn't change the app.", tone: "refusal", platform: ask },
      { type: "event", id: "c", text: "Sent.", request: { id: "req-1", state: "sent" } },
    ];
    render(
      <ThreadView
        items={items}
        app={null}
        working={null}
        held={null}
        onOpen={noop}
        onGoBack={noop}
        onFix={noop}
        onKeep={noop}
        onLook={noop}
        onSuggest={noop}
        existing
        requests={{ review: async () => payload, send: async () => {} }}
      />,
    );
    expect(screen.getByText("Potyro can't do this yet")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Sent to the Potyro team/);
  });
});
