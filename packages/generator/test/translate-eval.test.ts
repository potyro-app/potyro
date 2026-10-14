// The `eval:translate` scorer, checked for free (#302, docs/20 §5.3): for every case, the hand-
// written good answer passes and the bad one fails, for the reason the case is about.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppDefinition } from "potyro";
import { loadApp } from "../src/score.js";
import { sameEverywhere, scoreTranslate } from "../src/translate-eval.js";
import { translateCases } from "../src/translate-cases.js";

const examples = resolve(process.cwd(), "../../examples");
const read = (file: string): string => readFileSync(resolve(examples, file), "utf8");
const load = async (source: string): Promise<AppDefinition> => (await loadApp(source, examples)) as unknown as AppDefinition;

describe("eval:translate scorer", async () => {
  const cases = await translateCases(read);

  it("has a case for every scenario of the design", () => {
    expect(new Set(cases.map((c) => c.case.kind))).toEqual(new Set(["translate", "rename", "add-field", "one-lang", "polish-ask"]));
    expect(cases.filter((c) => c.case.kind === "translate")).toHaveLength(6);
  });

  for (const c of cases) {
    it(`${c.case.id}: the good answer passes, the bad one fails`, async () => {
      const good = await scoreTranslate(c.case, c.case.app, await c.good(), load);
      expect(good.checks.filter((x) => !x.ok), c.case.id).toEqual([]);
      const bad = await scoreTranslate(c.case, c.case.app, await c.bad(), load);
      expect(bad.passed, c.case.id).toBe(false);
    }, 30_000);
  }

  it("adding a field may bump schemaVersion with its migration (docs/06), and still passes", async () => {
    const c = cases.find((x) => x.case.id === "add-due-date")!;
    const bumped = (await c.good())
      .replace('version: "2.1.0",', 'version: "2.2.0",')
      .replace("schemaVersion: 2,", "schemaVersion: 3,")
      .replace("  migrations: [", '  migrations: [\n    { from: "2.1.0", to: "2.2.0", steps: [{ op: "addField", entity: "item", field: "due" }] },');
    const score = await scoreTranslate(c.case, c.case.app, bumped, load);
    expect(score.checks.filter((x) => !x.ok)).toEqual([]);
  }, 30_000);

  it("units and cognates are not held against a translation; an untranslated phrase is", () => {
    expect(sameEverywhere("entities.ingredient.fields.caloriesPer100.unit", "kcal")).toBe(true);
    expect(sameEverywhere("entities.ingredient.fields.pricePerKg.unit", "$/kg")).toBe(true);
    expect(sameEverywhere("entities.recipe.fields.ingredients.of.unit.labels.ml", "ml")).toBe(true);
    expect(sameEverywhere("entities.item.label", "Item")).toBe(false);
    expect(sameEverywhere("entities.item.fields.note.unit", "per person")).toBe(false);
  });

  it("an answer that bumps schemaVersion for a translation fails", async () => {
    const c = cases.find((x) => x.case.id === "translate-groceries-de")!;
    const bumped = (await c.good()).replace("schemaVersion: 2,", "schemaVersion: 3,");
    const score = await scoreTranslate(c.case, c.case.app, bumped, load);
    expect(score.checks.find((x) => x.name === "schemaVersion did not move")?.ok).toBe(false);
  }, 30_000);
});
