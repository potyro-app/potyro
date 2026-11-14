// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defineApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";
import { FilterChrome } from "../src/filter-chrome.js";

// The generic filter-chip chrome (issue #21): option lists behind one Filter button, a boolean
// toggle and a "near me" geo button beside it — all writing into ctx.params.

const app = defineApp({
  id: "chrome-fixture",
  name: "Chrome Fixture",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    place: {
      label: "Place",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        location: { type: "geo" },
        kind: { type: "enum", options: ["bar", "cafe"] },
      },
    },
  },
  pages: [
    {
      id: "map",
      title: "Map",
      view: {
        type: "map",
        entity: "place",
        geo: "location",
        title: "name",
        filters: [
          { label: "Category", param: "kind", from: "kind" },
          { label: "Open now", param: "openOnly", type: "boolean" },
          { label: "Near me", param: "me", type: "geo" },
        ],
      },
    },
  ],
});

async function makeRuntime(caps: FakeCapabilities): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open("chrome-fixture");
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app });
  return createRuntime({ app: loaded, host, store, caps, ui, nav });
}

afterEach(cleanup);

describe("FilterChrome", () => {
  it("renders field-option, boolean, and geo chips and writes into params", async () => {
    const caps = new FakeCapabilities({ geolocation: true, position: { lat: 1, lng: 2 } });
    const runtime = await makeRuntime(caps);
    const setParam = vi.fn();
    render(<FilterChrome runtime={runtime} pageId="map" params={{}} setParam={setParam} />);

    // The options are behind the Filter button now: thirteen chips on a phone was most of the
    // screen spent on choices nobody had made.
    expect(screen.queryByRole("button", { name: "bar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Filter/ }));
    fireEvent.click(screen.getByRole("button", { name: "bar" }));
    expect(setParam).toHaveBeenCalledWith("kind", "bar");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    // Boolean toggle.
    // A boolean chip is a switch (#97): named by its label, with a state to read.
    const openNow = screen.getByRole("switch", { name: "Open now" });
    expect(openNow.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(openNow); // the params object below is what records the flip
    expect(setParam).toHaveBeenCalledWith("openOnly", true);

    // "Near me" reads ctx.caps.geo and writes the coordinates.
    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    await waitFor(() => expect(setParam).toHaveBeenCalledWith("me", { lat: 1, lng: 2 }));
  });

  it("renders nothing for a view without filters", async () => {
    const runtime = await makeRuntime(new FakeCapabilities());
    const { container } = render(<FilterChrome runtime={runtime} pageId="nope" params={{}} setParam={() => {}} />);
    expect(container.querySelector(".k-chrome")).toBeNull();
  });
});

// A record-source chip (`from` names an entity): the pantry picker, unified into FilterChrome (#21).
const pantryApp = defineApp({
  id: "pantry-fixture",
  name: "Pantry Fixture",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    ingredient: { label: "Ingredient", displayField: "name", fields: { name: { type: "text", required: true } } },
    recipe: { label: "Recipe", displayField: "name", fields: { name: { type: "text", required: true } } },
  },
  pages: [
    {
      id: "cook",
      title: "Cook",
      view: {
        type: "list",
        entity: "recipe",
        filters: [{ label: "In my pantry", param: "pantry", from: "ingredient", multi: true }],
        display: { primary: "name" },
      },
    },
  ],
});

describe("FilterChrome record-source chips (pantry)", () => {
  it("renders entity records as chips and toggles ids into params", async () => {
    const store = new MemoryStore();
    await store.open("pantry-fixture");
    const egg = await store.insert("ingredient", { name: "Egg" });
    await store.insert("ingredient", { name: "Flour" });

    const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
    const nav: NavBridge = { navigate: () => {} };
    const host = createHost();
    const loaded = await host.load({ kind: "module", app: pantryApp });
    const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });

    const setParam = vi.fn();
    render(<FilterChrome runtime={runtime} pageId="cook" params={{}} setParam={setParam} />);

    fireEvent.click(screen.getByRole("button", { name: /Filter/ }));
    const eggChip = await screen.findByRole("button", { name: "Egg" });
    expect(screen.getByRole("button", { name: "Flour" })).toBeTruthy();
    fireEvent.click(eggChip);
    expect(setParam).toHaveBeenCalledWith("pantry", [egg.id]);
  });
});

// A layout page (#105): the chips are the page's, whichever item declares them.
describe("FilterChrome on a layout", () => {
  it("shows the chips of the first item that declares any, even when it is not the first item", async () => {
    const layoutApp = defineApp({
      id: "layout-chips",
      name: "Layout Chips",
      version: "1.0.0",
      schemaVersion: 1,
      entities: {
        status: { displayField: "state", fields: { state: { type: "text" } } },
        quake: { displayField: "place", fields: { place: { type: "text" }, mag: { type: "number" } } },
      },
      pages: [
        {
          id: "live",
          title: "Live",
          layout: {
            type: "stack",
            items: [
              { view: { type: "aggregate", entity: "status", rows: () => [] } },
              { view: { type: "list", entity: "quake", filters: [{ label: "Last 24 h", param: "day", type: "boolean" }] } },
            ],
          },
        },
      ],
    });
    const store = new MemoryStore();
    await store.open("layout-chips");
    const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
    const host = createHost();
    const loaded = await host.load({ kind: "module", app: layoutApp });
    const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} } });
    const setParam = vi.fn();
    render(<FilterChrome runtime={runtime} pageId="live" params={{}} setParam={setParam} />);
    fireEvent.click(screen.getByRole("switch", { name: "Last 24 h" }));
    expect(setParam).toHaveBeenCalledWith("day", true);
  });
});

