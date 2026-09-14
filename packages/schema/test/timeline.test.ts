import { describe, expect, it } from "vitest";
import { defineApp, type AppDefinition, type View } from "../src/index.js";

// A timeline (#110) sorts by its `date`, so a named date must be a datetime field; its dots are an
// enum's colours, so `color` must be an enum field.

const journal = (view: Record<string, unknown>): AppDefinition => ({
  id: "journal",
  name: "Journal",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    entry: {
      fields: {
        text: { type: "text", required: true },
        at: { type: "datetime" },
        mood: { type: "enum", options: ["good", "rough"] },
      },
    },
  },
  pages: [{ id: "p", title: "P", view: { type: "timeline", entity: "entry", ...view } as unknown as View }],
});

describe("timeline", () => {
  it("accepts a datetime field or a date function, an enum colour, grouping and order", () => {
    expect(() => defineApp(journal({ date: "at", color: "mood", groupBy: "week", newest: "last", display: { primary: "text" } }))).not.toThrow();
    expect(() => defineApp(journal({ date: (e: { at: Date }) => e.at, groupBy: "month" }))).not.toThrow();
  });

  it("refuses a text date, an unknown date, a colour that is not an enum, and an unknown grouping", () => {
    expect(() => defineApp(journal({ date: "text" }))).toThrow(/date "text" must be a datetime field, not text/);
    expect(() => defineApp(journal({ date: "when" }))).toThrow(/date names unknown field "when"/);
    expect(() => defineApp(journal({ date: "at", color: "text" }))).toThrow(/color "text" must be an enum field/);
    expect(() => defineApp(journal({ date: "at", groupBy: "year" }))).toThrow(/groupBy/);
  });
});
