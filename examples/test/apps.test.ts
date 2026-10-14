import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, wordGaps, wordSlots } from "potyro";
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

describe("every example speaks the six languages (#303)", () => {
  for (const [name, app] of Object.entries(apps)) {
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
      for (const p of plain) expect(p, p).toMatch(/^(\S{1,5}|\$\/kg|Wiki|Shakshuka|2 × 1 l)$/);
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

  it("has an async computed that reads history", () => {
    expect(workout.entities.exercise.computed).toHaveProperty("lastBest");
    expect(typeof workout.entities.exercise.computed?.lastBest).toBe("function");
  });
});
