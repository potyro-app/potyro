// Does a stored value fit its field? (KA-21, #62)
//
// Two modes. READ checks shape only, because the app's definition can move under old data (a renamed
// enum option, a raised `min`) and that must not make records vanish. WRITE also checks the rules in
// force now, because a value being written today has no such excuse.

import { describe, expect, it } from "vitest";
import { fieldValueProblem, recordValueProblem, sanitiseListRows, type Field } from "../src/index.js";

const fits = (field: Field, value: unknown, mode: "read" | "write" = "write") => fieldValueProblem(field, value, mode) === null;

describe("a value against its field", () => {
  it("never judges an absent value — required is the form's question", () => {
    expect(fits({ type: "number", required: true }, null)).toBe(true);
    expect(fits({ type: "number", required: true }, undefined)).toBe(true);
  });

  it("text-like fields hold strings", () => {
    for (const type of ["text", "richtext", "url"] as const) {
      expect(fits({ type }, "hi")).toBe(true);
      expect(fits({ type }, 12)).toBe(false);
      expect(fits({ type }, { evil: true })).toBe(false);
    }
  });

  it("numbers are finite numbers, and the definition's rules apply to writes only", () => {
    const amount: Field = { type: "number", min: 0, max: 100, integer: true };
    expect(fits(amount, "twelve")).toBe(false);
    expect(fits(amount, "12")).toBe(false);
    expect(fits(amount, Number.NaN)).toBe(false);
    expect(fits(amount, Infinity)).toBe(false);
    expect(fits(amount, 12)).toBe(true);
    expect(fieldValueProblem(amount, 150, "write", "Amount")).toBe("Amount must be at most 100.");
    expect(fieldValueProblem(amount, 1.5, "write", "Amount")).toBe("Amount must be a whole number.");
    // An old record written before `max` was lowered is still readable.
    expect(fits(amount, 150, "read")).toBe(true);
  });

  it("enums: a string on read, one of the options on write", () => {
    const status: Field = { type: "enum", options: ["open", "done"] };
    expect(fits(status, "done")).toBe(true);
    expect(fits(status, "hacked")).toBe(false);
    expect(fits(status, "renamed-since", "read")).toBe(true);
    expect(fits(status, 3, "read")).toBe(false);
  });

  it("booleans, tags, dates, durations", () => {
    expect(fits({ type: "boolean" }, "true")).toBe(false);
    expect(fits({ type: "boolean" }, false)).toBe(true);
    expect(fits({ type: "tags" }, ["a", "b"])).toBe(true);
    expect(fits({ type: "tags" }, ["a", 2])).toBe(false);
    expect(fits({ type: "tags" }, "a")).toBe(false);
    expect(fits({ type: "datetime" }, "2026-09-15T10:00:00.000Z")).toBe(true);
    expect(fits({ type: "datetime" }, new Date("2026-09-15"))).toBe(true);
    expect(fits({ type: "datetime" }, "not a date")).toBe(false);
    expect(fits({ type: "datetime" }, new Date("nope"))).toBe(false);
    expect(fits({ type: "duration" }, 90)).toBe(true);
    expect(fits({ type: "duration" }, "90")).toBe(false);
  });

  it("places, media, relations and people have their shapes", () => {
    expect(fits({ type: "geo" }, { lat: 52.5, lng: 13.4, label: "Berlin" })).toBe(true);
    expect(fits({ type: "geo" }, { lat: 952, lng: 13.4 })).toBe(false);
    expect(fits({ type: "geo" }, "52.5,13.4")).toBe(false);
    expect(fits({ type: "media" }, { key: "k", mime: "image/png" })).toBe(true);
    expect(fits({ type: "media", multiple: true }, [{ key: "k", mime: "image/png" }])).toBe(true);
    expect(fits({ type: "media" }, "https://evil.example/x.png")).toBe(false);
    // A file field holds a FileRef: an id, with path/name/mime as they were when it was set (#252).
    expect(fits({ type: "file" }, { id: "01J", path: "notes/a.md", name: "a.md", mime: "text/markdown" })).toBe(true);
    expect(fits({ type: "file" }, { id: "01J" })).toBe(true);
    expect(fits({ type: "file" }, "notes/a.md")).toBe(false);
    expect(fits({ type: "file" }, { id: "" })).toBe(false);
    expect(fits({ type: "file" }, { id: "01J", path: 7 })).toBe(false);
    expect(fits({ type: "relation", to: "shop" }, "01J…")).toBe(true);
    expect(fits({ type: "relation", to: "shop" }, { id: "01J", name: "Aldi" })).toBe(true);
    expect(fits({ type: "relation", to: "shop", many: true }, "01J")).toBe(false);
    expect(fits({ type: "relation", to: "shop", many: true }, ["01J", "01K"])).toBe(true);
    expect(fits({ type: "member" }, "co_zAna")).toBe(true);
    expect(fits({ type: "member" }, 42)).toBe(false);
    expect(fits({ type: "member", many: true }, ["co_zAna", { id: "co_zBo", name: "Bo" }])).toBe(true);
  });

  it("a list is judged whole on write, and one bad cell is dropped on read", () => {
    const sets: Field = { type: "list", of: { reps: { type: "number" }, note: { type: "text" } } };
    expect(fits(sets, [{ reps: 5 }, { reps: "five" }])).toBe(false);
    expect(fits(sets, [{ reps: 5 }, { reps: "five" }], "read")).toBe(true);
    expect(fits(sets, "5x5", "read")).toBe(false);
    expect(sanitiseListRows((sets as { of: Record<string, Field> }).of, [{ reps: 5, note: "ok" }, { reps: "five", note: "bad" }])).toEqual([
      { reps: 5, note: "ok" },
      { note: "bad" },
    ]);
  });
});

describe("a record's values", () => {
  const fields: Record<string, Field> = { description: { type: "text" }, amount: { type: "number", label: "Amount" } };

  it("names the first value that does not fit, by its label", () => {
    expect(recordValueProblem(fields, { description: "Taxi", amount: "twelve" }, "write")).toBe("Amount must be a number.");
  });

  it("does not judge keys the entity does not declare", () => {
    expect(recordValueProblem(fields, { description: "Taxi", createdBy: "co_zAna", whatever: { x: 1 } }, "write")).toBeNull();
  });
});

describe("editableBy (KA-21)", () => {
  it("accepts anyone, creator or app (a feed's records), and rejects anything else", async () => {
    const { structureSchema } = await import("../src/index.js");
    const app = (editableBy: unknown) => ({
      id: "t", name: "T", version: "1.0.0", schemaVersion: 1,
      entities: { e: { fields: { a: { type: "text" } }, editableBy } },
      pages: [{ id: "p", title: "P", view: { type: "list", entity: "e" } }],
    });
    expect(structureSchema.safeParse(app("creator")).success).toBe(true);
    expect(structureSchema.safeParse(app("anyone")).success).toBe(true);
    expect(structureSchema.safeParse(app("app")).success).toBe(true);
    expect(structureSchema.safeParse(app(undefined)).success).toBe(true);
    expect(structureSchema.safeParse(app("admins")).success).toBe(false);
  });
});
