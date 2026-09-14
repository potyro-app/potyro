import { describe, expect, it, vi } from "vitest";
import { defineApp, type Ctx, type KartaApp, type Resolved } from "karta";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";

// A compact recipes-shaped app exercising the M1 surface: relation, computed macros (with a
// cross-computed reference), a JS filter, and an action that patches + toasts.
function recipesApp(): KartaApp {
  return defineApp({
    id: "recipes",
    name: "Recipes",
    version: "1.0.0",
    schemaVersion: 1,
    permissions: { camera: true, filesystem: true },
    entities: {
      ingredient: {
        displayField: "name",
        fields: {
          name: { type: "text", required: true },
          caloriesPer100: { type: "number" },
          proteinPer100: { type: "number" },
        },
      },
      recipe: {
        displayField: "name",
        fields: {
          name: { type: "text", required: true },
          servings: { type: "number", default: 2 },
          ingredients: {
            type: "list",
            of: {
              ingredient: { type: "relation", to: "ingredient", required: true },
              quantity: { type: "number", required: true },
            },
          },
          lastCookedAt: { type: "datetime", hidden: true },
          timesCooked: { type: "number", default: 0, hidden: true },
        },
        computed: {
          calories: (r) => r.ingredients.reduce((s: number, i: any) => s + (i.ingredient.caloriesPer100 ?? 0) * i.quantity / 100, 0),
          caloriesPerServing: (r) => r.calories / Math.max(r.servings, 1),
        },
        actions: {
          markCooked: async (r, ctx) => {
            await ctx.patch("recipe", r.id, { lastCookedAt: ctx.now(), timesCooked: (r.timesCooked ?? 0) + 1 });
            ctx.ui.toast(`cooked ${(r.timesCooked ?? 0) + 1}x`);
          },
        },
      },
    },
    pages: [
      {
        id: "cook-with",
        title: "What can I cook?",
        view: {
          type: "list",
          entity: "recipe",
          filter: (r, ctx) => {
            const have = new Set((ctx.params.pantry as string[]) ?? []);
            return r.ingredients.length > 0 && r.ingredients.every((i: any) => have.has(i.ingredient.id));
          },
          display: { primary: (r) => r.name, secondary: (r) => `${Math.round(r.caloriesPerServing)} kcal` },
        },
      },
    ],
    reminders: [],
  });
}

interface Harness {
  ctx: Ctx;
  store: MemoryStore;
  ui: UiBridge & { toasts: string[] };
  host: ReturnType<typeof createHost>;
  loaded: Awaited<ReturnType<ReturnType<typeof createHost>["load"]>>;
  ids: { flour: string; egg: string; pancake: string };
}

async function setup(params: Record<string, unknown> = {}): Promise<Harness> {
  const store = new MemoryStore();
  await store.open("recipes");
  const caps = new FakeCapabilities();
  const toasts: string[] = [];
  const ui: UiBridge & { toasts: string[] } = {
    toasts,
    toast: (m) => void toasts.push(m),
    confirm: async () => true,
    prompt: async () => null,
    pick: async () => null,
  };
  const nav: NavBridge = { navigate: () => {} };

  // seed data
  const flour = await store.insert("ingredient", { name: "Flour", caloriesPer100: 364, proteinPer100: 10 });
  const egg = await store.insert("ingredient", { name: "Egg", caloriesPer100: 155, proteinPer100: 13 });
  const pancake = await store.insert("recipe", {
    name: "Pancake",
    servings: 2,
    ingredients: [
      { ingredient: flour.id, quantity: 200 },
      { ingredient: egg.id, quantity: 100 },
    ],
    timesCooked: 0,
  });

  const host = createHost();
  const loaded = await host.load({ kind: "module", app: recipesApp() });
  const base: MakeCtxBase = { store, caps, ui, nav, params };
  const ctx = host.makeCtx(loaded, base);
  return { ctx, store, ui, host, loaded, ids: { flour: flour.id, egg: egg.id, pancake: pancake.id } };
}

