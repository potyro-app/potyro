// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { defineApp, type Ctx, type Dynamic, type MapCamera } from "karta";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { createRuntime, type KartaRuntime } from "@karta/runtime";

// How the built-in map frames itself — the `camera` field, and the auto-fit rule around it. None of
// this is reachable from an app module beyond declaring `camera`, so it is host behaviour and belongs
// in a host test.
//
// MapLibre needs WebGL, so it is faked here; the gated import lets each test decide when the map
// object appears.
//
// NOT covered here: the "pins are missing on first open" race. A unit render re-queries and hands the
// sync a fresh marker array anyway, so the mount ordering that breaks a real browser cannot be
// reproduced — a test here passes with the fix removed entirely, which is worse than no test.
// e2e/map-camera-trusted.spec.ts covers it, and was confirmed to fail without the fix in both
// Chromium and Firefox.

const gate = vi.hoisted(() => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open: () => open() };
});

const spies = vi.hoisted(() => ({
  built: [] as { center: unknown; zoom: unknown }[],
  fits: 0,
  markers: 0,
  handlers: new Map<string, (e: unknown) => void>(),
  center: { lng: 0, lat: 0 },
  zoom: 0,
}));

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("maplibre-gl", async () => {
  await gate.opened;
  class FakeMap {
    constructor(opts: { center: unknown; zoom: unknown }) {
      spies.built.push({ center: opts.center, zoom: opts.zoom });
    }
    on(type: string, handler: (e: unknown) => void): void {
      spies.handlers.set(type, handler);
    }
    fitBounds(): void {
      spies.fits += 1;
    }
    getCenter(): { lng: number; lat: number } {
      return spies.center;
    }
    getZoom(): number {
      return spies.zoom;
    }
    remove(): void {}
  }
  class FakeMarker {
    constructor() {
      spies.markers += 1;
    }
    setLngLat(): this {
      return this;
    }
    getElement(): HTMLElement {
      return document.createElement("div");
    }
    setPopup(): this {
      return this;
    }
    addTo(): this {
      return this;
    }
    remove(): void {}
  }
  class FakeBounds {
    private n = 0;
    extend(): void {
      this.n += 1;
    }
    isEmpty(): boolean {
      return this.n === 0;
    }
  }
  class FakePopup {
    setText(): this {
      return this;
    }
    // The view builds popup contents as DOM; without this the sync threw and the auto-fit never ran.
    setDOMContent(): this {
      return this;
    }
  }
  return { Map: FakeMap, Marker: FakeMarker, Popup: FakePopup, LngLatBounds: FakeBounds };
});

const { MapView } = await import("../src/map.js");

const CAMERA_KV = "kv:map:map:camera";

function fixture(camera?: Dynamic<MapCamera>) {
  return defineApp({
    id: "map-camera-fixture",
    name: "Map Camera Fixture",
    version: "1.0.0",
    schemaVersion: 1,
    scope: { entity: "trip" },
    entities: {
      trip: { label: "Trip", displayField: "city", fields: { city: { type: "text" }, location: { type: "geo" } } },
      place: { label: "Place", displayField: "name", fields: { name: { type: "text", required: true }, location: { type: "geo" } } },
    },
    pages: [
      {
        id: "map",
        title: "Map",
        view: { type: "map", entity: "place", geo: "location", title: "name", ...(camera ? { camera } : {}) },
      },
    ],
  });
}

async function makeRuntime(camera?: Dynamic<MapCamera>, saved?: unknown): Promise<{ runtime: KartaRuntime; store: MemoryStore }> {
  const store = new MemoryStore();
  await store.open("map-camera-fixture");
  await store.insert("place", { name: "Cozy Bar", location: { lat: 52.52, lng: 13.405 } });
  if (saved !== undefined) await store.kvSet(CAMERA_KV, JSON.stringify(saved));

  const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: fixture(camera) });
  return { runtime: createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav }), store };
}

function View({ runtime }: { runtime: KartaRuntime }) {
  return <MapView runtime={runtime} pageId="map" params={{}} navigate={() => {}} onCreate={() => {}} />;
}

beforeEach(() => {
  spies.built = [];
  spies.fits = 0;
  spies.markers = 0;
  spies.handlers.clear();
});
afterEach(cleanup);

