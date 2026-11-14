import { describe, expect, it } from "vitest";
import { distinctValues, offersRecordValues, suggestedValues, valueKey, DISTINCT_VALUES_CAP } from "../src/distinct-values.js";

describe("offersRecordValues", () => {
  it("is true for fields that declare no options of their own", () => {
    expect(offersRecordValues({ type: "text" })).toBe(true);
    expect(offersRecordValues({ type: "url" })).toBe(true);
    expect(offersRecordValues({ type: "number" })).toBe(true);
    expect(offersRecordValues({ type: "tags" })).toBe(true);
    expect(offersRecordValues({ type: "tags", options: [] })).toBe(true);
  });

  it("is false for a field with a fixed list, a type whose values are not choices, or no field", () => {
    expect(offersRecordValues({ type: "enum", options: ["a"] })).toBe(false);
    expect(offersRecordValues({ type: "tags", options: ["a"] })).toBe(false);
    expect(offersRecordValues({ type: "geo" })).toBe(false);
    expect(offersRecordValues({ type: "file" })).toBe(false);
    expect(offersRecordValues(undefined)).toBe(false);
  });
});

describe("distinctValues", () => {
  it("returns each value once, sorted, whatever the order of the records", () => {
    const rows = [{ country: "Poland" }, { country: "Italy" }, { country: "Poland" }, { country: "brazil" }];
    expect(distinctValues(rows, "country")).toEqual(["brazil", "Italy", "Poland"]);
  });

  it("leaves out empty, blank, missing and non-scalar values", () => {
    const rows = [{ country: "" }, { country: "   " }, { country: null }, {}, { country: { a: 1 } }, { country: true }, { country: "Italy" }];
    expect(distinctValues(rows, "country")).toEqual(["Italy"]);
  });

  it("keeps the value exactly as the record holds it, so the app's own comparison matches", () => {
    const rows = [{ country: "Italy " }, { country: "Italy" }, { country: "italy" }];
    const values = distinctValues(rows, "country");
    expect(values).toHaveLength(3);
    for (const row of rows) expect(values).toContain(row.country);
  });

  it("offers numbers as numbers, in numeric order", () => {
    const rows = [{ year: 2024 }, { year: 1999 }, { year: 2024 }, { year: Number.NaN }];
    expect(distinctValues(rows, "year")).toEqual([1999, 2024]);
  });

  it("sorts text with digits the way a person reads it", () => {
    const rows = [{ room: "Room 10" }, { room: "Room 2" }];
    expect(distinctValues(rows, "room")).toEqual(["Room 2", "Room 10"]);
  });

  it("offers each entry of a list-valued field", () => {
    const rows = [{ tags: ["quick", "vegan"] }, { tags: ["vegan", "", "vegan"] }, { tags: [] }];
    expect(distinctValues(rows, "tags")).toEqual(["quick", "vegan"]);
  });

  it("leaves out prose: a paragraph is not a category", () => {
    const rows = [{ note: "x".repeat(200) }, { note: "short" }];
    expect(distinctValues(rows, "note")).toEqual(["short"]);
  });

  it("returns nothing when there are no records", () => {
    expect(distinctValues([], "country")).toEqual([]);
  });

  it("keeps the most used values over the cap, still sorted", () => {
    const rows = [
      ...Array.from({ length: 100 }, (_, i) => ({ city: `City ${String(i).padStart(3, "0")}` })),
      { city: "City 099" },
      { city: "City 098" },
    ];
    const values = distinctValues(rows, "city", 3);
    expect(values).toEqual(["City 000", "City 098", "City 099"]);
    expect(distinctValues(rows, "city")).toHaveLength(DISTINCT_VALUES_CAP);
  });
});

describe("suggestedValues (#82)", () => {
  it("offers what the records hold, once each, sorted", () => {
    const rows = [{ region: "Piemonte" }, { region: "Douro" }, { region: "Piemonte" }, { region: "" }, { region: null }, {}];
    expect(suggestedValues(rows, "region")).toEqual(["Douro", "Piemonte"]);
  });

  it("adds the declared starting values no record uses yet", () => {
    const rows = [{ colour: "Orange" }, { colour: "Red" }];
    expect(suggestedValues(rows, "colour", ["Red", "White", "Rosé"])).toEqual(["Orange", "Red", "Rosé", "White"]);
    expect(suggestedValues([], "colour", ["White", "Red", "White", " "])).toEqual(["Red", "White"]);
  });

  it("treats case and surrounding space as the same choice, keeping the most used spelling, the earliest among equals", () => {
    const rows = [{ r: "barolo" }, { r: "Barolo " }, { r: "Barolo" }, { r: "etna" }, { r: "Etna" }];
    expect(suggestedValues(rows, "r")).toEqual(["Barolo", "etna"]);
  });

  it("keeps a record's spelling over a declared one, so a pick writes what a filter already shows", () => {
    expect(suggestedValues([{ c: "red" }], "c", ["Red", "White"])).toEqual(["red", "White"]);
  });

  it("is not capped, and leaves prose and non-text out", () => {
    const rows = Array.from({ length: DISTINCT_VALUES_CAP + 10 }, (_, i) => ({ v: `value ${i}` }));
    expect(suggestedValues(rows, "v")).toHaveLength(DISTINCT_VALUES_CAP + 10);
    expect(suggestedValues([{ v: "x".repeat(81) }, { v: 7 }, { v: ["a"] }], "v")).toEqual([]);
  });
});

describe("a filter on a field with suggest", () => {
  it("shows what is in the data, never the declared starting values", () => {
    const field = { type: "text", suggest: ["Red", "White"] };
    expect(offersRecordValues(field)).toBe(true);
    expect(distinctValues([{ colour: "Red" }], "colour")).toEqual(["Red"]);
  });
});

describe("valueKey", () => {
  it("folds case and surrounding space", () => {
    expect(valueKey("  Rosé ")).toBe(valueKey("rosé"));
    expect(valueKey("Red")).not.toBe(valueKey("Reds"));
  });
});
