// @vitest-environment happy-dom
//
// The key panel stands where the box was (#455), and what the person already typed waits in that
// hidden box (#488): the panel says it back on one line, in their words, and the Studio's
// suggestions — which would fill the hidden box — are not offered while it is up.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { askedLine, FreePanel } from "../src/free-panel.js";
import { ThreadView } from "../src/studio-thread-view.js";
import type { FreeAi } from "../src/free-ai.js";

afterEach(cleanup);

const NO_FREE: FreeAi = { health: { ok: true, chat: false }, left: null, stopped: null } as FreeAi;
const noop = () => {};

describe("the key panel's request line", () => {
  it("says what is waiting in the box, in the person's words", () => {
    const { container } = render(<FreePanel free={NO_FREE} onAddKey={noop} request="a list of the plants I water and when" />);
    const line = container.querySelector(".k-free-panel-asked")!;
    expect(line.textContent).toBe("You asked for: a list of the plants I water and when");
    expect(line.querySelector(".k-free-panel-asked-words")!.textContent).toBe("a list of the plants I water and when");
    // No quotes added around their words, and the whole of it on hover when the line is cut short.
    expect(line.textContent).not.toMatch(/[“"«]/);
    expect(line.getAttribute("title")).toBe("a list of the plants I water and when");
    // First in the panel: before what a key is.
    expect(container.querySelector(".k-free-panel")!.firstElementChild).toBe(line);
  });

  it("is one line: what was typed on several lines reads as one", () => {
    expect(askedLine("  books I've read\n\nwith a rating   and a note \n")).toBe("books I've read with a rating and a note");
    const { container } = render(<FreePanel free={NO_FREE} onAddKey={noop} request={"books I've read\nwith a rating"} />);
    expect(container.querySelector(".k-free-panel-asked-words")!.textContent).toBe("books I've read with a rating");
  });

  it("is not there when nothing was typed", () => {
    for (const request of [undefined, "", "  \n "]) {
      const { container } = render(<FreePanel free={NO_FREE} onAddKey={noop} request={request} />);
      expect(container.querySelector(".k-free-panel-asked")).toBeNull();
      cleanup();
    }
  });
});

describe("suggestions while the box is hidden", () => {
  const thread = (onSuggest?: (s: string) => void, remix: { credit: string; suggestions: string[] } | null = null) =>
    render(<ThreadView items={[]} app={null} working={null} held={null} onOpen={noop} onGoBack={noop} onFix={noop} onKeep={noop} onLook={noop} onSuggest={onSuggest} existing={false} remix={remix} />);

  it("ideas to start from are offered when there is a box to fill", () => {
    thread(noop);
    expect(screen.getByRole("list", { name: "Ideas to start from" }).querySelectorAll("button").length).toBeGreaterThan(0);
  });

  it("no ideas when the box is not there to fill", () => {
    thread(undefined);
    expect(screen.queryByRole("list", { name: "Ideas to start from" })).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // The words before the first message stay: only the taps that would show nothing go.
    expect(screen.getByRole("heading", { name: "What would you like to make?" })).toBeTruthy();
  });

  it("a remix's changes to start from go too", () => {
    const remix = { credit: "Remix of Groceries by Ana", suggestions: ["Add a price to each item"] };
    thread(noop, remix);
    expect(screen.getByRole("list", { name: "Changes to start from" })).toBeTruthy();
    cleanup();
    thread(undefined, remix);
    expect(screen.queryByRole("list", { name: "Changes to start from" })).toBeNull();
    expect(screen.getByText("This is your own copy. What would you like to change?")).toBeTruthy();
  });
});

describe("the plan notice (#118)", () => {
  const withPlan: FreeAi = { health: { ok: true, chat: true, plan: "https://potyro.com/plan" }, left: "plenty", stopped: null } as FreeAi;

  it("tells a device that asked for a plan that one exists now, with its page", () => {
    localStorage.setItem("potyro:wanted-plan", "1");
    try {
      const { container } = render(<FreePanel free={withPlan} onAddKey={noop} />);
      const link = container.querySelector<HTMLAnchorElement>(".k-free-panel-plan-link")!;
      expect(link.textContent).toBe("The plan you asked for exists now.");
      expect(link.href).toBe("https://potyro.com/plan");
      expect(container.querySelector(".k-free-panel-plan-btn")).toBeNull();
    } finally {
      localStorage.removeItem("potyro:wanted-plan");
    }
  });

  it("says nothing to a device that never asked, and offers the button as before", () => {
    const { container } = render(<FreePanel free={withPlan} onAddKey={noop} />);
    expect(container.querySelector(".k-free-panel-plan-link")).toBeNull();
    expect(container.querySelector(".k-free-panel-plan-btn")).not.toBeNull();
  });

  it("says nothing while no plan exists, whatever the device asked", () => {
    localStorage.setItem("potyro:wanted-plan", "1");
    try {
      const { container } = render(<FreePanel free={NO_FREE} onAddKey={noop} />);
      expect(container.querySelector(".k-free-panel-plan-link")).toBeNull();
    } finally {
      localStorage.removeItem("potyro:wanted-plan");
    }
  });
});
