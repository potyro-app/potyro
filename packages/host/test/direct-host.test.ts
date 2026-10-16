import { describe, expect, it, vi } from "vitest";
import { defineApp, type Ctx, type PotyroApp, type Resolved } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";

// A compact recipes-shaped app exercising the M1 surface: relation, computed macros (with a
// cross-computed reference), a JS filter, and an action that patches + toasts.
function recipesApp(): PotyroApp {
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
          cookFor: {
            label: "Cook for",
            input: { people: { type: "number", required: true } },
            run: async (r, ctx, input) => {
              await ctx.patch("recipe", r.id, { servings: (input as { people: number }).people });
            },
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

  it("runs a declared action ({ run, input }) with its input", async () => {
    const { ctx, loaded, store, ids } = await setup();
    const [recipe] = await ctx.query("recipe");
    await loaded.callAction("recipe", "cookFor", recipe, ctx, { people: 6 });
    expect((await store.get("recipe", ids.pancake))!.servings).toBe(6);
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

  it("share hands on checked words and an http(s) link, and is `false` headless", async () => {
    expect(await (await base({})).ui.share({ text: "hi" })).toBe(false);
    const share = vi.fn(async () => true);
    const ctx = await base({ share });
    expect(await ctx.ui.share({ text: { en: "Daily #1 3/6" }, title: "Share", url: "https://potyro.app/a b" })).toBe(true);
    expect(share).toHaveBeenLastCalledWith({ text: "Daily #1 3/6", title: "Share", url: "https://potyro.app/a%20b" });
    await expect(ctx.ui.share({})).rejects.toThrow(/needs \{ text \}, \{ url \} or \{ files \}/);
    await expect(ctx.ui.share({ files: [] })).rejects.toThrow(/needs \{ text \}, \{ url \} or \{ files \}/);
    await expect(ctx.ui.share({ url: "javascript:alert(1)" })).rejects.toThrow(/http\(s\)/);
    await expect(ctx.ui.share({ url: "not a link" })).rejects.toThrow(/whole http\(s\) address/);
    await expect(ctx.ui.share({ text: "x".repeat(10_001) })).rejects.toThrow(/longer than/);
    expect(share).toHaveBeenCalledOnce();
  });

  it("share hands on files: a Blob, a File, a file of the app's folder and a photo, each named, as Files", async () => {
    const share = vi.fn(async (_o: { files?: File[] }) => true);
    const store = new MemoryStore();
    await store.open("q");
    const host = createHost();
    const loaded = await host.load({ kind: "module", app });
    const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui: { toast: () => {}, confirm: async () => false, prompt: async () => null, pick: async () => null, share }, nav: { navigate: () => {} } });
    const kept = await ctx.files.write("snaps/monster 1.png", new Uint8Array([137, 80, 78, 71]), { mime: "image/png" });
    const photo = await ctx.media.put(new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }));
    expect(
      await ctx.ui.share({
        title: "My monster",
        files: [new Blob(["png"], { type: "image/png" }), new File(["a,b"], "../../scores.csv", { type: "text/csv" }), kept, { id: kept.id }, photo],
      }),
    ).toBe(true);
    const sent = share.mock.calls[0]![0].files!;
    expect(sent.every((f) => f instanceof File)).toBe(true);
    // Named for what they are; no folder survives in a name; a second of the same name is numbered.
    expect(sent.map((f) => f.name)).toEqual(["picture-1.png", "scores.csv", "monster 1.png", "monster 1-2.png", "picture-5.jpg"]);
    expect(sent.map((f) => f.type)).toEqual(["image/png", "text/csv", "image/png", "image/png", "image/jpeg"]);
    expect(new Uint8Array(await sent[2]!.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    // Files alone are enough to share.
    expect(share.mock.calls[0]![0]).toEqual({ title: "My monster", files: sent });
  });

  it("share refuses files it cannot hand on: not a list, too many, too big, or not this app's", async () => {
    const share = vi.fn(async () => true);
    const ctx = await base({ share });
    await expect(ctx.ui.share({ files: new Blob(["x"]) as never })).rejects.toThrow(/a list of files/);
    await expect(ctx.ui.share({ files: Array.from({ length: 11 }, () => new Blob(["x"])) })).rejects.toThrow(/at most 10 files/);
    await expect(ctx.ui.share({ files: [new Blob([new Uint8Array(26 * 1024 * 1024)])] })).rejects.toThrow(/larger than 25 MB/);
    await expect(ctx.ui.share({ files: [{ id: "someone-elses-file" }] })).rejects.toThrow(/no file like that in this app/);
    await expect(ctx.ui.share({ files: [{ path: "nope.png" } as never] })).rejects.toThrow(/no file "nope.png"/);
    await expect(ctx.ui.share({ files: [{ key: "not-here", mime: "image/png" }] })).rejects.toThrow(/not on this device/);
    await expect(ctx.ui.share({ files: ["snaps/a.png" as never] })).rejects.toThrow(/a file is a Blob/);
    expect(share).not.toHaveBeenCalled();
  });
});

describe("the live tile (docs/04 §Tile)", () => {
  const app = (tile?: (ctx: Ctx) => unknown) =>
    defineApp({
      id: "plants",
      name: "Plants",
      version: "1.0.0",
      schemaVersion: 1,
      category: "everyday",
      ...(tile ? { tile: tile as never } : {}),
      entities: { plant: { fields: { name: { type: "text" } } } },
      pages: [{ id: "all", title: "All", view: { type: "list", entity: "plant" } }],
    });

  it("calls the app's tile with ctx and returns what it says; null without one", async () => {
    const store = new MemoryStore();
    await store.open("plants");
    await store.insert("plant", { name: "Fern" });
    const host = createHost();
    const ui: UiBridge = { toast: () => {}, confirm: async () => false, prompt: async () => null, pick: async () => null };
    const nav: NavBridge = { navigate: () => {} };
    const loaded = await host.load({ kind: "module", app: app(async (ctx) => ({ count: (await ctx.query("plant")).length })), provenance: "trusted" });
    const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav });
    expect(await loaded.callTile(ctx)).toEqual({ count: 1 });
    const plain = await host.load({ kind: "module", app: app(), provenance: "trusted" });
    expect(await plain.callTile(host.makeCtx(plain, { store, caps: new FakeCapabilities(), ui, nav }))).toBeNull();
  });

  it("validates `category` as one lowercase word", () => {
    expect(() => defineApp({ ...app(), category: "Games!" } as never)).toThrow(/category/);
  });
});