// What comes back OUT of the sheet: only what was chosen, each a chip that takes itself off.
describe("FilterChrome shows what was chosen", () => {
  it("lists the picked values beside the button, and a tap on one clears it", async () => {
    const runtime = await makeRuntime(new FakeCapabilities());
    const setParam = vi.fn();
    render(<FilterChrome runtime={runtime} pageId="map" params={{ kind: "bar" }} setParam={setParam} />);

    // The button says how many, and the value is on screen without opening anything.
    expect(screen.getByRole("button", { name: /Filter/ }).textContent).toContain("1");
    const picked = screen.getByRole("button", { name: /Category: bar/ });
    fireEvent.click(picked);
    expect(setParam).toHaveBeenCalledWith("kind", undefined);
  });
});

// A field with no declared options (#79): the choices are the values the records hold. A generated
// list declared `from: "country"` on a text field and its Filter sheet opened on nothing.
const booksApp = defineApp({
  id: "books-fixture",
  name: "Books Fixture",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    book: {
      label: "Book",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        country: { type: "text" },
        year: { type: "number" },
        shelf: { type: "tags" },
        cover: { type: "file" },
      },
    },
  },
  pages: [
    {
      id: "books",
      title: "Books",
      view: {
        type: "list",
        entity: "book",
        filters: [
          { label: "Country", param: "country", from: "country", multi: true },
          { label: "Year", param: "year", from: "year" },
          { label: "Shelf", param: "shelf", from: "shelf" },
        ],
        display: { primary: "title" },
      },
    },
    {
      id: "covers",
      title: "Covers",
      view: {
        type: "list",
        entity: "book",
        filters: [
          { label: "Cover", param: "cover", from: "cover" },
          { label: "Gone", param: "gone", from: "noSuchField" },
        ],
        display: { primary: "title" },
      },
    },
  ],
});

async function booksRuntime(books: Record<string, unknown>[]): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open("books-fixture");
  for (const book of books) await store.insert("book", book);
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: booksApp });
  return createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} } });
}

