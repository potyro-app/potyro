// recipes.app.ts
// Stresses: relations (recipe->ingredient), nested list rows, computed macros as real
// functions, a JS "ingredients I have" filter, and a CUSTOM cook-along view (full React).
import { defineApp } from "karta";
import { CookAlong } from "./views/CookAlong";        // your own component — full code
import { scoreDifficulty } from "./lib/difficulty";    // your own helper — full code

export default defineApp({
  id: "recipes",
  name: "Recipes",
  version: "1.0.0",
  schemaVersion: 1,
  theme: { accent: "#E4A93C" },
  permissions: { camera: true, filesystem: true },

  entities: {
    ingredient: {
      label: "Ingredient",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        // ingredients are a real data model — not just a picker option
        diet: { type: "enum", options: ["vegan", "vegetarian", "animal-based"], label: "Diet" },
        category: { type: "enum", options: ["vegetable", "fruit", "grain", "dairy", "protein", "spice", "fat", "other"] },
        seasons: { type: "tags", options: ["spring", "summer", "autumn", "winter"] },
        pricePerKg: { type: "number", unit: "$/kg", min: 0, label: "Price per kg" },
        caloriesPer100: { type: "number", unit: "kcal", min: 0 },
        proteinPer100: { type: "number", unit: "g", min: 0 },
        fatPer100: { type: "number", unit: "g", min: 0 },
        carbsPer100: { type: "number", unit: "g", min: 0 },
        inStock: { type: "boolean", default: false, label: "In stock" },
        notes: { type: "text", multiline: true },
      },
      computed: {
        // in-season if no seasons listed (year-round) or the current season is included
        inSeason: (i, ctx) => {
          const seasons = (i.seasons as string[]) ?? [];
          if (seasons.length === 0) return true;
          const m = ctx.now().getMonth();
          const now = m >= 2 && m <= 4 ? "spring" : m >= 5 && m <= 7 ? "summer" : m >= 8 && m <= 10 ? "autumn" : "winter";
          return seasons.includes(now);
        },
      },
      actions: {
        toggleStock: async (i, ctx) => {
          await ctx.patch("ingredient", i.id, { inStock: !i.inStock });
          ctx.ui.toast(i.inStock ? `Used up ${i.name}` : `${i.name} in stock`);
        },
      },
    },

    recipe: {
      label: "Recipe",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        photo: { type: "media", accept: "image" },
        tags: { type: "tags", options: ["breakfast", "lunch", "dinner", "snack", "vegetarian", "vegan"] },
        servings: { type: "number", default: 2, min: 1, integer: true },
        ingredients: {
          type: "list",
          of: {
            ingredient: { type: "relation", to: "ingredient", required: true },
            quantity: { type: "number", min: 0, required: true },
            unit: { type: "enum", options: ["g", "ml", "tbsp", "tsp", "cup", "piece"] },
          },
        },
        steps: {
          type: "list",
          ordered: true,
          of: {
            text: { type: "text", multiline: true, required: true },
            durationSec: { type: "number", min: 0 },
          },
        },
        lastCookedAt: { type: "datetime", hidden: true },
        timesCooked: { type: "number", default: 0, integer: true, hidden: true },
      },

      // ---- logic: ordinary functions; relations on `r` are pre-resolved ----
      computed: {
        calories: (r) =>
          r.ingredients.reduce((s, i) => s + (i.ingredient.caloriesPer100 ?? 0) * i.quantity / 100, 0),
        protein: (r) =>
          r.ingredients.reduce((s, i) => s + (i.ingredient.proteinPer100 ?? 0) * i.quantity / 100, 0),
        fat: (r) =>
          r.ingredients.reduce((s, i) => s + (i.ingredient.fatPer100 ?? 0) * i.quantity / 100, 0),
        carbs: (r) =>
          r.ingredients.reduce((s, i) => s + (i.ingredient.carbsPer100 ?? 0) * i.quantity / 100, 0),
        caloriesPerServing: (r) => r.calories / Math.max(r.servings, 1),
        proteinPerServing: (r) => r.protein / Math.max(r.servings, 1),
        difficulty: (r) => scoreDifficulty(r), // "easy" | "medium" | "hard"
        // derived from the ingredient models — the whole point of relations being resolved
        diet: (r) => {
          const diets = r.ingredients.map((i: any) => i.ingredient.diet).filter(Boolean);
          if (diets.length === 0) return "unknown";
          if (diets.every((d: string) => d === "vegan")) return "vegan";
          if (diets.every((d: string) => d === "vegan" || d === "vegetarian")) return "vegetarian";
          return "animal-based";
        },
        estimatedCost: (r) =>
          r.ingredients.reduce((s: number, i: any) => s + (i.ingredient.pricePerKg ?? 0) * (i.quantity / 1000), 0),
        // which ingredients this recipe needs that aren't currently in stock
        missingIngredients: (r) =>
          r.ingredients.filter((i: any) => !i.ingredient.inStock).map((i: any) => i.ingredient.name),
        canCook: (r) => r.ingredients.length > 0 && r.ingredients.every((i: any) => i.ingredient.inStock),
      },

      actions: {
        markCooked: async (r, ctx) => {
          await ctx.patch("recipe", r.id, {
            lastCookedAt: ctx.now(),
            timesCooked: (r.timesCooked ?? 0) + 1,
          });
          ctx.ui.toast(`Nice — cooked ${r.timesCooked ? r.timesCooked + 1 : 1}×`);
        },
      },
    },
  },

  pages: [
    {
      id: "all",
      title: "Recipes",
      view: {
        type: "list",
        entity: "recipe",
        sort: (a, b) => a.name.localeCompare(b.name),
        display: {
          primary: (r) => r.name,
          secondary: (r) => `${Math.round(r.caloriesPerServing)} kcal · ${r.difficulty}`,
          media: "photo",
          badges: ["tags"],
        },
        rowActions: ["markCooked"],
        onOpen: { page: "detail", param: { recipeId: "id" } },
      },
    },
    {
      id: "cook-with",
      title: "What can I cook?",
      view: {
        type: "list",
        entity: "recipe",
        // arbitrary JS predicate; ctx.params.pantry is set by a picker in the view chrome
        filter: (r, ctx) => {
          const have = new Set((ctx.params.pantry as string[]) ?? []);
          return r.ingredients.length > 0 && r.ingredients.every((i) => have.has(i.ingredient.id));
        },
        display: { primary: "name", secondary: (r) => `${r.ingredients.length} ingredients`, media: "photo" },
        onOpen: { page: "detail", param: { recipeId: "id" } },
      },
    },
    {
      id: "high-protein",
      title: "High protein",
      view: {
        type: "table",
        entity: "recipe",
        filter: (r) => r.proteinPerServing >= 20,
        sort: (a, b) => b.protein - a.protein,
        display: { columns: ["name", "proteinPerServing", "caloriesPerServing", "servings"] },
      },
    },
    {
      id: "plant-based",
      title: "Plant-based",
      view: {
        type: "list",
        entity: "recipe",
        // uses the recipe-level `diet` computed, which is derived from the ingredient models
        filter: (r) => r.diet === "vegan" || r.diet === "vegetarian",
        sort: (a, b) => a.name.localeCompare(b.name),
        display: {
          primary: "name",
          secondary: (r) => `${r.diet} · ${Math.round(r.caloriesPerServing)} kcal/serving`,
          media: "photo",
          badges: ["diet"],
        },
        onOpen: { page: "detail", param: { recipeId: "id" } },
      },
    },
    {
      id: "ready",
      title: "Ready to cook",
      view: {
        type: "list",
        entity: "recipe",
        // canCook is true when every ingredient is marked in stock
        filter: (r) => r.canCook,
        sort: (a, b) => a.name.localeCompare(b.name),
        display: {
          primary: "name",
          secondary: (r) => `$${r.estimatedCost.toFixed(2)} · ${r.difficulty}`,
          media: "photo",
        },
        rowActions: ["markCooked"],
        onOpen: { page: "detail", param: { recipeId: "id" } },
        emptyText: "Nothing fully in stock yet — mark ingredients “in stock” on the Ingredients tab.",
      },
    },
    {
      id: "detail",
      title: "Recipe",
      hidden: true,
      view: {
        type: "detail",
        entity: "recipe",
        param: "recipeId",
        sections: [
          { title: "Overview", fields: ["photo", "tags", "servings"] },
          { title: "Per serving", fields: ["caloriesPerServing", "proteinPerServing"] },
          { title: "Diet & cost", fields: ["diet", "estimatedCost", "missingIngredients"] },
          { title: "Ingredients", fields: ["ingredients"] },
        ],
        actions: ["markCooked", { label: "Cook", navigate: { page: "cook", param: { recipeId: "id" } } }],
      },
    },

    // ---- ingredients are first-class: their own list + detail pages ----
    {
      id: "pantry",
      title: "Ingredients",
      view: {
        type: "list",
        entity: "ingredient",
        sort: (a, b) => a.name.localeCompare(b.name),
        display: {
          primary: (i) => i.name,
          secondary: (i) => `${i.inStock ? "✓ in stock" : "out of stock"} · ${i.category ?? "—"}`,
          badges: ["diet"],
        },
        rowActions: ["toggleStock"],
        onOpen: { page: "ingredient", param: { ingredientId: "id" } },
      },
    },
    {
      id: "in-season",
      title: "In season",
      view: {
        type: "list",
        entity: "ingredient",
        filter: (i) => i.inSeason,
        sort: (a, b) => a.name.localeCompare(b.name),
        display: {
          primary: "name",
          secondary: (i) => `${i.category ?? "—"} · ${((i.seasons as string[]) ?? []).join(", ") || "year-round"}`,
        },
        rowActions: ["toggleStock"],
        onOpen: { page: "ingredient", param: { ingredientId: "id" } },
      },
    },
    {
      id: "ingredient",
      title: "Ingredient",
      hidden: true,
      view: {
        type: "detail",
        entity: "ingredient",
        param: "ingredientId",
        sections: [
          { title: "About", fields: ["diet", "category", "seasons", "pricePerKg"] },
          { title: "Nutrition (per 100g)", fields: ["caloriesPer100", "proteinPer100", "fatPer100", "carbsPer100"] },
          { title: "Notes", fields: ["notes"] },
        ],
      },
    },
    {
      id: "cook",
      title: "Cook",
      hidden: true,
      view: {
        type: "custom",
        entity: "recipe",
        param: "recipeId",
        render: (props) => CookAlong(props), // full React component — the no-ceiling escape hatch
        onFinish: "markCooked",
      },
    },
  ],

  reminders: [],
});
