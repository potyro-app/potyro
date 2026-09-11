// `ctx.scope` (#134): an app-wide selected record that every filter can read synchronously.
//
// `ctx.params` is per page and `ctx.storage` is async, so before this there was no way for "the
// current trip" to reach a page's filter. These pin the three things the shell depends on: the
// selection is on `ctx` for the filter, changing it re-runs live watchers with no record written,
// and a function-valued view option sees it.

import { describe, expect, it } from "vitest";
import { MemoryStore } from "@karta/store";
import { defineApp, type Ctx } from "karta";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { FakeCapabilities } from "@karta/capabilities";
import { createRuntime, type KartaRuntime } from "../src/index.js";

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };

const app = () =>
  defineApp({
    id: "trips",
    name: "Trips",
    version: "1.0.0",
    schemaVersion: 1,
    scope: { entity: "trip" },
    entities: {
      trip: { label: "Trip", displayField: "city", fields: { city: { type: "text" }, location: { type: "geo" } } },
      place: { label: "Place", displayField: "name", fields: { name: { type: "text" }, trip: { type: "relation", to: "trip" }, location: { type: "geo" } } },
    },
    pages: [
      {
        id: "places",
        title: "Places",
        view: {
          type: "list",
          entity: "place",
          display: { primary: "name" },
          // Convention, not magic: the page narrows itself. Without a selection it shows everything.
          filter: (p, ctx) => !ctx.scope.trip || p.trip?.id === ctx.scope.trip.id,
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

async function setup(): Promise<{ runtime: KartaRuntime; store: MemoryStore; berlin: string; lisbon: string }> {
  const store = new MemoryStore();
  await store.open("trips");
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app() });
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
  const berlin = (await store.insert("trip", { city: "Berlin", location: { lat: 52.52, lng: 13.405 } })).id;
  const lisbon = (await store.insert("trip", { city: "Lisbon", location: { lat: 38.72, lng: -9.14 } })).id;
  await store.insert("place", { name: "Cozy Bar", trip: berlin });
  await store.insert("place", { name: "Pastelaria", trip: lisbon });
  return { runtime, store, berlin, lisbon };
}

describe("ctx.scope", () => {
  it("is present and empty before anything is selected, so filters can read it unconditionally", async () => {
    const { runtime } = await setup();
    expect(runtime.scope).toEqual({});
    const { rows, ctx } = await runtime.queryPage("places");
    expect(ctx.scope).toEqual({});
    expect(rows.map((r) => r.name)).toEqual(["Cozy Bar", "Pastelaria"]);
  });

  it("selecting a record narrows a page whose filter reads it — with no record written", async () => {
    const { runtime, berlin } = await setup();
    await runtime.setScope("trip", berlin);
    expect((runtime.scope.trip as { city?: string }).city).toBe("Berlin");
    const { rows } = await runtime.queryPage("places");
    expect(rows.map((r) => r.name)).toEqual(["Cozy Bar"]);
  });

  it("re-runs live watchers when the selection changes", async () => {
    const { runtime, berlin, lisbon } = await setup();
    const seen: string[][] = [];
    const stop = runtime.watchPageQuery("places", undefined, (s) => {
      if (!s.loading) seen.push(s.rows.map((r) => String(r.name)));
    });
    await new Promise((r) => setTimeout(r, 0));
    await runtime.setScope("trip", berlin);
    await new Promise((r) => setTimeout(r, 0));
    await runtime.setScope("trip", lisbon);
    await new Promise((r) => setTimeout(r, 0));
    await runtime.setScope("trip", null);
    await new Promise((r) => setTimeout(r, 0));
    stop();
    expect(seen.at(-1)).toEqual(["Cozy Bar", "Pastelaria"]);
    expect(seen).toContainEqual(["Cozy Bar"]);
    expect(seen).toContainEqual(["Pastelaria"]);
  });

  it("a function-valued view option sees the selection", async () => {
    const { runtime, berlin } = await setup();
    expect(await runtime.viewOption("map", "camera")).toBe("fit");
    await runtime.setScope("trip", berlin);
    expect(await runtime.viewOption("map", "camera")).toEqual({ center: [13.405, 52.52], zoom: 11 });
    // An option that was never declared is null, not an error.
    expect(await runtime.viewOption("places", "camera")).toBeNull();
  });
});