describe("camera", () => {
  it('defaults to "remember" and reopens at the saved position without re-framing', async () => {
    const { runtime } = await makeRuntime(undefined, { center: [13.4, 52.5], zoom: 14 });
    render(<View runtime={runtime} />);
    gate.open();

    await waitFor(() => expect(spies.built).toHaveLength(1));
    expect(spies.built[0]).toEqual({ center: [13.4, 52.5], zoom: 14 });
    // Fitting here would throw away the framing the user chose.
    await waitFor(() => expect(spies.markers).toBe(1));
    expect(spies.fits).toBe(0);
  });

  it("frames the markers on a first-ever open, when there is nothing to remember", async () => {
    const { runtime } = await makeRuntime();
    render(<View runtime={runtime} />);
    gate.open();

    await waitFor(() => expect(spies.markers).toBe(1));
    expect(spies.built[0]).toEqual({ center: [0, 20], zoom: 1 });
    expect(spies.fits).toBe(1);
  });

  it("records a move the user made, and ignores one it made itself", async () => {
    const { runtime, store } = await makeRuntime();
    render(<View runtime={runtime} />);
    gate.open();
    await waitFor(() => expect(spies.handlers.has("moveend")).toBe(true));

    // A programmatic fitBounds carries no originalEvent. Recording it would pin the map to its own
    // first guess forever, and the user's "remember where I left it" would never mean anything else.
    spies.handlers.get("moveend")!({});
    expect(await store.kvGet(CAMERA_KV)).toBeNull();

    spies.center = { lng: 9.9, lat: 45.1 };
    spies.zoom = 12;
    spies.handlers.get("moveend")!({ originalEvent: new Event("wheel") });

    await waitFor(async () => expect(await store.kvGet(CAMERA_KV)).not.toBeNull());
    expect(JSON.parse((await store.kvGet(CAMERA_KV))!)).toEqual({ center: [9.9, 45.1], zoom: 12 });
  });

  it('"fit" ignores a saved position and re-frames instead', async () => {
    const { runtime, store } = await makeRuntime("fit", { center: [13.4, 52.5], zoom: 14 });
    render(<View runtime={runtime} />);
    gate.open();

    await waitFor(() => expect(spies.markers).toBe(1));
    expect(spies.built[0]).toEqual({ center: [0, 20], zoom: 1 });
    expect(spies.fits).toBe(1);
    // ...and it does not quietly start remembering: a move the user makes changes nothing saved.
    const before = await store.kvGet(CAMERA_KV);
    spies.center = { lng: 9.9, lat: 45.1 };
    spies.handlers.get("moveend")?.({ originalEvent: new Event("wheel") });
    expect(await store.kvGet(CAMERA_KV)).toBe(before);
  });

  // #133 / #134: "the map opens on the trip I am in". The camera is a function of ctx and reads the
  // app-wide selection; a literal never could, and `ctx.params` is per page.
  it("a function camera opens where ctx.scope says, and falls back when nothing is selected", async () => {
    const camera = (ctx: Ctx): MapCamera => {
      const at = (ctx.scope.trip as { location?: { lat: number; lng: number } } | undefined)?.location;
      return at ? { center: [at.lng, at.lat], zoom: 11 } : "fit";
    };
    const { runtime, store } = await makeRuntime(camera);
    const berlin = await store.insert("trip", { city: "Berlin", location: { lat: 52.52, lng: 13.405 } });
    await runtime.setScope("trip", berlin.id);

    render(<View runtime={runtime} />);
    gate.open();

    await waitFor(() => expect(spies.markers).toBe(1));
    expect(spies.built[0]).toEqual({ center: [13.405, 52.52], zoom: 11 });
    expect(spies.fits).toBe(0);
    // Not "remember": a computed position must not be overwritten by a saved one.
    spies.handlers.get("moveend")?.({ originalEvent: new Event("wheel") });
    expect(await store.kvGet(CAMERA_KV)).toBeNull();
  });

  it("a fixed camera opens there and stays there", async () => {
    const { runtime, store } = await makeRuntime({ center: [2.35, 48.85], zoom: 11 });
    render(<View runtime={runtime} />);
    gate.open();

    await waitFor(() => expect(spies.markers).toBe(1));
    expect(spies.built[0]).toEqual({ center: [2.35, 48.85], zoom: 11 });
    expect(spies.fits).toBe(0);
    expect(await store.kvGet(CAMERA_KV)).toBeNull();
  });
});
