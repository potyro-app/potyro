import { describe, expect, it } from "vitest";
import { defineApp, ValidationError, type AppDefinition } from "../src/index.js";

// `suggest` on a text field (#82): a list that grows with the person's data. Additive and optional;
// a wrong shape is refused in words a repair round can act on.

const withRegion = (region: unknown): AppDefinition =>
  ({
    id: "cellar",
    name: "Cellar",
    version: "1.0.0",
    schemaVersion: 1,
    entities: { wine: { fields: { name: { type: "text" }, region } } },
    pages: [{ id: "p", title: "P", view: { type: "list", entity: "wine" } }],
  }) as unknown as AppDefinition;

function issuesOf(def: AppDefinition): string[] {
  try {
    defineApp(def);
    return [];
  } catch (e) {
    return (e as ValidationError).issues;
  }
}

describe("text field `suggest`", () => {
  it("accepts true, a list of starting values, and its absence", () => {
    expect(issuesOf(withRegion({ type: "text" }))).toEqual([]);
    expect(issuesOf(withRegion({ type: "text", suggest: true }))).toEqual([]);
    expect(issuesOf(withRegion({ type: "text", suggest: ["Piemonte", "Douro"] }))).toEqual([]);
  });

  it("keeps the member on the definition", () => {
    const app = defineApp(withRegion({ type: "text", suggest: ["Piemonte"] }));
    expect((app.entities.wine!.fields.region as { suggest?: unknown }).suggest).toEqual(["Piemonte"]);
  });

  it.each([["a string", "region"], ["false", false], ["a list of non-strings", [1, 2]], ["a blank entry", ["Red", " "]], ["an object", { from: "region" }]])(
    "refuses %s, saying what to write instead",
    (_what, suggest) => {
      const issues = issuesOf(withRegion({ type: "text", suggest })).join("\n");
      expect(issues).toMatch(/entities\.wine\.fields\.region\.suggest: `suggest` is `true` .* or a list of starting values, e\.g\. suggest: \["Red", "White"\]/);
      expect(issues).toContain("use an `enum` when only the listed values are allowed");
    },
  );
});
