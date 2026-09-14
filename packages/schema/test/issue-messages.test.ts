import { describe, expect, it } from "vitest";
import { defineApp, ValidationError, type AppDefinition } from "../src/index.js";

// A repair round forwards the validator's words to the model, which must SEARCH for the line it
// wrote. Zod's wrong-discriminator message names the legal values but not the one received (#76).

describe("structure issue messages", () => {
  it("a view type that does not exist names the value that was written", () => {
    const def = {
      id: "t",
      name: "T",
      version: "1.0.0",
      schemaVersion: 1,
      entities: { item: { fields: { name: { type: "text" } } } },
      pages: [{ id: "p", title: "P", view: { type: "lisst", entity: "item" } }],
    } as unknown as AppDefinition;
    let issues: string[] = [];
    try {
      defineApp(def);
    } catch (e) {
      issues = (e as ValidationError).issues;
    }
    expect(issues.join("\n")).toMatch(/pages\.0\.view\.type: Invalid discriminator value\. Expected 'list' \| .*, got "lisst"/);
  });
});
