// @vitest-environment happy-dom
//
// A failure stays where it happens (#271): a filter or a view that throws fails only that part, says
// so in plain words where it would have been, and every other part — on the same page and on the
// others — shows its records. A computed value that throws is quieter still: its value is empty where
// it failed, every record shows, and nothing alerts; it is reported for whoever checks the app.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { defineApp, type AppInput } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type AppFailure, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { ViewHost } from "../src/host.js";
import { LayoutHost } from "../src/layout-host.js";

const app: AppInput = {
  id: "parts",
  name: "Parts",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      label: "Item",
      displayField: "title",
      fields: { title: { type: "text" } },
      computed: {
        month: () => {
          throw new ReferenceError("'Intl' is not defined");
        },
      },
    },
    note: { label: "Note", displayField: "text", fields: { text: { type: "text" } } },
  },
  pages: [
    { id: "items", title: "Items", view: { type: "list", entity: "item", display: { primary: "title", secondary: "month" } } },
    { id: "notes", title: "Notes", view: { type: "list", entity: "note", display: { primary: "text" } } },
    {
      id: "chart",
      title: "Chart",
      view: {
        type: "custom",
        entity: "note",
        render: () => {
          throw new Error("the chart library is not here");
        },
      },
    },
    {
      id: "picky",
      title: "Picky",
      view: {
        type: "list",
        entity: "note",
        display: { primary: "text" },
        filter: () => {
          throw new TypeError("cannot read property 'NumberFormat' of undefined");
        },
      },
    },
    {
      id: "both",
      title: "Both",
      layout: {
        type: "stack",
        items: [
          { title: "Chart", view: { type: "custom", entity: "note", render: () => { throw new Error("no canvas"); } } },
          { title: "Notes", view: { type: "list", entity: "note", display: { primary: "text" } } },
        ],
      },
    },
  ],
};

async function makeRuntime(): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open("parts");
  await store.insert("item", { title: "First item" });
  await store.insert("note", { text: "Buy milk" });
  await store.insert("note", { text: "Call Ana" });
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const loaded = await createHost().load({ kind: "module", app: defineApp(app) });
  return createRuntime({ app: loaded, host: createHost(), store, caps: new FakeCapabilities(), ui, nav });
}

const show = (runtime: PotyroRuntime, pageId: string) =>
  render(createElement(ViewHost, { runtime, pageId, params: {}, setParam: () => {}, navigate: () => {} }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a failure stays in its part", () => {
  it("a view that throws says so in its place, in plain words, and is reported", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = await makeRuntime();
    const heard: AppFailure[] = [];
    const stop = runtime.onFailure((f) => heard.push(f));
    show(runtime, "chart");
    expect(screen.getByRole("alert").textContent).toBe("This part of the app hit a problem: it could not be shown: the chart library is not here");
    expect(heard).toEqual([{ app: "parts", what: "view chart", message: "the chart library is not here" }]);
    stop();
  });

  it("a computed value that throws: the records still show, the value is empty, and nothing alerts — it is reported", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = await makeRuntime();
    const heard: AppFailure[] = [];
    const stop = runtime.onFailure((f) => heard.push(f));
    show(runtime, "items");
    await waitFor(() => expect(screen.getByText("First item")).toBeTruthy());
    await waitFor(() => expect(heard.some((f) => f.what === "computed item.month")).toBe(true));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector(".k-part-problem")).toBeNull();
    stop();
  });

  it("a filter that throws: its list says its records could not be listed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = await makeRuntime();
    show(runtime, "picky");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/^This part of the app hit a problem: its records could not be listed: .*NumberFormat/));
  });

  it("the other pages are untouched", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = await makeRuntime();
    show(runtime, "chart");
    cleanup();
    show(runtime, "notes");
    await waitFor(() => expect(screen.getByText("Buy milk")).toBeTruthy());
    expect(screen.getByText("Call Ana")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("on a page of several views, the broken one fails alone and its neighbour shows its records", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = await makeRuntime();
    const both = app.pages.find((p) => p.id === "both")!;
    render(createElement(LayoutHost, { runtime, pageId: "both", layout: both.layout!, params: {}, setParam: () => {}, navigate: () => {} }));
    const [chart, notes] = screen.getAllByRole("region");
    expect(within(chart!).getByRole("alert").textContent).toMatch(/hit a problem: it could not be shown: no canvas/);
    await waitFor(() => expect(within(notes!).getByText("Buy milk")).toBeTruthy());
    expect(within(notes!).queryByRole("alert")).toBeNull();
  });
});

// The Places bug: one place with no opening hours made "Open now" throw for that place, and a red
// box saying so took the map's place. A value that fails for some records is that value, empty, for
// those records — never the whole view.
describe("a computed that throws for one record of several", () => {
  const spots: AppInput = {
    id: "spots",
    name: "Spots",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      spot: {
        label: "Spot",
        displayField: "name",
        fields: { name: { type: "text" }, hours: { type: "list", of: { day: { type: "text" } } } },
        computed: {
          // Unguarded on purpose: a spot with no hours has `hours` undefined, and this throws for it.
          days: (s) => `${(s.hours as { day: string }[]).map((h) => h.day).join("+")} days`,
        },
      },
    },
    pages: [
      { id: "list", title: "List", view: { type: "list", entity: "spot", display: { primary: "name", secondary: "days" } } },
      { id: "table", title: "Table", view: { type: "table", entity: "spot", display: { columns: ["name", "days"] } } },
    ],
  };

  async function spotsRuntime(): Promise<PotyroRuntime> {
    const store = new MemoryStore();
    await store.open("spots");
    await store.insert("spot", { name: "Cafe A", hours: [{ day: "mon" }] });
    await store.insert("spot", { name: "Bar B" });
    await store.insert("spot", { name: "Deli C", hours: [{ day: "tue" }, { day: "wed" }] });
    const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
    const loaded = await createHost().load({ kind: "module", app: defineApp(spots) });
    return createRuntime({ app: loaded, host: createHost(), store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} } });
  }

  for (const pageId of ["list", "table"]) {
    it(`the ${pageId} shows every record, the bad value empty, and no alert`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const runtime = await spotsRuntime();
      const heard: AppFailure[] = [];
      const stop = runtime.onFailure((f) => heard.push(f));
      show(runtime, pageId);
      await waitFor(() => expect(screen.getByText("Deli C")).toBeTruthy());
      expect(screen.getByText("Cafe A")).toBeTruthy();
      expect(screen.getByText("Bar B")).toBeTruthy();
      // The records it worked for have their value; the one it failed for has none.
      expect(screen.getByText("mon days")).toBeTruthy();
      expect(screen.getByText("tue+wed days")).toBeTruthy();
      expect(screen.queryByText(/undefined/)).toBeNull();
      await waitFor(() => expect(heard.map((f) => f.what)).toContain("computed spot.days"));
      expect(screen.queryByRole("alert")).toBeNull();
      stop();
    });
  }
});