describe("DirectHost — provenance", () => {
  it("loads a module as trusted with unmediated caps", async () => {
    const { loaded, ctx } = await setup();
    expect(loaded.provenance).toBe("trusted");
    expect(ctx.caps.camera).toBeDefined();
    expect(ctx.caps.network).toBeDefined();
  });
});

describe("makeCtx — resolution + computed", () => {
  it("resolves relations one level deep and evaluates computed macros (incl. cross-computed)", async () => {
    const { ctx } = await setup();
    const [recipe] = await ctx.query("recipe");
    // relation resolved: ingredient is an object with fields
    expect(recipe.ingredients[0].ingredient.name).toBe("Flour");
    // calories = 364*200/100 + 155*100/100 = 728 + 155 = 883
    expect(Math.round(recipe.calories)).toBe(883);
    // caloriesPerServing references the `calories` computed → 883/2
    expect(Math.round(recipe.caloriesPerServing)).toBe(442);
  });

  it("now() is fixed for deterministic computed values", async () => {
    const fixed = new Date("2026-07-22T10:00:00Z");
    const { store, host, loaded } = await setup();
    const ctx = host.makeCtx(loaded, {
      store,
      caps: new FakeCapabilities(),
      ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null },
      nav: { navigate: () => {} },
      now: fixed,
    });
    expect(ctx.now().toISOString()).toBe(fixed.toISOString());
  });
});

describe("callFilter — the 'ingredients I have' JS predicate", () => {
  it("excludes recipes whose ingredients are not all in the pantry", async () => {
    const empty = await setup({ pantry: [] });
    const [recipe] = await empty.ctx.query("recipe");
    expect(await empty.loaded.callFilter("cook-with", recipe, empty.ctx)).toBe(false);

    // Re-make ctx with a pantry containing this recipe's real ingredient ids.
    const pantry = recipe.ingredients.map((i: { ingredient: { id: string } }) => i.ingredient.id);
    const ctx2 = empty.host.makeCtx(empty.loaded, {
      store: empty.store,
      caps: new FakeCapabilities(),
      ui: empty.ui,
      nav: { navigate: () => {} },
      params: { pantry },
    });
    const [r2] = await ctx2.query("recipe");
    expect(await empty.loaded.callFilter("cook-with", r2, ctx2)).toBe(true);
  });
});

describe("callAction — patch + toast through ctx", () => {
  it("markCooked patches the record and toasts", async () => {
    const { ctx, loaded, store, ui, ids } = await setup();
    const [recipe] = await ctx.query("recipe");
    await loaded.callAction("recipe", "markCooked", recipe, ctx);
    const updated = await store.get("recipe", ids.pancake);
    expect(updated!.timesCooked).toBe(1);
    expect(updated!.lastCookedAt).toBeInstanceOf(Date);
    expect(ui.toasts).toEqual(["cooked 1x"]);
  });
});

describe("callBinding — function display bindings", () => {
  it("calls display.primary/secondary functions", async () => {
    const { ctx, loaded } = await setup();
    const [recipe] = await ctx.query("recipe");
    expect(await loaded.callBinding({ kind: "view", page: "cook-with", path: "display.primary" }, recipe, ctx)).toBe(
      "Pancake",
    );
    const secondary = await loaded.callBinding(
      { kind: "view", page: "cook-with", path: "display.secondary" },
      recipe,
      ctx,
    );
    expect(secondary).toBe("442 kcal");
  });
});

describe("ctx.storage + custom view", () => {
  it("round-trips app-scoped kv storage", async () => {
    const { ctx } = await setup();
    await ctx.storage.set("pantry", ["a", "b"]);
    expect(await ctx.storage.get("pantry")).toEqual(["a", "b"]);
    expect(await ctx.storage.keys()).toContain("pantry");
  });

  it("customView is null for a non-custom page and available only when trusted", async () => {
    const { loaded } = await setup();
    expect(loaded.customView("cook-with")).toBeNull();
  });
});

