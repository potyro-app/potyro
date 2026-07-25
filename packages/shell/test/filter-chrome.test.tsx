// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defineApp } from "karta";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { createRuntime, type KartaRuntime } from "@karta/runtime";
import { FilterChrome } from "../src/filter-chrome.js";

// The generic filter-chip chrome (issue #21): field-option chips, a boolean toggle, and a "near me"
// geo button that reads ctx.caps.geo — all writing into ctx.params.

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

async function makeRuntime(caps: FakeCapabilities): Promise<KartaRuntime> {
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

    // Field-option chips derived from the `kind` enum.
    fireEvent.click(screen.getByRole("button", { name: "bar" }));
    expect(setParam).toHaveBeenCalledWith("kind", "bar");

    // Boolean toggle.
    fireEvent.click(screen.getByRole("button", { name: "Open now" }));
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

    const eggChip = await screen.findByRole("button", { name: "Egg" });
    expect(screen.getByRole("button", { name: "Flour" })).toBeTruthy();
    fireEvent.click(eggChip);
    expect(setParam).toHaveBeenCalledWith("pantry", [egg.id]);
  });
});
