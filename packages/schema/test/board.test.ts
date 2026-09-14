import { describe, expect, it } from "vitest";
import { defineApp, ValidationError, type AppDefinition, type View } from "../src/index.js";

// A board's columns are an enum's options (#107). A board over a field that is not an enum, or
// naming a column the enum does not offer, is refused by name — a drop there would write a value the
// field never allowed.

const tasks = (view: Record<string, unknown>): AppDefinition => ({
  id: "tasks",
  name: "Tasks",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    task: {
      fields: {
        title: { type: "text", required: true },
        status: { type: "enum", options: ["todo", "doing", "done"] },
        note: { type: "text" },
      },
    },
  },
  pages: [{ id: "board", title: "Board", view: { type: "board", entity: "task", ...view } as unknown as View }],
});

describe("board", () => {
  it("accepts an enum column, a subset of its options, display bindings and read-only", () => {
    expect(() => defineApp(tasks({ column: "status" }))).not.toThrow();
    expect(() => defineApp(tasks({ column: "status", columns: ["doing", "todo"], display: { primary: "title", secondary: (t: { note?: string }) => t.note ?? "" }, allowMove: false }))).not.toThrow();
  });

  it("refuses a column that is not an enum, or unknown, by name", () => {
    expect(() => defineApp(tasks({ column: "note" }))).toThrow(/column "note" must be an enum field, not text/);
    expect(() => defineApp(tasks({ column: "stage" }))).toThrow(/column names unknown field "stage"/);
  });

  it("refuses a column the enum does not offer", () => {
    expect(() => defineApp(tasks({ column: "status", columns: ["todo", "blocked"] }))).toThrow(ValidationError);
    expect(() => defineApp(tasks({ column: "status", columns: ["todo", "blocked"] }))).toThrow(/"blocked", which is not an option of "status"/);
  });
});
