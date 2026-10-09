// An UNTRUSTED app moving a view that is on screen (#216).
//
// `ctx.views` is the answer to "add a button that centres the map on my location", which no app
// could do while a map's camera was only read when the view opened. The trusted path is the easy
// half; this is the other one: for an untrusted app the button's function never leaves the isolate,
// so the call has to cross the string bridge as an op and come back with an answer.
//
// What is pinned here is that it crosses at all, that the answer comes back (a page with no view on
// screen is `false`, not a crash), and that an app cannot smuggle anything but a page and a verb.

import { describe, expect, it } from "vitest";
import { newAsyncContext } from "quickjs-emscripten";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import { createIsolateLoader, type QuickJSAsyncContextLike } from "../src/isolate/index.js";

function newContext(): Promise<QuickJSAsyncContextLike> {
  return newAsyncContext() as unknown as Promise<QuickJSAsyncContextLike>;
}

/** What esbuild would produce for an app whose map page carries a "centre on me" button. */
const BUNDLE = `
globalThis.__potyroApp = {
  id: "places", name: "Places", version: "1.0.0", schemaVersion: 1,
  entities: { place: { fields: { name: { type: "text" }, at: { type: "geo" } } } },
  pages: [
    {
      id: "map", title: "Map",
      actions: [
        { label: "Centre on me", run: async function(ctx){ var ok = await ctx.views.map("map").flyTo({ center: [13.4, 52.5], zoom: 15 }); ctx.ui.toast("flew:" + ok); } },
        { label: "Show all", run: async function(ctx){ var ok = await ctx.views.map("map").fit(); ctx.ui.toast("fit:" + ok); } },
        { label: "Elsewhere", run: async function(ctx){ var ok = await ctx.views.map("other").fit(); ctx.ui.toast("other:" + ok); } }
      ],
      view: { type: "map", entity: "place", geo: "at" }
    }
  ],
  reminders: []
};
`;

async function setup(onCall?: (pageId: string, verb: string, arg?: unknown) => boolean) {
  const store = new MemoryStore();
  await store.open("places");
  const toasts: string[] = [];
  const calls: Array<{ pageId: string; verb: string; arg: unknown }> = [];
  const ui: UiBridge = { toast: (m) => void toasts.push(m), confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };

  const loadIsolated = createIsolateLoader({ store, newContext });
  const host = createHost({ loadIsolated });
  const loaded = await host.load({ kind: "bundle", code: BUNDLE, provenance: "untrusted" });
  const base: MakeCtxBase = {
    store,
    caps: new FakeCapabilities(),
    ui,
    nav,
    views: {
      call: async (pageId, verb, arg) => {
        calls.push({ pageId, verb, arg });
        return onCall ? onCall(pageId, verb, arg) : true;
      },
    },
  };
  return { loaded, ctx: host.makeCtx(loaded, base), toasts, calls };
}

describe("ctx.views from inside the isolate", () => {
  it("carries an untrusted app's flyTo out to the view, and the answer back in", async () => {
    const { loaded, ctx, toasts, calls } = await setup();

    await loaded.callPageAction("map", 0, ctx);

    expect(calls).toEqual([{ pageId: "map", verb: "map.flyTo", arg: { center: [13.4, 52.5], zoom: 15 } }]);
    // The app SAW the answer: the value made the round trip, it was not fired into the dark.
    expect(toasts).toEqual(["flew:true"]);
  });

  it("carries fit, which takes no argument", async () => {
    const { loaded, ctx, toasts, calls } = await setup();

    await loaded.callPageAction("map", 1, ctx);

    expect(calls[0]).toMatchObject({ pageId: "map", verb: "map.fit" });
    expect(toasts).toEqual(["fit:true"]);
  });

  it("answers false when nothing is on screen to take it, rather than failing the action", async () => {
    const { loaded, ctx, toasts } = await setup(() => false);

    await loaded.callPageAction("map", 2, ctx);

    expect(toasts).toEqual(["other:false"]);
  });
});
