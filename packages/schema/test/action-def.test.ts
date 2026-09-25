import { describe, expect, it } from "vitest";
import { actionInfo, defineApp, ValidationError, type AppDefinition } from "../src/index.js";

// An action may say what it needs (#213): `{ run, label, description, input }`. The fields are the
// app's own field types, so a person gets a form for them, and a model can fill them for Ask. A bare
// function stays valid and means "takes nothing".

const plants = (actions: Record<string, unknown>): AppDefinition =>
  ({
    id: "plants",
    name: "Plants",
    version: "1.0.0",
    schemaVersion: 1,
    entities: { plant: { displayField: "name", fields: { name: { type: "text" }, water: { type: "number" } }, actions } },
    pages: [{ id: "all", title: "Plants", view: { type: "list", entity: "plant", rowActions: Object.keys(actions) } }],
  }) as AppDefinition;

describe("actions that declare what they take", () => {
  it("accepts a bare function and a declared action side by side", () => {
    const app = defineApp(
      plants({
        water: () => undefined,
        feed: { run: () => undefined, label: "Feed", description: "Log a feeding", input: { grams: { type: "number", min: 0, required: true } } },
      }),
    );
    expect(actionInfo(app.entities.plant!, "water")!.label).toBe("Water");
    expect(actionInfo(app.entities.plant!, "water")!.input).toBeUndefined();
    expect(actionInfo(app.entities.plant!, "feed")).toMatchObject({ label: "Feed", description: "Log a feeding", input: { grams: { type: "number" } } });
    expect(typeof actionInfo(app.entities.plant!, "feed")!.run).toBe("function");
    expect(actionInfo(app.entities.plant!, "nope")).toBeUndefined();
  });

  it("refuses a declared action without run, or with an input that is not a field", () => {
    expect(() => defineApp(plants({ feed: { label: "Feed" } }))).toThrow(ValidationError);
    expect(() => defineApp(plants({ feed: { run: () => undefined, input: { grams: { type: "kilos" } } } }))).toThrow(ValidationError);
    expect(() => defineApp(plants({ feed: { run: () => undefined, colour: "red" } }))).toThrow(ValidationError);
  });
});
