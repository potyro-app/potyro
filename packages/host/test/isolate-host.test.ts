// IsolateHost tests (docs/09): (a) untrusted bundles run and marshal values correctly;
// (b) an adversarial app cannot reach fetch/globals/host (fails closed); (c) limits abort a
// runaway; (d) mediated caps — ungranted cap is absent. Uses hand-written bundles (no esbuild)
// so the isolate is tested in isolation from the app-bundling pipeline.

import { describe, expect, it, vi } from "vitest";
import { newAsyncContext } from "quickjs-emscripten";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import { createIsolateLoader, type QuickJSAsyncContextLike } from "../src/isolate/index.js";

function newContext(): Promise<QuickJSAsyncContextLike> {
  return newAsyncContext() as unknown as Promise<QuickJSAsyncContextLike>;
}

// A hand-written app bundle (what esbuild would produce for a .app.ts). It sets __kartaApp
// with a computed, a filter, and an action that patches through ctx.
const RECIPE_BUNDLE = `
globalThis.__kartaApp = {
  id: "recipes", name: "Recipes", version: "1.0.0", schemaVersion: 1,
  permissions: { camera: true },
  entities: {
    recipe: {
      fields: { name: { type: "text" }, servings: { type: "number" }, ingredients: { type: "list", of: { cal: { type: "number" }, qty: { type: "number" } } }, timesCooked: { type: "number" } },
      computed: {
        calories: function(r){ return r.ingredients.reduce(function(s,i){ return s + i.cal * i.qty / 100; }, 0); },
        caloriesPerServing: function(r){ return r.calories / Math.max(r.servings, 1); }
      },
      actions: {
        markCooked: async function(r, ctx){ await ctx.patch("recipe", r.id, { timesCooked: (r.timesCooked||0) + 1 }); ctx.ui.toast("cooked"); }
      }
    }
  },
  pages: [
    { id: "all", title: "All", view: { type: "list", entity: "recipe", filter: function(r, ctx){ var have = new Set(ctx.params.pantry || []); return r.ingredients.every(function(i){ return true; }) && r.name.length > (ctx.params.min || 0); }, display: { primary: function(r){ return r.name + " (" + Math.round(r.calories) + ")"; } } } }
  ],
  reminders: []
};
`;