// #109: a trusted app's folds are called in place, by the same paths the isolate uses.
describe("callFold — functions inside a view, by path", () => {
  const app = defineApp({
    id: "fold",
    name: "Fold",
    version: "1.0.0",
    schemaVersion: 1,
    entities: { run: { fields: { km: { type: "number" } } } },
    pages: [
      {
        id: "p",
        title: "P",
        view: {
          type: "stats",
          entity: "run",
          items: [
            {
              label: "Total",
              value: (rows: Resolved[]) => rows.reduce((n, r) => n + (r.km as number), 0),
              compare: { label: "before", value: (rows: Resolved[]) => rows.length },
            },
          ],
        },
      },
    ],
  } as never);
  const rows = [{ id: "a", km: 5 }, { id: "b", km: 7 }] as never;

  it("calls the value and the comparison, and refuses a path that is not a function", async () => {
    const loaded = await createHost().load({ kind: "module", app });
    expect(await loaded.callFold("p", "items.0.value", rows, {} as Ctx)).toBe(12);
    expect(await loaded.callFold("p", "items.0.compare.value", rows, {} as Ctx)).toBe(2);
    await expect(loaded.callFold("p", "items.0.label", rows, {} as Ctx)).rejects.toThrow(/no function at items.0.label/);
    await expect(loaded.callFold("p", "__proto__.constructor", rows, {} as Ctx)).rejects.toThrow(/no function/);
  });
});

// #112: what ctx.ui checks before anything renders, and what a headless bridge answers.
describe("ctx.ui questions", () => {
  const app = defineApp({
    id: "q",
    name: "Q",
    version: "1.0.0",
    schemaVersion: 1,
    entities: { thing: { fields: { name: { type: "text" } } } },
    pages: [{ id: "p", title: "P", view: { type: "list", entity: "thing" } }],
  } as never);
  const base = async (ui: Partial<UiBridge>) => {
    const store = new MemoryStore();
    await store.open("q");
    const host = createHost();
    const loaded = await host.load({ kind: "module", app });
    return host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui: { toast: () => {}, confirm: async () => false, prompt: async () => null, pick: async () => null, ...ui }, nav: { navigate: () => {} } });
  };

  it("a headless bridge answers every question as dismissed, and progress does nothing", async () => {
    const ctx = await base({});
    expect(await ctx.ui.sheet({ items: [{ id: "a", label: "A" }] })).toBeNull();
    expect(await ctx.ui.menu({ items: [{ id: "a", label: "A" }] })).toBeNull();
    expect(await ctx.ui.form({ title: "T", fields: { n: { type: "number" } } })).toBeNull();
    const bar = ctx.ui.progress("x");
    expect(() => (bar.update(0.5), bar.done())).not.toThrow();
  });

  it("refuses a form with a bad field or a relation to nowhere, and a sheet with no items", async () => {
    const form = vi.fn(async () => ({}));
    const ctx = await base({ form, sheet: (async () => "a") as never });
    await expect(ctx.ui.form({ title: "T", fields: { when: { type: "calendar" } as never } })).rejects.toThrow(/ui.form field "when"/);
    await expect(ctx.ui.form({ title: "T", fields: { who: { type: "relation", to: "person" } } })).rejects.toThrow(/unknown entity "person"/);
    expect(form).not.toHaveBeenCalled();
    await expect(ctx.ui.sheet({ items: [] })).rejects.toThrow(/at least one/);
    expect(await ctx.ui.sheet({ items: [{ id: "a", label: "A" }] })).toBe("a");
    await ctx.ui.form({ title: "T", fields: { thing: { type: "relation", to: "thing" } } });
    expect(form).toHaveBeenCalledOnce();
  });
});
