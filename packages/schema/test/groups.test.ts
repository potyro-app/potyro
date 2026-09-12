import { describe, expect, it } from "vitest";
import { defineApp, ValidationError, type AppDefinition } from "../src/index.js";

// Entity `groups` arrange the form and the detail page alike; `help`, `placeholder` and `width`
// are per-field presentation hints (#100). All declarative, so all validated — and a group that
// names a field the entity does not have is refused by name, not rendered as a blank.

const recipes = (extra: Partial<AppDefinition["entities"]["recipe"]>, field: Record<string, unknown> = {}): AppDefinition => ({
  id: "recipes",
  name: "Recipes",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    recipe: {
      fields: {
        name: { type: "text", required: true, ...(field as object) },
        servings: { type: "number", integer: true },
        notes: { type: "text", multiline: true },
      },
      computed: { calories: () => 0 },
      ...extra,
    },
  },
  pages: [{ id: "all", title: "Recipes", view: { type: "list", entity: "recipe" } }],
});

describe("groups", () => {
  it("accepts groups over fields and computed, with a title and a fold", () => {
    const app = defineApp(
      recipes({
        groups: [
          { title: "Overview", fields: ["name", "servings"] },
          { title: "Nutrition", fields: ["calories"], collapsed: true },
        ],
      }),
    );
    expect(app.entities.recipe.groups).toHaveLength(2);
  });

  it("refuses a group naming a field the entity does not have, by name", () => {
    expect(() => defineApp(recipes({ groups: [{ title: "Overview", fields: ["name", "photo"] }] }))).toThrow(ValidationError);
    expect(() => defineApp(recipes({ groups: [{ title: "Overview", fields: ["name", "photo"] }] }))).toThrow(
      /entity "recipe" group "Overview" names unknown field\/computed "photo"/,
    );
  });

  it("refuses a field listed in two groups", () => {
    expect(() =>
      defineApp(recipes({ groups: [{ fields: ["name"] }, { title: "Again", fields: ["name"] }] })),
    ).toThrow(/group "Again" lists "name" again — it is already in entity "recipe" group #1/);
  });

  it("refuses an empty group", () => {
    expect(() => defineApp(recipes({ groups: [{ title: "Nothing", fields: [] }] }))).toThrow(ValidationError);
  });
});

describe("field hints", () => {
  it("accepts help, placeholder and a half width", () => {
    const app = defineApp(recipes({}, { help: "As on the menu", placeholder: "Shakshuka", width: "half" }));
    expect(app.entities.recipe.fields.name).toMatchObject({ help: "As on the menu", placeholder: "Shakshuka", width: "half" });
  });

  it("refuses a width that is not full or half", () => {
    expect(() => defineApp(recipes({}, { width: "third" }))).toThrow(ValidationError);
  });
});
