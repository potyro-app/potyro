// `ctx.scope` and `callViewOption` across both hosts (#134, #133).
//
// The selection must reach app code identically whether the app runs directly or in the isolate:
// a shared trip planner is exactly the app whose filters read `ctx.scope`, and it runs untrusted.

import { describe, expect, it } from "vitest";
import { newAsyncContext } from "quickjs-emscripten";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { defineApp, type Ctx } from "karta";
import { createHost, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import { createIsolateLoader, type QuickJSAsyncContextLike } from "../src/isolate/index.js";

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };
const newContext = (): Promise<QuickJSAsyncContextLike> => newAsyncContext() as unknown as Promise<QuickJSAsyncContextLike>;

const berlin = { id: "t1", createdAt: "", updatedAt: "", city: "Berlin", location: { lat: 52.52, lng: 13.405 } };

const trusted = () =>
  defineApp({
    id: "trips",
    name: "Trips",
    version: "1.0.0",
    schemaVersion: 1,
    scope: { entity: "trip" },
    entities: {
      trip: { displayField: "city", fields: { city: { type: "text" }, location: { type: "geo" } } },
      place: { displayField: "name", fields: { name: { type: "text" }, trip: { type: "relation", to: "trip" }, location: { type: "geo" } } },
    },
    pages: [
      { id: "places", title: "Places", view: { type: "list", entity: "place", filter: (p, ctx) => !ctx.scope.trip || p.trip?.id === ctx.scope.trip.id } },
      {
        id: "map",
        title: "Map",
        view: {
          type: "map",
          entity: "place",
          geo: "location",
          camera: (ctx: Ctx) => {
            const at = (ctx.scope.trip as { location?: { lat: number; lng: number } } | undefined)?.location;
            return at ? { center: [at.lng, at.lat] as [number, number], zoom: 11 } : "fit";
          },
        },
      },
    ],
  });

// The same app as the isolate sees it: a bundle that sets __kartaApp.
const UNTRUSTED_BUNDLE = `
globalThis.__kartaApp = {
  id: "trips", name: "Trips", version: "1.0.0", schemaVersion: 1,
  scope: { entity: "trip" },
  entities: {
    trip: { displayField: "city", fields: { city: { type: "text" }, location: { type: "geo" } } },
    place: { displayField: "name", fields: { name: { type: "text" }, trip: { type: "relation", to: "trip" }, location: { type: "geo" } } }
  },
  pages: [
    { id: "places", title: "Places", view: { type: "list", entity: "place",
        filter: function(p, ctx){ return !ctx.scope.trip || (p.trip && p.trip.id === ctx.scope.trip.id); } } },
    { id: "map", title: "Map", view: { type: "map", entity: "place", geo: "location",
        camera: function(ctx){ var at = ctx.scope.trip && ctx.scope.trip.location; return at ? { center: [at.lng, at.lat], zoom: 11 } : "fit"; } } }
  ]
};
`;

async function direct(extra: Partial<MakeCtxBase> = {}) {
  const store = new MemoryStore();
  await store.open("trips");
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: trusted() });
  return { loaded, ctx: host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav, ...extra }) };
}

async function isolated(extra: Partial<MakeCtxBase> = {}) {
  const store = new MemoryStore();
  await store.open("trips");
  const host = createHost({ loadIsolated: createIsolateLoader({ store, newContext }) });
  const loaded = await host.load({ kind: "bundle", code: UNTRUSTED_BUNDLE, provenance: "untrusted" });
  return { loaded, ctx: host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav, ...extra }) };
}

const inBerlin = { id: "p1", createdAt: "", updatedAt: "", name: "Cozy Bar", trip: berlin };
const elsewhere = { id: "p2", createdAt: "", updatedAt: "", name: "Pastelaria", trip: { ...berlin, id: "t2", city: "Lisbon" } };

for (const [name, setup] of [
  ["direct (trusted)", direct],
  ["isolate (untrusted)", isolated],
] as const) {
  describe(`ctx.scope — ${name}`, () => {
    it("is {} when nothing is selected, and a filter reading it passes everything", async () => {
      const { loaded, ctx } = await setup();
      expect(ctx.scope).toEqual({});
      expect(await loaded.callFilter("places", inBerlin, ctx)).toBe(true);
      expect(await loaded.callFilter("places", elsewhere, ctx)).toBe(true);
      loaded.dispose?.();
    });

    it("carries the selected record into a filter", async () => {
      const { loaded, ctx } = await setup({ scope: { trip: berlin } });
      expect((ctx.scope.trip as { city?: string }).city).toBe("Berlin");
      expect(await loaded.callFilter("places", inBerlin, ctx)).toBe(true);
      expect(await loaded.callFilter("places", elsewhere, ctx)).toBe(false);
      loaded.dispose?.();
    });

    it("resolves a function-valued camera with the selection, and a literal as itself", async () => {
      const { loaded, ctx } = await setup({ scope: { trip: berlin } });
      expect(await loaded.callViewOption("map", "camera", ctx)).toEqual({ center: [13.405, 52.52], zoom: 11 });
      expect(await loaded.callViewOption("map", "geo", ctx)).toBe("location");
      expect(await loaded.callViewOption("places", "camera", ctx)).toBeNull();
      loaded.dispose?.();
    });
  });
}
