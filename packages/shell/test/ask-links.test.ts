// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { AppDefinition, KartaRecord } from "karta";
import { applyProposal, prepareReview } from "../src/ask-apply.js";

// Links in Ask's proposals (#213), measured against real runs (scripts/run-ask-eval.ts):
// - a recipe's ingredients and a workout's exercises are links INSIDE list rows;
// - a model links an item to the aisle "Dairy" by name, and the person may have no such aisle;
// - a model proposes the aisle "Dairy" as a new row, and the person already has one.
// In every case the saved records must point at the right thing, found or made on this device.

const DEF = {
  id: "food",
  name: "Food",
  entities: {
    aisle: { displayField: "name", fields: { name: { type: "text", required: true } } },
    item: { displayField: "name", fields: { name: { type: "text", required: true }, aisle: { type: "relation", to: "aisle" } } },
    ingredient: { displayField: "name", fields: { name: { type: "text", required: true }, kcal: { type: "number", required: true } } },
    recipe: {
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        ingredients: { type: "list", of: { ingredient: { type: "relation", to: "ingredient", required: true }, grams: { type: "number" } } },
      },
    },
  },
  pages: [],
} as unknown as AppDefinition;

const EXISTING = { aisle: [{ id: "a1", name: "Dairy" }], ingredient: [{ id: "i1", name: "Egg", kcal: 155 }], item: [], recipe: [] };

function fakeRuntime() {
  const created: Array<{ entity: string; data: Record<string, unknown>; id: string }> = [];
  let n = 0;
  return {
    created,
    create: async (entity: string, data: Partial<KartaRecord>) => {
      const id = `new${++n}`;
      created.push({ entity, data: data as Record<string, unknown>, id });
      return { ...data, id } as KartaRecord;
    },
    patch: async () => undefined,
  };
}

describe("links by name that find nothing", () => {
  it("offer to create the record, when a name is all it needs", () => {
    const review = prepareReview(DEF, { summary: "", rows: [{ entity: "item", ref: "m", values: { name: "Milk", aisle: { match: "dairy" } } }, { entity: "item", ref: "b", values: { name: "Basil", aisle: { match: "Produce" } } }, { entity: "item", ref: "t", values: { name: "Thyme", aisle: { match: "produce" } } }], actions: [] }, EXISTING);
    expect(review.rows.find((r) => r.ref === "m")!.values.aisle).toBe("a1");
    const made = review.rows.filter((r) => r.entity === "aisle");
    expect(made.map((r) => r.values.name)).toEqual(["Produce"]);
    expect(made[0]!.duplicate).toBe(false);
    expect(review.rows.find((r) => r.ref === "b")!.values.aisle).toBe(`@${made[0]!.ref}`);
    expect(review.rows.find((r) => r.ref === "t")!.values.aisle).toBe(`@${made[0]!.ref}`);
  });

  it("leave the link empty, with a note, when the record needs more than a name", () => {
    const review = prepareReview(DEF, { summary: "", rows: [{ entity: "recipe", ref: "r", values: { name: "Carbonara", ingredients: [{ ingredient: { match: "Guanciale" }, grams: 150 }] } }], actions: [] }, EXISTING);
    expect(review.rows.filter((r) => r.entity === "ingredient")).toEqual([]);
    expect((review.rows[0]!.values.ingredients as Array<Record<string, unknown>>)[0]!.ingredient).toBeUndefined();
    expect(review.rows[0]!.notes.join()).toMatch(/Guanciale/);
  });
});

describe("a proposed row the person already has", () => {
  it("is unticked, and links to it go to the person's own record", () => {
    const review = prepareReview(
      DEF,
      { summary: "", rows: [{ entity: "aisle", ref: "dairy", values: { name: "Dairy" } }, { entity: "item", ref: "m", values: { name: "Milk", aisle: "@dairy" } }], actions: [] },
      EXISTING,
    );
    expect(review.rows.find((r) => r.ref === "dairy")!.duplicate).toBe(true);
    expect(review.rows.find((r) => r.ref === "m")!.values.aisle).toBe("a1");
  });
});

describe("links inside list rows", () => {
  it("resolve by name on the device and to new rows' ids when saved", async () => {
    const review = prepareReview(
      DEF,
      {
        summary: "",
        rows: [
          { entity: "recipe", ref: "r", values: { name: "Carbonara", ingredients: [{ ingredient: "@g", grams: 150 }, { ingredient: { match: "egg" }, grams: 100 }] } },
          { entity: "ingredient", ref: "g", values: { name: "Guanciale", kcal: 655 } },
        ],
        actions: [],
      },
      EXISTING,
    );
    const rt = fakeRuntime();
    await applyProposal(rt, DEF, review.rows);
    const guanciale = rt.created.find((c) => c.entity === "ingredient")!;
    const recipe = rt.created.find((c) => c.entity === "recipe")!;
    expect(recipe.data.ingredients).toEqual([
      { ingredient: guanciale.id, grams: 150 },
      { ingredient: "i1", grams: 100 },
    ]);
  });

  it("drop a list row's link to a row the person unticked", async () => {
    const rt = fakeRuntime();
    await applyProposal(rt, DEF, [{ entity: "recipe", ref: "r", values: { name: "X", ingredients: [{ ingredient: "@gone", grams: 1 }] } }]);
    expect(rt.created[0]!.data.ingredients).toEqual([{ grams: 1 }]);
  });
});

describe("places far from the area on the map", () => {
  it("say how far", () => {
    const PL = { id: "p", name: "P", entities: { place: { displayField: "name", fields: { name: { type: "text" }, at: { type: "geo" } } } }, pages: [] } as unknown as AppDefinition;
    const review = prepareReview(
      PL,
      { summary: "", rows: [{ entity: "place", ref: "near", values: { name: "Near", at: { lat: 44.39, lng: 7.55 } } }, { entity: "place", ref: "far", values: { name: "Alba", at: { lat: 44.7, lng: 8.03 } } }], actions: [] },
      { place: [] },
      { area: { lat: 44.3845, lng: 7.5427, radiusKm: 3 } },
    );
    expect(review.rows[0]!.notes).toEqual([]);
    expect(review.rows[1]!.notes.join()).toMatch(/5\d km from the area on your map/);
  });
});
