import { describe, expect, it } from "vitest";
import { structureSchema } from "../src/index.js";

// A `list` field's `of` is a FLAT map of sub-fields. A common LLM mistake is to wrap them in a fake
// `{ type: "object", fields: {...} }` — which makes the generated form render literal "type"/"fields"
// inputs instead of the sub-fields (incl. a relation picker). The validator must reject the wrap so
// the Studio's validate+repair catches it; the flat form must pass.

const base = {
  id: "gym",
  name: "Gym",
  version: "1.0.0",
  schemaVersion: 1,
  pages: [{ id: "all", title: "Sessions", view: { type: "list", entity: "session", display: { primary: "name" } } }],
};

const withSets = (of: unknown) => ({
  ...base,
  entities: {
    exercise: { label: "Exercise", displayField: "name", fields: { name: { type: "text", required: true } } },
    session: {
      label: "Session",
      displayField: "name",
      fields: { name: { type: "text", required: true }, sets: { type: "list", of } },
    },
  },
});

describe("list field `of` shape", () => {
  it("REJECTS the wrapped { type: 'object', fields: {...} } form", () => {
    const wrapped = withSets({ type: "object", fields: { exercise: { type: "relation", to: "exercise" }, reps: { type: "number" } } });
    expect(structureSchema.safeParse(wrapped).success).toBe(false);
  });

  it("ACCEPTS a flat sub-field map (with a relation to another object)", () => {
    const flat = withSets({ exercise: { type: "relation", to: "exercise" }, reps: { type: "number" } });
    expect(structureSchema.safeParse(flat).success).toBe(true);
  });
});
