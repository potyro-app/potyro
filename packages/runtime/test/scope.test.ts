// `ctx.scope` (#134): an app-wide selected record that every filter can read synchronously.
//
// `ctx.params` is per page and `ctx.storage` is async, so before this there was no way for "the
// current trip" to reach a page's filter. These pin the three things the shell depends on: the
// selection is on `ctx` for the filter, changing it re-runs live watchers with no record written,
// and a function-valued view option sees it.

import { describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { defineApp, type Ctx } from "potyro";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { FakeCapabilities } from "@potyro/capabilities";
import { createRuntime, type PotyroRuntime } from "../src/index.js";

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
        title: (ctx: Ctx) => (ctx.scope.trip ? `Places in ${String((ctx.scope.trip as { city?: string }).city)}` : "Places"),
        view: {
          type: "list",
          entity: "place",
          display: { primary: "name" },
          // Convention, not magic: the page narrows itself. Without a selection it shows everything.
          filter: (p, ctx) => !ctx.scope.trip || p.trip?.id === ctx.scope.trip.id,
          sort: (a, b, ctx) => (ctx.params.desc ? String(b.name).localeCompare(String(a.name)) : String(a.name).localeCompare(String(b.name))),
          emptyText: (ctx: Ctx) => `No places in ${String((ctx.scope.trip as { city?: string } | undefined)?.city ?? "any trip")} yet`,
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

async function setup(): Promise<{ runtime: PotyroRuntime; store: MemoryStore; berlin: string; lisbon: string }> {
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

  it("a sort reads ctx, so a page's chips can decide the order (#133)", async () => {
    const { runtime } = await setup();
    expect((await runtime.queryPage("places")).rows.map((r) => r.name)).toEqual(["Cozy Bar", "Pastelaria"]);
    expect((await runtime.queryPage("places", { desc: true })).rows.map((r) => r.name)).toEqual(["Pastelaria", "Cozy Bar"]);
  });

  it("a page title and an empty text follow the selection (#133)", async () => {
    const { runtime, lisbon } = await setup();
    expect(await runtime.pageOption("places", "title")).toBe("Places");
    expect(await runtime.viewOption("places", "emptyText")).toBe("No places in any trip yet");
    await runtime.setScope("trip", lisbon);
    expect(await runtime.pageOption("places", "title")).toBe("Places in Lisbon");
    expect(await runtime.viewOption("places", "emptyText")).toBe("No places in Lisbon yet");
    // A literal page option comes back as itself.
    expect(await runtime.pageOption("map", "title")).toBe("Map");
  });

  it("a function-valued view option sees the selection", async () => {
    const { runtime, berlin } = await setup();
    expect(await runtime.viewOption("map", "camera")).toBe("fit");
    await runtime.setScope("trip", berlin);
    expect(await runtime.viewOption("map", "camera")).toEqual({ center: [13.405, 52.52], zoom: 11 });
    // An option that was never declared is null, not an error.
    expect(await runtime.viewOption("places", "camera")).toBeNull();
  });

  describe("is live: the selected record as it is now, not as it was when it was picked", () => {
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    };

    it("an edit to the selected record reaches ctx.scope and re-runs live watchers, with no reselect", async () => {
      const { runtime, store, berlin } = await setup();
      await runtime.setScope("trip", berlin);
      const titles: string[] = [];
      const stop = runtime.core.onInvalidate(() => void runtime.pageOption("places", "title").then((t) => titles.push(String(t))));
      await store.update("trip", berlin, { city: "Berlin-Mitte" });
      await settle();
      stop();
      expect((runtime.scope.trip as { city?: string }).city).toBe("Berlin-Mitte");
      expect((runtime.ctx.scope.trip as { city?: string }).city).toBe("Berlin-Mitte");
      expect(titles.at(-1)).toBe("Places in Berlin-Mitte");
      expect(await runtime.viewOption("places", "emptyText")).toBe("No places in Berlin-Mitte yet");
    });

    it("a write to another record of the entity changes nothing, and re-runs nothing", async () => {
      const { runtime, store, berlin, lisbon } = await setup();
      await runtime.setScope("trip", berlin);
      let runs = 0;
      const stop = runtime.core.onInvalidate(() => void runs++);
      await store.update("trip", lisbon, { city: "Porto" });
      await settle();
      stop();
      expect(runs).toBe(0);
      expect((runtime.scope.trip as { city?: string }).city).toBe("Berlin");
    });

    it("a record deleted while selected is no longer selected", async () => {
      const { runtime, store, berlin } = await setup();
      await runtime.setScope("trip", berlin);
      await store.delete("trip", berlin);
      await settle();
      expect(runtime.scope.trip).toBeUndefined();
      expect((await runtime.queryPage("places")).rows.map((r) => r.name)).toEqual(["Cozy Bar", "Pastelaria"]);
    });

    it("an old selection's re-read never lands over a newer selection", async () => {
      const { runtime, store, berlin, lisbon } = await setup();
      await runtime.setScope("trip", berlin);
      const write = store.update("trip", berlin, { city: "Berlin-Mitte" });
      await runtime.setScope("trip", lisbon);
      await write;
      await settle();
      expect((runtime.scope.trip as { city?: string }).city).toBe("Lisbon");
      // And the old one is no longer followed: editing it now changes nothing.
      await store.update("trip", berlin, { city: "Berlin-Kreuzberg" });
      await settle();
      expect((runtime.scope.trip as { city?: string }).city).toBe("Lisbon");
    });

    it("a selection cleared stops following the record", async () => {
      const { runtime, store, berlin } = await setup();
      await runtime.setScope("trip", berlin);
      await runtime.setScope("trip", null);
      await store.update("trip", berlin, { city: "Berlin-Mitte" });
      await settle();
      expect(runtime.scope.trip).toBeUndefined();
    });
  });
});
