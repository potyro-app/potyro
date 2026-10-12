// @vitest-environment happy-dom
//
// A failure stays where it happens (#271): a computed value, a filter or a view that throws fails
// only that part, says so in plain words where it would have been, and every other part — on the same
// page and on the others — shows its records.

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

  it("a computed value that throws: the records still show, and the value's part says what went wrong", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = await makeRuntime();
    show(runtime, "items");
    await waitFor(() => expect(screen.getByText("First item")).toBeTruthy());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("This part of the app hit a problem: “Month” could not be worked out for some records: 'Intl' is not defined"));
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
