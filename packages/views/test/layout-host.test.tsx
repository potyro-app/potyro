// @vitest-environment happy-dom
//
// The layout host (#105): a grid renders every item under its title; tabs show one item at a time;
// a split fills its right pane from the row that was opened instead of navigating; a stack's
// collapsible item remembers its fold on this device.

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defineApp, type AppInput, type PageLayout } from "karta";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { createRuntime, type KartaRuntime } from "@karta/runtime";
import { LayoutHost } from "../src/layout-host.js";

const app = (layout: PageLayout): AppInput => ({
  id: "layout-fixture",
  name: "Layout",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    plant: {
      displayField: "name",
      fields: { name: { type: "text" }, done: { type: "boolean", default: false } },
    },
  },
  pages: [
    { id: "home", title: "Home", layout },
    { id: "one", title: "Plant", hidden: true, view: { type: "detail", entity: "plant", param: "plantId", sections: [{ fields: ["name"] }] } },
  ],
});

async function makeRuntime(layout: PageLayout): Promise<KartaRuntime> {
  const store = new MemoryStore();
  await store.open("layout-fixture");
  await store.insert("plant", { name: "Fern", done: false });
  await store.insert("plant", { name: "Basil", done: true });
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: defineApp(app(layout)) });
  return createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
}

// Like the shell: navigating to a page merges the params into that page's params — so a split's
// selection, which navigates to its own page, lands in the params the detail reads.
function Harness({ runtime, layout, navigate }: { runtime: KartaRuntime; layout: PageLayout; navigate?: (p: string, q?: Record<string, string>) => void }) {
  const [params, setParams] = useState<Record<string, unknown>>({});
  return (
    <LayoutHost
      runtime={runtime}
      pageId="home"
      layout={layout}
      params={params}
      setParam={(k, v) => setParams((p) => ({ ...p, [k]: v }))}
      navigate={(p, q) => {
        navigate?.(p, q);
        if (p === "home" && q) setParams((prev) => ({ ...prev, ...q }));
      }}
    />
  );
}

const list = (extra: Record<string, unknown> = {}) => ({ type: "list" as const, entity: "plant", display: { primary: "name" }, ...extra });

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
});
afterEach(cleanup);

describe("LayoutHost", () => {
  it("renders a grid's items under their titles, each with its own rows", async () => {
    const layout: PageLayout = {
      type: "grid",
      items: [
        { title: "Open", span: 2, view: list({ filter: (p: { done: boolean }) => !p.done }) },
        { title: "Done", view: list({ filter: (p: { done: boolean }) => p.done }) },
      ],
    };
    const runtime = await makeRuntime(layout);
    render(<Harness runtime={runtime} layout={layout} />);
    await screen.findByText("Fern");
    await screen.findByText("Basil");
    const open = screen.getByRole("region", { name: "Open" });
    expect(open.getAttribute("data-span")).toBe("2");
    expect(open.textContent).toContain("Fern");
    expect(open.textContent).not.toContain("Basil");
    expect(screen.getByRole("region", { name: "Done" }).textContent).toContain("Basil");
  });

  it("tabs show one item at a time", async () => {
    const layout: PageLayout = {
      type: "tabs",
      items: [
        { title: "Open", view: list({ filter: (p: { done: boolean }) => !p.done }) },
        { title: "Done", view: list({ filter: (p: { done: boolean }) => p.done }) },
      ],
    };
    const runtime = await makeRuntime(layout);
    render(<Harness runtime={runtime} layout={layout} />);
    await screen.findByText("Fern");
    expect(screen.queryByText("Basil")).toBeNull();
    expect(screen.getByRole("tab", { name: "Open" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Done" }));
    await screen.findByText("Basil");
    expect(screen.queryByText("Fern")).toBeNull();
  });

  it("a split fills the right pane from the opened row instead of navigating", async () => {
    const layout: PageLayout = {
      type: "split",
      items: [{ view: list({ onOpen: { page: "one", param: { plantId: "id" } } }) }, { view: { type: "detail", entity: "plant", param: "plantId", sections: [{ fields: ["name"] }] } }],
    };
    const runtime = await makeRuntime(layout);
    const navigate = vi.fn();
    render(<Harness runtime={runtime} layout={layout} navigate={navigate} />);
    await screen.findByText("Fern");
    expect(screen.getByText("Choose one on the left.")).toBeTruthy();
    fireEvent.click(screen.getByText("Fern"));
    await waitFor(() => expect(document.querySelector("article.k-detail")).toBeTruthy());
    // The selection went through `navigate` — to this page, never to the row's own page.
    expect(navigate).toHaveBeenCalledWith("home", { plantId: expect.any(String) });
    expect(navigate.mock.calls.some(([page]) => page === "one")).toBe(false);
    expect(document.querySelector("article.k-detail")!.textContent).toContain("Fern");
    // The row is marked as the one shown (the detail also says "Fern", so look at the list's copy).
    expect(screen.getAllByText("Fern").find((el) => el.closest("li"))!.closest("li")!.getAttribute("data-active")).toBe("true");
  });

  it("a stack's collapsible item remembers its fold", async () => {
    const layout: PageLayout = { type: "stack", items: [{ title: "All", collapsible: true, view: list() }] };
    const runtime = await makeRuntime(layout);
    const view = render(<Harness runtime={runtime} layout={layout} />);
    await screen.findByText("Fern");
    const details = document.querySelector("details.k-layout-fold") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    details.open = false;
    fireEvent(details, new Event("toggle"));
    expect(localStorage.getItem("karta:layout:layout-fixture:home:0")).toBe("closed");
    view.unmount();
    render(<Harness runtime={runtime} layout={layout} />);
    await screen.findByText("Fern");
    expect((document.querySelector("details.k-layout-fold") as HTMLDetailsElement).open).toBe(false);
  });
});