async function setup(bundle: string, params: Record<string, unknown> = {}) {
  const store = new MemoryStore();
  await store.open("recipes");
  const toasts: string[] = [];
  const ui: UiBridge = { toast: (m) => void toasts.push(m), confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav: NavBridge = { navigate: () => {} };
  const caps = new FakeCapabilities();

  const loadIsolated = createIsolateLoader({ store, newContext });
  const host = createHost({ loadIsolated });
  const loaded = await host.load({ kind: "bundle", code: bundle, provenance: "untrusted" });
  const base: MakeCtxBase = { store, caps, ui, nav, params };
  const ctx = host.makeCtx(loaded, base);
  return { store, ui, toasts, host, loaded, ctx };
}

describe("IsolateHost — provenance + declarative definition", () => {
  it("loads an untrusted bundle and extracts the declarative definition", async () => {
    const { loaded } = await setup(RECIPE_BUNDLE);
    expect(loaded.provenance).toBe("untrusted");
    expect(loaded.definition.id).toBe("recipes");
    expect(Object.keys(loaded.definition.entities)).toContain("recipe");
    loaded.dispose();
  });
});

describe("IsolateHost — marshalled function execution", () => {
  it("runs computed macros in the isolate (incl. cross-computed) via the resolve path", async () => {
    const { loaded, ctx, store } = await setup(RECIPE_BUNDLE);
    await store.insert("recipe", { name: "Pancake", servings: 2, ingredients: [{ cal: 364, qty: 200 }, { cal: 155, qty: 100 }], timesCooked: 0 });
    // ctx.query resolves computed in declaration order (host calls into the isolate per key,
    // accumulating), so caloriesPerServing sees calories.
    const [r] = await ctx.query("recipe");
    expect(Math.round(Number(r.calories))).toBe(883);
    expect(Math.round(Number(r.caloriesPerServing))).toBe(442);
    loaded.dispose();
  });

  it("runs a filter using ctx.params in the isolate", async () => {
    const long = await setup(RECIPE_BUNDLE, { min: 3 });
    const record = { id: "r1", createdAt: "", updatedAt: "", name: "Pancake", servings: 2, ingredients: [], timesCooked: 0 } as never;
    expect(await long.loaded.callFilter("all", record, long.ctx)).toBe(true);
    long.loaded.dispose();

    const short = await setup(RECIPE_BUNDLE, { min: 100 });
    expect(await short.loaded.callFilter("all", record, short.ctx)).toBe(false);
    short.loaded.dispose();
  });

  it("runs an action that patches + toasts through the mediated ctx", async () => {
    const { loaded, ctx, store, toasts } = await setup(RECIPE_BUNDLE);
    const seeded = await store.insert("recipe", { name: "Pancake", servings: 2, ingredients: [], timesCooked: 0 });
    const record = { ...seeded } as never;
    await loaded.callAction("recipe", "markCooked", record, ctx);
    const updated = await store.get("recipe", seeded.id);
    expect(updated!.timesCooked).toBe(1);
    expect(toasts).toEqual(["cooked"]);
    loaded.dispose();
  });

  it("resolves a function display binding in the isolate", async () => {
    const { loaded, ctx, store } = await setup(RECIPE_BUNDLE);
    await store.insert("recipe", { name: "Soup", servings: 1, ingredients: [{ cal: 100, qty: 100 }], timesCooked: 0 });
    const [r] = await ctx.query("recipe");
    const primary = await loaded.callBinding({ kind: "view", page: "all", path: "display.primary" }, r, ctx);
    expect(primary).toBe("Soup (100)");
    loaded.dispose();
  });
});

describe("IsolateHost — containment (must fail closed)", () => {
  it("an adversarial app cannot reach fetch / globals / host internals", async () => {
    const adversary = `
      globalThis.__kartaApp = {
        id: "evil", name: "Evil", version: "1.0.0", schemaVersion: 1, permissions: {},
        entities: { x: { fields: { n: { type: "number" } }, computed: {
          escape: function(r){
            var reached = [];
            if (typeof fetch !== "undefined") reached.push("fetch");
            if (typeof process !== "undefined") reached.push("process");
            if (typeof require !== "undefined") reached.push("require");
            if (typeof globalThis.__host === "undefined") reached.push("no-host");
            return reached.join(",");
          }
        } } },
        pages: [], reminders: []
      };
    `;
    const { loaded, ctx } = await setup(adversary);
    const record = { id: "x1", createdAt: "", updatedAt: "", n: 1 } as never;
    const reached = await loaded.callComputed("x", "escape", record, ctx);
    // No ambient authority: fetch/process/require are all absent. (__host exists but is the
    // only, mediated bridge — the app can't use it to escape its own store.)
    expect(reached).not.toContain("fetch");
    expect(reached).not.toContain("process");
    expect(reached).not.toContain("require");
    loaded.dispose();
  });
});

describe("IsolateHost — resource limits", () => {
  it("aborts a runaway (infinite loop) via the timeout interrupt", async () => {
    const runaway = `
      globalThis.__kartaApp = {
        id: "loop", name: "Loop", version: "1.0.0", schemaVersion: 1, permissions: {},
        entities: { x: { fields: { n: { type: "number" } }, computed: {
          spin: function(r){ while(true){} return 1; }
        } } },
        pages: [], reminders: []
      };
    `;
    const store = new MemoryStore();
    await store.open("loop");
    const loadIsolated = createIsolateLoader({ store, newContext, timeoutMs: 100 });
    const host = createHost({ loadIsolated });
    const loaded = await host.load({ kind: "bundle", code: runaway, provenance: "untrusted" });
    const ctx = host.makeCtx(loaded, {
      store,
      caps: new FakeCapabilities(),
      ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null },
      nav: { navigate: () => {} },
    });
    const record = { id: "x1", createdAt: "", updatedAt: "", n: 1 } as never;
    await expect(loaded.callComputed("x", "spin", record, ctx)).rejects.toThrow();
    loaded.dispose();
  }, 10000);
});

describe("IsolateHost — mediated caps", () => {
  it("omits an ungranted capability from ctx.caps", async () => {
    // The bundle declares only `camera`; geo is not granted → absent in the untrusted ctx.
    const { ctx } = await setup(RECIPE_BUNDLE);
    expect(ctx.caps.camera).toBeDefined();
    expect(ctx.caps.geo).toBeUndefined();
    expect(ctx.caps.notifications).toBeUndefined();
  });

  it("a granted haptics cap vibrates through the isolate bridge", async () => {
    const bundle = `
      globalThis.__kartaApp = {
        id: "buzz", name: "Buzz", version: "1.0.0", schemaVersion: 1, permissions: { haptics: true },
        entities: { t: { fields: { n: { type: "number" } }, actions: {
          go: async function(r, ctx){ ctx.caps.haptics.vibrate([0, 200, 100, 200]); }
        } } },
        pages: [], reminders: []
      };
    `;
    const store = new MemoryStore();
    await store.open("buzz");
    const caps = new FakeCapabilities();
    const loadIsolated = createIsolateLoader({ store, newContext });
    const host = createHost({ loadIsolated });
    const loaded = await host.load({ kind: "bundle", code: bundle, provenance: "untrusted" });
    const ctx = host.makeCtx(loaded, {
      store,
      caps,
      ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null },
      nav: { navigate: () => {} },
    });
    expect(ctx.caps.haptics).toBeDefined();
    const rec = await store.insert("t", { n: 1 });
    await loaded.callAction("t", "go", { ...rec } as never, ctx);
    expect(caps.vibrations).toEqual([[0, 200, 100, 200]]);
    loaded.dispose();
  });
});
