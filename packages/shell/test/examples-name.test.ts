// An example's name is read from its definition, never from a `name:` in the app's own code above it.
import { describe, expect, it } from "vitest";
import { declaredName } from "../src/examples.js";

describe("an example's declared name", () => {
  it("is the definition's, not a form field's above it", () => {
    const source = `
const FORM = {
  name: { type: "text", label: { en: "Name", pl: "Nazwa" } },
};
const SCHEMA = {
  name: "text",
};
export default defineApp({
  id: "recipes",
  name: { en: "Recipes", pl: "Przepisy" },
  language: "pl",
  version: "2.0.0",
});`;
    expect(declaredName(source, "recipes")).toBe("Przepisy");
  });

  it("reads a plain name too", () => {
    expect(declaredName(`export default defineApp({\n  id: "x",\n  name: "Groceries",\n});`, "x")).toBe("Groceries");
  });
});
