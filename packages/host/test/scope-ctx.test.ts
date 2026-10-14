// `ctx.scope` and `callViewOption` across both hosts (#134, #133).
//
// The selection must reach app code identically whether the app runs directly or sealed (realm or isolate):
// a shared trip planner is exactly the app whose filters read `ctx.scope`, and it runs untrusted.

import { describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { defineApp, type Ctx } from "potyro";
import { createHost, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import { RUNNERS, type Runner } from "./runners.js";

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };

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
      {
        id: "places",
        // A page title and a sort that read ctx (#133).
        title: (ctx: Ctx) => (ctx.scope.trip ? `Places in ${String((ctx.scope.trip as { city?: string }).city)}` : "Places"),
        view: {
          type: "list",
          entity: "place",
          filter: (p, ctx) => !ctx.scope.trip || p.trip?.id === ctx.scope.trip.id,
          sort: (a, b, ctx) => (ctx.params.desc ? String(b.name).localeCompare(String(a.name)) : String(a.name).localeCompare(String(b.name))),
        },
      },
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

// The same app as the isolate sees it: a bundle that sets __potyroApp.
const UNTRUSTED_BUNDLE = `
globalThis.__potyroApp = {
  id: "trips", name: "Trips", version: "1.0.0", schemaVersion: 1,
  scope: { entity: "trip" },
  entities: {
    trip: { displayField: "city", fields: { city: { type: "text" }, location: { type: "geo" } } },
    place: { displayField: "name", fields: { name: { type: "text" }, trip: { type: "relation", to: "trip" }, location: { type: "geo" } } }
  },
  pages: [
    { id: "places", title: function(ctx){ return ctx.scope.trip ? "Places in " + ctx.scope.trip.city : "Places"; }, view: { type: "list", entity: "place",
        filter: function(p, ctx){ return !ctx.scope.trip || (p.trip && p.trip.id === ctx.scope.trip.id); },
        sort: function(a, b, ctx){ return ctx.params.desc ? String(b.name).localeCompare(String(a.name)) : String(a.name).localeCompare(String(b.name)); } } },
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

const isolated = (runner: Runner) => async (extra: Partial<MakeCtxBase> = {}) => {
  const store = new MemoryStore();
  await store.open("trips");
  const host = createHost({ loadIsolated: await runner.loader(store) });
  const loaded = await host.load({ kind: "bundle", code: UNTRUSTED_BUNDLE, provenance: "untrusted" });
  return { loaded, ctx: host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav, ...extra }) };
};

const inBerlin = { id: "p1", createdAt: "", updatedAt: "", name: "Cozy Bar", trip: berlin };
const elsewhere = { id: "p2", createdAt: "", updatedAt: "", name: "Pastelaria", trip: { ...berlin, id: "t2", city: "Lisbon" } };

for (const [name, setup] of [
  ["direct (trusted)", direct],
  ...RUNNERS.map((r) => [`${r.name} (untrusted)`, isolated(r)] as const),
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

    it("a sort reads ctx (#133): the page's params decide the direction", async () => {
      const { loaded, ctx } = await setup({ params: { desc: true } });
      expect(await loaded.callSort("places", inBerlin, elsewhere, ctx)).toBeGreaterThan(0);
      const { loaded: asc, ctx: ascCtx } = await setup();
      expect(await asc.callSort("places", inBerlin, elsewhere, ascCtx)).toBeLessThan(0);
      loaded.dispose?.();
      asc.dispose?.();
    });

    it("a page title is a function of the selection (#133)", async () => {
      const { loaded, ctx } = await setup({ scope: { trip: berlin } });
      expect(await loaded.callPageOption("places", "title", ctx)).toBe("Places in Berlin");
      expect(await loaded.callPageOption("map", "title", ctx)).toBe("Map");
      expect(await loaded.callPageOption("map", "nothing", ctx)).toBeNull();
      loaded.dispose?.();
    });
  });
}
