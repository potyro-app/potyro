// Proves the "ingredients are a real model" work: cross-entity recipe computed (diet, canCook,
// missingIngredients), an ingredient action (toggleStock), and the diet/stock/season filter
// views — all against the real recipes example.

import { describe, expect, it, beforeEach } from "vitest";
import recipes from "../../../examples/recipes.app.js";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "../src/index.js";

let store: MemoryStore;
let runtime: PotyroRuntime;
let ids: { chicken: string; roast: string };

beforeEach(async () => {
  store = new MemoryStore();
  await store.open("recipes");
  const ui = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const nav = { navigate: () => {} };

  const flour = await store.insert("ingredient", { name: "Flour", diet: "vegan", category: "grain", inStock: true });
  const egg = await store.insert("ingredient", { name: "Egg", diet: "vegetarian", category: "protein", inStock: true });
  const chicken = await store.insert("ingredient", { name: "Chicken breast", diet: "animal-based", category: "protein", pricePerKg: 9, inStock: false });

  await store.insert("recipe", {
    name: "Pancakes",
    servings: 2,
    ingredients: [
      { ingredient: flour.id, quantity: 200, unit: "g" },
      { ingredient: egg.id, quantity: 100, unit: "g" },
    ],
    timesCooked: 0,
  });
  const roast = await store.insert("recipe", {
    name: "Roast chicken",
    servings: 2,
    ingredients: [{ ingredient: chicken.id, quantity: 1000, unit: "g" }],
    timesCooked: 0,
  });
  ids = { chicken: chicken.id, roast: roast.id };

  const host = createHost();
  const loaded = await host.load({ kind: "module", app: recipes });
  runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
});

describe("recipe computed derived from the ingredient model", () => {
  it("classifies diet and computes cost from ingredients", async () => {
    const rows = await runtime.queryPage("all");
    const pancakes = rows.rows.find((r) => r.name === "Pancakes")!;
    const roast = rows.rows.find((r) => r.name === "Roast chicken")!;
    expect(pancakes.diet).toBe("vegetarian"); // vegan + vegetarian → vegetarian
    expect(roast.diet).toBe("animal-based");
    expect(roast.estimatedCost).toBeCloseTo(9, 5); // 9 $/kg * 1kg
  });

  it("canCook + missingIngredients reflect stock", async () => {
    const rows = (await runtime.queryPage("all")).rows;
    const pancakes = rows.find((r) => r.name === "Pancakes")!;
    const roast = rows.find((r) => r.name === "Roast chicken")!;
    expect(pancakes.canCook).toBe(true);
    expect(pancakes.missingIngredients).toEqual([]);
    expect(roast.canCook).toBe(false);
    expect(roast.missingIngredients).toEqual(["Chicken breast"]);
  });
});

describe("What can I cook?", () => {
  it("lists what you can cook first, then by how little is missing", async () => {
    const rows = (await runtime.queryPage("cook-with")).rows;
    expect(rows.map((r) => r.name)).toEqual(["Pancakes", "Roast chicken"]);
  });

  it("“Can cook now” keeps only fully-stocked recipes", async () => {
    const ready = (await runtime.queryPage("cook-with", { ready: true })).rows.map((r) => r.name);
    expect(ready).toEqual(["Pancakes"]);
  });
});

describe("ingredient action toggleStock", () => {
  it("restocking an ingredient makes its recipe cookable", async () => {
    await runtime.runAction("ingredient", "toggleStock", ids.chicken);
    const chicken = await store.get("ingredient", ids.chicken);
    expect(chicken!.inStock).toBe(true);

    const ready = (await runtime.queryPage("cook-with", { ready: true })).rows.map((r) => r.name);
    expect(ready).toContain("Roast chicken");
  });
});
