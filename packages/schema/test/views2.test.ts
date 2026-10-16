import { describe, expect, it } from "vitest";
import { defineApp, ValidationError, type AppInput } from "../src/index.js";

// Views 2: related records on a record page, a checklist's add box, a record's own glyph. Each is
// optional; what is declared is checked against the entities it names.

const base = (pages: AppInput["pages"]): AppInput => ({
  id: "garden",
  name: "Garden",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    plant: { fields: { name: { type: "text" } } },
    care: { fields: { note: { type: "text" }, plant: { type: "relation", to: "plant" }, when: { type: "datetime" }, ml: { type: "number" } } },
    item: { fields: { name: { type: "text" }, aisle: { type: "text" }, bought: { type: "boolean" } } },
  },
  pages,
});

const detail = (related: Record<string, unknown>) =>
  base([{ id: "p", title: "Plant", view: { type: "detail", entity: "plant", param: "id", sections: [{ title: "Care", related: related as never }] } }]);

describe("related sections", () => {
  it("accepts records that point here, as a list, a timeline or a chart", () => {
    for (const view of ["list", "timeline", "chart"] as const) {
      expect(() => defineApp(detail({ entity: "care", via: "plant", view, date: "when", value: "ml", by: "week", limit: 10 }))).not.toThrow();
    }
  });

  it("refuses a relation that does not point at this entity, an unknown entity, and a chart with no date", () => {
    expect(() => defineApp(detail({ entity: "care", via: "note" }))).toThrow(/must be a relation on "care" to "plant"/);
    expect(() => defineApp(detail({ entity: "nope", via: "plant" }))).toThrow(/is not an entity/);
    expect(() => defineApp(detail({ entity: "care", via: "plant", view: "chart" }))).toThrow(ValidationError);
    expect(() => defineApp(detail({ entity: "care", via: "plant", date: "missing", view: "timeline" }))).toThrow(/unknown field\/computed "missing"/);
  });

  it("a section needs fields or related", () => {
    expect(() => defineApp(base([{ id: "p", title: "P", view: { type: "detail", entity: "plant", sections: [{ title: "Empty" } as never] } }]))).toThrow(ValidationError);
  });
});

describe("the checklist's add box and glyphs", () => {
  const list = (extra: Record<string, unknown>) =>
    base([{ id: "l", title: "List", view: { type: "checklist", entity: "item", done: "bought", ...extra } as never }]);

  it("takes a plain switch or a box that suggests, remembers and works out the rest", () => {
    expect(() => defineApp(list({ quickAdd: true }))).not.toThrow();
    const app = defineApp(list({ quickAdd: { suggest: false, remember: ["aisle"], defaults: () => ({}) }, icon: "aisle", layout: "tiles" }));
    const view = app.pages[0]!.view as { quickAdd?: { defaults?: unknown }; layout?: string };
    expect(typeof view.quickAdd?.defaults).toBe("function");
    expect(view.layout).toBe("tiles");
    expect(() => defineApp(list({ quickAdd: { guess: true } }))).toThrow(ValidationError);
    expect(() => defineApp(list({ layout: "grid" }))).toThrow(ValidationError);
  });

  it("a list row may carry its own glyph", () => {
    expect(() => defineApp(base([{ id: "l", title: "L", view: { type: "list", entity: "plant", display: { primary: "name", icon: () => "🌿" } } }]))).not.toThrow();
  });
});
