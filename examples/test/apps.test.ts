import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, computedInfo, computedRun, isPotyroApp, wordGaps, wordSlots, type AppDefinition } from "potyro";
import recipes from "../recipes.app.js";
import plants from "../plants.app.js";
import places from "../places.app.js";
import workout from "../workout.app.js";
import groceries from "../groceries.app.js";
import split from "../split.app.js";

// Importing each module already runs defineApp() → declarative validation. If any example
// were invalid, these imports would throw and the suite would fail. We re-assert here.
const apps = { recipes, plants, places, workout, groceries, split };

/** The six languages the shell ships (#297); every example carries all of them (#303). */
const SIX = ["en", "pt-BR", "de", "es", "pl", "it"];

describe("example apps are valid Potyro apps (living fixtures)", () => {
  for (const [name, app] of Object.entries(apps)) {
    it(`${name} is branded, validated, and referentially sound`, () => {
      expect(isPotyroApp(app)).toBe(true);
      expect(app.id).toBe(name);
      expect(checkReferences(app)).toEqual([]);
      expect(Array.isArray(app.pages)).toBe(true);
      expect(app.pages.length).toBeGreaterThan(0);
    });
  }
});

/** Every computed a page heads with its name (#310): in a group, a detail section, a table column. */
function headedComputeds(app: AppDefinition): Array<{ entity: string; key: string }> {
  const out: Array<{ entity: string; key: string }> = [];
  const add = (entity: string, keys: readonly string[] | undefined): void => {
    for (const key of keys ?? []) if (app.entities[entity]?.computed?.[key] !== undefined) out.push({ entity, key });
  };
  for (const [entity, def] of Object.entries(app.entities)) for (const g of def.groups ?? []) add(entity, g.fields);
  const views = app.pages.flatMap((p) => [p.view, ...(p.layout?.items ?? []).map((i) => i.view)]) as unknown as Array<Record<string, unknown>>;
  for (const v of views) {
    const entity = String(v.entity ?? "");
    if (v.type === "detail") for (const s of (v.sections as Array<{ fields: string[] }> | undefined) ?? []) add(entity, s.fields);
    if (v.type === "table") add(entity, (v.display as { columns?: string[] } | undefined)?.columns);
  }
  return out;
}

describe("every example speaks the six languages (#303)", () => {
  for (const [name, app] of Object.entries(apps)) {
    it(`${name}'s computed values that a page shows under a heading say what they are called (#310)`, () => {
      const unlabelled = headedComputeds(app).filter(({ entity, key }) => computedInfo(app.entities[entity], key)?.label === undefined);
      expect(unlabelled).toEqual([]);
    });

    it(`${name}'s computed badges say what their values read as (labels)`, () => {
      // A badge shows a value as a word, so a computed one needs the words, as an enum option does.
      const views = app.pages.flatMap((p) => [p.view, ...(p.layout?.items ?? []).map((i) => i.view)]) as unknown as Array<Record<string, unknown>>;
      const bare = views.flatMap((v) =>
        (((v.display as { badges?: string[] } | undefined)?.badges ?? []) as string[])
          .filter((k) => app.entities[String(v.entity)]?.computed?.[k] !== undefined && !computedInfo(app.entities[String(v.entity)], k)?.labels)
          .map((k) => `${String(v.entity)}.${k}`),
      );
      expect(bare).toEqual([]);
    });

    it(`${name} is written in English and carries all six, with no map missing one`, () => {
      expect(app.language).toBe("en");
      expect(app.languages).toEqual(SIX);
      expect(checkWords(app)).toEqual([]);
      expect(wordGaps(app)).toEqual([]);
    });

    it(`${name}'s plain strings are only the ones that read the same everywhere`, () => {
      // Units, a dish's own name, a brand: a word a translator would leave alone. Anything longer
      // than a short token with no space is a word somebody forgot.
      const plain = wordSlots(app)
        .filter((s) => typeof s.value === "string")
        .map((s) => s.value as string);
      for (const p of plain) expect(p, p).toMatch(/^(\S{1,5}|\$\/kg|Wiki|Shakshuka|Monstera deliciosa|2 × 1 l)$/);
    });
  }
});

describe("recipes fixture exercises the M1 surface", () => {
  it("has a custom cook-along view and computed macros", () => {
    const cook = recipes.pages.find((p) => p.id === "cook");
    expect(cook?.view.type).toBe("custom");
    expect(recipes.entities.recipe.computed).toHaveProperty("caloriesPerServing");
  });
});

describe("workout fixture exercises nested lists + async computed", () => {
  it("declares a nested list (session → entries → sets)", () => {
    const entries = workout.entities.session.fields.entries as { type: string; of: Record<string, { type: string }> };
    expect(entries.type).toBe("list");
    expect(entries.of.sets.type).toBe("list"); // a list field inside a list row
  });

  it("names a recipe's diet in words for every value it returns", () => {
    const labels = computedInfo(recipes.entities.recipe, "diet")?.labels;
    expect(Object.keys(labels ?? {}).sort()).toEqual(["animal-based", "unknown", "vegan", "vegetarian"]);
  });

  it("has an async computed that reads history", () => {
    expect(workout.entities.exercise.computed).toHaveProperty("lastBest");
    expect(typeof computedRun(workout.entities.exercise, "lastBest")).toBe("function");
  });
});
