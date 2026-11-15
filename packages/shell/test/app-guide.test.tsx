// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { GuideCard, GuideSheet, guideSeen, guideSeenKey, markGuideSeen } from "../src/app-guide.js";
import { appStorageKeys } from "../src/erase-app-data.js";

// An app's guide as the shell shows it (#80): a card on first open, a dialog from the menu.

const STEPS = ["Tap “Scan label” on the Bottles page.", "Check what it filled in, then save."];

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("remembering that a guide was closed", () => {
  it("is per app, and survives until the app's data is erased", () => {
    expect(guideSeen("cellar")).toBe(false);
    markGuideSeen("cellar");
    expect(guideSeen("cellar")).toBe(true);
    expect(guideSeen("pantry")).toBe(false);
    // Deleting the app forgets it with the rest of what the app kept here (erase-app-data.ts).
    expect(appStorageKeys("user:cellar")).toContain(guideSeenKey("cellar"));
  });

  it("where nothing can be remembered, the card is not shown at every open", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(guideSeen("cellar", broken)).toBe(true);
    expect(() => markGuideSeen("cellar", broken)).not.toThrow();
  });
});

describe("the first-open card", () => {
  it("is a labelled region with the steps as an ordered list and one button that closes it", () => {
    const onClose = vi.fn();
    render(<GuideCard steps={STEPS} onClose={onClose} />);
    const card = screen.getByRole("region", { name: "How to use it" });
    expect(within(card).getByRole("heading", { name: "How to use it" })).toBeTruthy();
    const list = within(card).getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(STEPS);
    expect(within(card).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(card).getByRole("button", { name: "Got it" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // Part of the page, not a dialog: nothing modal, nothing that takes the focus.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("draws a stranger's words as text: no markup, no link", () => {
    const { container } = render(<GuideCard steps={['<img src=x onerror="alert(1)"> <a href="https://evil.example">here</a> https://evil.example']} onClose={() => {}} />);
    expect(container.querySelector("img, a, script")).toBeNull();
    expect(screen.getByRole("listitem").textContent).toBe('<img src=x onerror="alert(1)"> <a href="https://evil.example">here</a> https://evil.example');
  });

  it("is nothing at all without steps", () => {
    const { container } = render(<GuideCard steps={[]} onClose={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("the guide from the app's menu", () => {
  it("is a dialog named by its heading, focused on Close, closed by the button, Escape or a tap outside", () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount, container } = render(<GuideSheet name="Wine Cellar" steps={STEPS} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "How to use it" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByText("Wine Cellar")).toBeTruthy();
    expect(within(dialog).getAllByRole("listitem").map((li) => li.textContent)).toEqual(STEPS);
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(close);

    fireEvent.click(close);
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(dialog); // inside: not a way out
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(container.querySelector(".k-modal-scrim")!);
    expect(onClose).toHaveBeenCalledTimes(3);

    // Closing gives the focus back to what opened it.
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
