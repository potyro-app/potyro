import { describe, expect, it } from "vitest";
import { defineApp, type AppDefinition, type View } from "../src/index.js";

// Stats tiles and a chart (#109). A tile follows the summary's one-of rules; a named field must
// exist; a chart without `series` has nothing to draw and is refused rather than rendered empty.

const runs = (view: Record<string, unknown>): AppDefinition => ({
  id: "runs",
  name: "Runs",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { run: { fields: { km: { type: "number", unit: "km" }, note: { type: "text" } } } },
  pages: [{ id: "p", title: "P", view: { entity: "run", ...view } as unknown as View }],
});

describe("stats", () => {
  it("accepts op and value tiles, a unit and a comparison", () => {
    expect(() =>
      defineApp(
        runs({
          type: "stats",
          items: [
            { label: "Runs", op: "count" },
            { label: "Distance", op: "sum", field: "km" },
            { label: "This week", value: () => 3, unit: "runs", compare: { value: () => 2, label: "last week", as: "percent" } },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it("refuses a tile with neither op nor value, a sum without a field, an unknown field, and no items", () => {
    expect(() => defineApp(runs({ type: "stats", items: [{ label: "?" }] }))).toThrow(/exactly one of `op` or `value/);
    expect(() => defineApp(runs({ type: "stats", items: [{ label: "Km", op: "sum" }] }))).toThrow(/needs a `field`/);
    expect(() => defineApp(runs({ type: "stats", items: [{ label: "Km", op: "sum", field: "miles" }] }))).toThrow(/stat "Km" references unknown field\/computed "miles"/);
    expect(() => defineApp(runs({ type: "stats", items: [] }))).toThrow(/at least one item/);
    expect(() => defineApp(runs({ type: "stats", items: [{ label: "x", op: "count", compare: { value: () => 1 } }] }))).toThrow();
  });
});

describe("chart", () => {
  it("accepts a series with a title and subtitle, and refuses a chart without one", () => {
    expect(() => defineApp(runs({ type: "chart", series: () => [], title: "Km per week", subtitle: (): string => "Last 8 weeks" }))).not.toThrow();
    expect(() => defineApp(runs({ type: "chart", title: "Nothing" }))).toThrow(/series/);
    expect(() => defineApp(runs({ type: "chart", series: () => [], kind: "pie" }))).toThrow(/kind/);
  });
});
