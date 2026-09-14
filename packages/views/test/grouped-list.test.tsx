// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { defineApp, type KartaApp } from "karta";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { createRuntime, type KartaRuntime } from "@karta/runtime";
import { ListView } from "../src/builtins.js";

// Rows under headings and sections that fold (#108): every group at once in the enum's order, a
// count in each heading, a fold remembered on this device, and a record page whose section folds.

function app(listExtra: Record<string, unknown>): KartaApp {
  return defineApp({
    id: "grouped-fixture",
    name: "Grouped",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      place: {
        label: "Place",
        displayField: "name",
        fields: {
          name: { type: "text", required: true },
          kind: { type: "enum", options: ["restaurant", "bar", "cafe"] },
          rating: { type: "number" },
        },
      },
    },
    pages: [
      {
        id: "all",
        title: "Places",
        view: { type: "list", entity: "place", display: { primary: "name" }, sort: (a: { rating?: number }, b: { rating?: number }) => (b.rating ?? 0) - (a.rating ?? 0), ...listExtra },
      },
    ],
  } as never);
}

async function makeRuntime(def: KartaApp): Promise<KartaRuntime> {
  const store = new MemoryStore();
  await store.open(def.id);
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: def });
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
  for (const p of [
    { name: "Bonanza", kind: "cafe", rating: 4.6 },
    { name: "Mangal", kind: "restaurant", rating: 4.5 },
    { name: "Lode", kind: "restaurant", rating: 4.8 },
    { name: "Nameless", rating: 3 },
    { name: "Bar Tausend", kind: "bar", rating: 4.1 },
  ]) {
    await runtime.ctx.create("place", p);
  }
  return runtime;
}

const heads = () => [...document.querySelectorAll(".k-fold-head .k-fold-title")].map((e) => e.textContent);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("a grouped list", () => {
  it("puts every group on screen in the enum's order, rows sorted inside, ungrouped rows first", async () => {
    const runtime = await makeRuntime(app({ group: "kind" }));
    render(<ListView runtime={runtime} pageId="all" params={{}} setParam={() => {}} navigate={() => {}} />);
    await waitFor(() => expect(heads()).toEqual(["restaurant", "bar", "cafe"]));
    // The row names resolve a moment after the headings.
    await screen.findByText("Nameless");
    // The row with no category comes first, under no heading.
    expect(document.querySelector(".k-group-ungrouped")?.textContent).toContain("Nameless");
    // Inside a group the view's sort still holds: Lode (4.8) before Mangal (4.5).
    const restaurant = document.querySelectorAll(".k-fold-group")[0] as HTMLElement;
    await waitFor(() => expect([...restaurant.querySelectorAll(".k-primary")].map((e) => e.textContent)).toEqual(["Lode", "Mangal"]));
    expect(within(restaurant).getByText("2")).toBeTruthy();
    // Not collapsible: a heading, not a button.
    expect(screen.queryByRole("button", { name: /restaurant/ })).toBeNull();
  });

  it("folds a group from its heading, takes its rows away, and remembers it", async () => {
    const def = app({ group: "kind", collapsible: true });
    const runtime = await makeRuntime(def);
    const { unmount } = render(<ListView runtime={runtime} pageId="all" params={{}} setParam={() => {}} navigate={() => {}} />);
    const bar = await screen.findByRole("button", { name: /bar/ });
    expect(bar.getAttribute("aria-expanded")).toBe("true");
    await screen.findByText("Bar Tausend");
    fireEvent.click(bar);
    expect(bar.getAttribute("aria-expanded")).toBe("false");
    // Folded rows are gone from the page, and so from the tab order.
    expect(screen.queryByText("Bar Tausend")).toBeNull();
    unmount();

    render(<ListView runtime={runtime} pageId="all" params={{}} setParam={() => {}} navigate={() => {}} />);
    const again = await screen.findByRole("button", { name: /bar/ });
    expect(again.getAttribute("aria-expanded")).toBe("false");
  });

  it("groups by a function of the record", async () => {
    const runtime = await makeRuntime(app({ group: (r: { rating?: number }) => ((r.rating ?? 0) >= 4.5 ? "Great" : "Fine") }));
    render(<ListView runtime={runtime} pageId="all" params={{}} setParam={() => {}} navigate={() => {}} />);
    // First appearance, in the sorted rows: Lode 4.8 is "Great".
    await waitFor(() => expect(heads()).toEqual(["Great", "Fine"]));
  });
});
