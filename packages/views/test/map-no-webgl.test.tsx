// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defineApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "@potyro/runtime";

// A map page in a browser that cannot draw maps (no WebGL2: WebGL off, a blocklisted driver, a
// hardened profile). MapLibre 6 builds such a map without a painter and throws from its first
// `resize()` and its `remove()` — from a React cleanup, which took the whole app to a blank page in
// Firefox. Now: no map is built, the places are listed, and leaving the page throws nothing.
// (happy-dom has no WebGL at all, so this is the browser it already is.)

const built = vi.hoisted(() => ({ maps: 0 }));
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("maplibre-gl", () => {
  class PainterlessMap {
    constructor() {
      built.maps += 1;
    }
    on(): void {}
    resize(): void {
      throw new TypeError('can\'t access property "resize", this.painter is undefined');
    }
    remove(): void {
      throw new TypeError('can\'t access property "destroy", this.painter is undefined');
    }
  }
  return { Map: PainterlessMap, setWorkerUrl: () => {} };
});

const { MapView } = await import("../src/map.js");
const { FieldInput } = await import("../src/field-input.js");

function fixture() {
  return defineApp({
    id: "no-webgl-fixture",
    name: "No WebGL",
    version: "1.0.0",
    schemaVersion: 1,
    entities: { place: { label: "Place", displayField: "name", fields: { name: { type: "text", required: true }, location: { type: "geo" } } } },
    pages: [
      { id: "map", title: "Map", view: { type: "map", entity: "place", geo: "location", title: "name" } },
      { id: "place", title: "Place", hidden: true, view: { type: "detail", entity: "place", param: "id" } },
    ],
  });
}

async function makeRuntime(): Promise<PotyroRuntime> {
  const store = new MemoryStore();
  await store.open("no-webgl-fixture");
  await store.insert("place", { name: "Corner Café", location: { lat: 52.52, lng: 13.405 } });
  await store.insert("place", { name: "Paris Bakery", location: { lat: 48.85, lng: 2.35 } });
  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: fixture() });
  return createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
}

afterEach(cleanup);

describe("a map page without WebGL2", () => {
  it("lists the places instead of a blank page, opens one, and leaves without throwing", async () => {
    const runtime = await makeRuntime();
    const created: unknown[] = [];
    const view = render(<MapView runtime={runtime} pageId="map" params={{}} navigate={() => {}} onCreate={(...a) => void created.push(a)} />);

    expect(await screen.findByText("This browser can’t draw maps, so the places are listed instead.")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Corner Café|Paris Bakery/ })).toHaveLength(2));
    expect(built.maps).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /Corner Café/ }));
    expect(await screen.findByRole("dialog", { name: "Place" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add: Place" }));
    expect(created).toEqual([["place", {}]]);

    expect(() => view.unmount()).not.toThrow();
  });

  it("a geo field says so and offers the coordinates, with no map built", async () => {
    render(<FieldInput runtime={await makeRuntime()} field={{ type: "geo" } as never} value={null} onChange={() => {}} />);
    expect(await screen.findByText("This browser can’t draw maps. Use your location, or type the coordinates.")).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "lat" })).toBeTruthy();
    expect(built.maps).toBe(0);
  });
});