describe("FilterChrome offers the values the records hold (#79)", () => {
  const books = [
    { title: "Solaris", country: "Poland", year: 1961, shelf: ["sci-fi", "classics"] },
    { title: "Ferdydurke", country: "Poland", year: 1937, shelf: ["classics"] },
    { title: "Il nome della rosa", country: "Italy", year: 1980 },
    { title: "Untitled", country: "" },
  ];

  it("lists a text field's distinct values, sorted, without the empty one", async () => {
    const runtime = await booksRuntime(books);
    const setParam = vi.fn();
    render(<FilterChrome runtime={runtime} pageId="books" params={{}} setParam={setParam} />);

    fireEvent.click(screen.getByRole("button", { name: /Filter/ }));
    const group = await screen.findByRole("group", { name: "Country" });
    await waitFor(() => expect(group.querySelectorAll(".k-chip")).toHaveLength(2));
    expect([...group.querySelectorAll(".k-chip")].map((c) => c.textContent)).toEqual(["Italy", "Poland"]);
    expect(group.textContent).not.toContain("Nothing to pick yet.");
  });

  it("writes the same param an enum would: an array when multi, the value itself when not", async () => {
    const runtime = await booksRuntime(books);
    const setParam = vi.fn();
    const { rerender } = render(<FilterChrome runtime={runtime} pageId="books" params={{}} setParam={setParam} />);

    fireEvent.click(screen.getByRole("button", { name: /Filter/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Poland" }));
    expect(setParam).toHaveBeenCalledWith("country", ["Poland"]);

    // A second choice joins the first; choosing one again takes it off.
    rerender(<FilterChrome runtime={runtime} pageId="books" params={{ country: ["Poland"] }} setParam={setParam} />);
    expect(screen.getByRole("button", { name: "Poland" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Italy" }));
    expect(setParam).toHaveBeenCalledWith("country", ["Poland", "Italy"]);
    fireEvent.click(screen.getByRole("button", { name: "Poland" }));
    expect(setParam).toHaveBeenLastCalledWith("country", undefined);

    // Free tags: each entry is a choice. Single-select → the bare value.
    fireEvent.click(screen.getByRole("button", { name: "sci-fi" }));
    expect(setParam).toHaveBeenLastCalledWith("shelf", "sci-fi");
  });

  it("keeps a number a number, so the app's filter can compare it to the field", async () => {
    const runtime = await booksRuntime(books);
    const setParam = vi.fn();
    const { rerender } = render(<FilterChrome runtime={runtime} pageId="books" params={{}} setParam={setParam} />);

    fireEvent.click(screen.getByRole("button", { name: /Filter/ }));
    const group = await screen.findByRole("group", { name: "Year" });
    await waitFor(() => expect([...group.querySelectorAll(".k-chip")].map((c) => c.textContent)).toEqual(["1937", "1961", "1980"]));
    fireEvent.click(screen.getByRole("button", { name: "1961" }));
    expect(setParam).toHaveBeenCalledWith("year", 1961);

    // Chosen, it shows beside the button and comes off with a tap.
    rerender(<FilterChrome runtime={runtime} pageId="books" params={{ year: 1961 }} setParam={setParam} />);
    expect(screen.getByRole("button", { name: "1961" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Year: 1961/ }));
    expect(setParam).toHaveBeenLastCalledWith("year", undefined);
  });

  it("takes one of several chosen values off without touching the others", async () => {
    const runtime = await booksRuntime(books);
    const setParam = vi.fn();
    render(<FilterChrome runtime={runtime} pageId="books" params={{ country: ["Poland", "Italy"] }} setParam={setParam} />);
    fireEvent.click(screen.getByRole("button", { name: /Country: Italy/ }));
    expect(setParam).toHaveBeenCalledWith("country", ["Poland"]);
  });

  it("still offers a chosen value whose last record is gone, so it can be taken off", async () => {
    const runtime = await booksRuntime(books);
    const setParam = vi.fn();
    render(<FilterChrome runtime={runtime} pageId="books" params={{ country: ["Brazil"] }} setParam={setParam} />);
    fireEvent.click(screen.getByRole("button", { name: /Filter/ }));
    const group = await screen.findByRole("group", { name: "Country" });
    await waitFor(() => expect([...group.querySelectorAll(".k-chip")].map((c) => c.textContent)).toEqual(["Italy", "Poland", "Brazil"]));
  });

  it("says there is nothing to pick while there are no records, rather than an empty sheet", async () => {
    const runtime = await booksRuntime([]);
    render(<FilterChrome runtime={runtime} pageId="books" params={{}} setParam={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Filter/ }));
    const group = await screen.findByRole("group", { name: "Country" });
    await waitFor(() => expect(group.textContent).toContain("Nothing to pick yet."));
    expect(group.querySelectorAll(".k-chip")).toHaveLength(0);
  });

  it("offers no Filter button when no chip could ever have a choice", async () => {
    const runtime = await booksRuntime(books);
    render(<FilterChrome runtime={runtime} pageId="covers" params={{}} setParam={() => {}} />);
    expect(screen.queryByRole("button", { name: /Filter/ })).toBeNull();
  });
});
