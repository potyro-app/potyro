import { describe, expect, it } from "vitest";
import { defineApp, ValidationError, VIEW_FIELDS, type AppDefinition, type ChecklistView, type View } from "../src/index.js";

// The checklist view (#106): rows in, patches out. `done` must be something a tick can flip — a
// boolean, or an enum with a `doneValue` the enum has — and the app is told which, by name.

const app = (view: Partial<ChecklistView>): AppDefinition => ({
  id: "groceries",
  name: "Groceries",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        aisle: { type: "enum", options: ["produce", "dairy"] },
        bought: { type: "boolean", default: false },
        status: { type: "enum", options: ["todo", "done"] },
        qty: { type: "text" },
      },
    },
  },
  pages: [{ id: "list", title: "Shopping", view: { type: "checklist", entity: "item", done: "bought", ...view } as View }],
});

describe("checklist view", () => {
  it("accepts a boolean done with text, detail, group, quick add and a folded done section", () => {
    const def = defineApp(app({ text: "name", detail: "qty", group: "aisle", hideDone: "collapse", quickAdd: true, onOpen: { page: "list" } }));
    expect(def.pages[0]!.view.type).toBe("checklist");
  });

  it("accepts an enum done with a doneValue the enum has, and refuses one it does not", () => {
    expect(() => defineApp(app({ done: "status", doneValue: "done" }))).not.toThrow();
    expect(() => defineApp(app({ done: "status", doneValue: "finished" }))).toThrow(/doneValue "finished" is not an option of "status" \(todo, done\)/);
    expect(() => defineApp(app({ done: "status" }))).toThrow(/is an enum, so `doneValue` must say which option means done/);
  });

  it("refuses a done that is not a boolean or enum, or that does not exist, by name", () => {
    expect(() => defineApp(app({ done: "qty" }))).toThrow(/done "qty" must be a boolean or enum field, not text/);
    expect(() => defineApp(app({ done: "purchased" }))).toThrow(/done names unknown field "purchased"/);
    expect(() => defineApp(app({ doneValue: "yes" }))).toThrow(/doneValue is for an enum `done`; "bought" is a boolean/);
  });

  it("refuses a text or group binding naming a field the entity does not have", () => {
    expect(() => defineApp(app({ group: "shop" }))).toThrow(ValidationError);
    expect(() => defineApp(app({ group: "shop" }))).toThrow(/group references unknown field\/computed "shop"/);
  });

  it("is part of the declarable surface the Edit-mode agent is told about", () => {
    expect(VIEW_FIELDS.checklist).toContain("done");
    expect(VIEW_FIELDS.checklist).toContain("quickAdd?");
    expect(VIEW_FIELDS.checklist).toContain("hideDone?");
  });
});
