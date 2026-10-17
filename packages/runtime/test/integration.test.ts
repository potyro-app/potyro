// Integration (docs/09): load the real recipes example via DirectHost and drive it through
// the full stack — resolved relations, memoized computed macros, the "ingredients I have"
// JS filter, and an action — against MemoryStore + FakeCapabilities.

import { describe, expect, it, beforeEach } from "vitest";
import recipes from "../../../examples/recipes.app.js";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "../src/index.js";

let store: MemoryStore;
let runtime: PotyroRuntime;
let toasts: string[];
let ids: { flour: string; egg: string; pancake: string; saladId: string };

beforeEach(async () => {
  store = new MemoryStore();
  await store.open("recipes");
  toasts = [];
  const ui: UiBridge = {
    toast: (m) => void toasts.push(m),
    confirm: async () => true,
    prompt: async () => null,
    pick: async () => null,
  };
  const nav: NavBridge = { navigate: () => {} };

  const flour = await store.insert("ingredient", { name: "Flour", caloriesPer100: 364, proteinPer100: 10 });
  const egg = await store.insert("ingredient", { name: "Egg", caloriesPer100: 155, proteinPer100: 13 });
  const lettuce = await store.insert("ingredient", { name: "Lettuce", caloriesPer100: 15, proteinPer100: 1 });
  const pancake = await store.insert("recipe", {
    name: "Pancake",
    servings: 2,
    ingredients: [
      { ingredient: flour.id, quantity: 200 },
      { ingredient: egg.id, quantity: 100 },
    ],
    timesCooked: 0,
  });
  const salad = await store.insert("recipe", {
    name: "Salad",
    servings: 1,
    ingredients: [{ ingredient: lettuce.id, quantity: 300 }],
    timesCooked: 0,
  });
  ids = { flour: flour.id, egg: egg.id, pancake: pancake.id, saladId: salad.id };

  const host = createHost();
  const loaded = await host.load({ kind: "module", app: recipes });
  runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
});

describe("recipes end-to-end (trusted / DirectHost)", () => {
  it("resolves relations and computed macros on the list page, sorted by name", async () => {
    const { rows } = await runtime.queryPage("all");
    expect(rows.map((r) => r.name)).toEqual(["Pancake", "Salad"]); // sort by name
    const pancake = rows.find((r) => r.name === "Pancake")!;
    expect(pancake.ingredients[0].ingredient.name).toBe("Flour");
    expect(Math.round(pancake.calories)).toBe(883);
    expect(Math.round(pancake.caloriesPerServing)).toBe(442);
    expect(pancake.difficulty).toBe("easy");
  });

  it("the cookbook's chips: a search, and a meal", async () => {
    expect((await runtime.queryPage("all", { q: "pan" })).rows.map((r) => r.name)).toEqual(["Pancake"]);
    expect((await runtime.queryPage("all", { q: "zzz" })).rows).toEqual([]);
  });

  it("markCooked action patches the record and toasts", async () => {
    await runtime.runAction("recipe", "markCooked", ids.pancake);
    const updated = await store.get("recipe", ids.pancake);
    expect(updated!.timesCooked).toBe(1);
    expect(updated!.lastCookedAt).toBeInstanceOf(Date);
    expect(toasts.length).toBe(1);
  });

  it("resolves function display bindings for a page", async () => {
    const { rows, ctx } = await runtime.queryPage("all");
    const pancake = rows.find((r) => r.name === "Pancake")!;
    const primary = await runtime.resolveBinding({ kind: "view", page: "all", path: "display.primary" }, pancake, ctx);
    expect(primary).toBe("Pancake");
    const secondary = await runtime.resolveBinding(
      { kind: "view", page: "all", path: "display.secondary" },
      pancake,
      ctx,
    );
    expect(secondary).toBe("442 kcal · easy");
  });
});
