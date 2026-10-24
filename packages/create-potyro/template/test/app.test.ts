import { describe, expect, it } from "vitest";
// Importing the app checks it: `defineApp` throws when the shape is wrong (a page naming a field
// that does not exist, an id that is not a slug), so this file fails before anything else does.
import app, { lineOf } from "../__NAME__.app";

describe("__TITLE__", () => {
  it("is a valid app", () => {
    expect(app.id).toBe("__NAME__");
    expect(Object.keys(app.entities)).toContain("thing");
  });

  it("shows a thing's note under its name", () => {
    expect(lineOf("  milk, eggs ")).toBe("milk, eggs");
    expect(lineOf(undefined)).toBe("");
  });
});
