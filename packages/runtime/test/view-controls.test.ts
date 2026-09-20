// `ctx.views` (#216) — an app reaching a view that is on screen.
//
// The gap this closes: a map's `camera` is read once, when the view opens, so nothing an app could
// write moved the map afterwards. Asked for "a small button that centres the map on my location",
// the generator correctly answered that the platform could not do it — no action, no ctx member, no
// button. These pin the mechanism that makes it ordinary app code: a page declares a button, the
// button's function calls `ctx.views`, and the view that is mounted takes the call.

import { describe, expect, it } from "vitest";
import { MemoryStore } from "@karta/store";
import { defineApp, type Ctx } from "karta";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { FakeCapabilities } from "@karta/capabilities";
import { createRuntime, type KartaRuntime } from "../src/index.js";

const toasts: string[] = [];
const ui: UiBridge = { toast: (m) => void toasts.push(m), confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };

/** Where the app's button asked the map to go, recorded by the test's stand-in for the map view. */
const moves: Array<{ verb: string; arg: unknown }> = [];

const app = () =>
  defineApp({
    id: "places",
    name: "Places",
    version: "1.0.0",
    schemaVersion: 1,
    entities: { place: { label: "Place", displayField: "name", fields: { name: { type: "text" }, at: { type: "geo" } } } },
    pages: [
      {
        id: "map",
        title: "Map",
        actions: [
          { label: "Centre on me", run: async (ctx: Ctx) => void (await ctx.views.map("map").flyTo({ center: [13.4, 52.5], zoom: 15 })) },
          { label: "Show all", run: async (ctx: Ctx) => void (await ctx.views.map("map").fit()) },
          { label: "Explodes", run: () => { throw new Error("the button's own fault"); } },
        ],
        view: { type: "map", entity: "place", geo: "at" },
      },
      { id: "list", title: "List", view: { type: "list", entity: "place", display: { primary: "name" } } },
    ],
  });

async function setup(): Promise<KartaRuntime> {
  const store = new MemoryStore();
  await store.open("places");
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app() });
  return createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
}

/** Stand in for a mounted map view: takes the map verbs, declines everything else. */
function mountMap(runtime: KartaRuntime, pageId = "map"): () => void {
  return runtime.registerViewControl(pageId, (verb, arg) => {
    if (!verb.startsWith("map.")) return false;
    moves.push({ verb, arg });
    return true;
  });
}

describe("ctx.views", () => {
  it("moves the map that is on screen when the page's button is pressed", async () => {
    moves.length = 0;
    const runtime = await setup();
    mountMap(runtime);

    await runtime.runPageAction("map", 0);

    expect(moves).toEqual([{ verb: "map.flyTo", arg: { center: [13.4, 52.5], zoom: 15 } }]);
  });

  it("answers false when that page's view is not on screen, rather than throwing", async () => {
    // The case an app cannot prevent: the action is still running when the person navigates away.
    // A rejection here would surface as "something went wrong" for a button that did its job.
    const runtime = await setup();
    let answered: boolean | "threw" = "threw";
    try {
      answered = await runtime.ctx.views.map("map").flyTo({ center: [0, 0] });
    } catch {
      answered = "threw";
    }
    expect(answered).toBe(false);
  });

  it("stops reaching a view once it is unmounted", async () => {
    moves.length = 0;
    const runtime = await setup();
    const unmount = mountMap(runtime);
    expect(await runtime.ctx.views.map("map").fit()).toBe(true);

    unmount();

    expect(await runtime.ctx.views.map("map").fit()).toBe(false);
    expect(moves).toHaveLength(1);
  });

  it("offers the call to each view on a page until one takes it", async () => {
    // A layout page (#105) shows several views at once. Addressing by page id only works because a
    // view that does not know the verb declines instead of swallowing it.
    moves.length = 0;
    const runtime = await setup();
    const declined: string[] = [];
    runtime.registerViewControl("map", (verb) => {
      declined.push(verb); // a list sharing the page: knows nothing about maps
      return false;
    });
    mountMap(runtime);

    expect(await runtime.ctx.views.map("map").fit()).toBe(true);
    expect(declined).toEqual(["map.fit"]);
    expect(moves).toEqual([{ verb: "map.fit", arg: undefined }]);
  });

  it("does not reach a map on a different page", async () => {
    moves.length = 0;
    const runtime = await setup();
    mountMap(runtime, "list");

    expect(await runtime.ctx.views.map("map").fit()).toBe(false);
    expect(moves).toHaveLength(0);
  });

  it("tells the person when a button's own code fails, instead of failing silently", async () => {
    // Buttons are fired as `void runPageAction(...)` from a click handler, so an escaping rejection
    // would reach nobody but the console.
    toasts.length = 0;
    const runtime = await setup();

    await runtime.runPageAction("map", 2);

    expect(toasts).toEqual(["the button's own fault"]);
  });
});
