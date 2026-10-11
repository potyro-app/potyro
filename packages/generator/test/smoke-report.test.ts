// A smoke run as the model reads it (#262): errors are what broke, empty pages are warnings, and the
// counts say what actually ran so a vacuous pass is visible.

import { describe, expect, it } from "vitest";
import { defineApp } from "potyro";
import { smokeApp, smokeReport } from "../src/smoke.js";
import { describeRun, mergeRuns } from "../src/run-report.js";

const app = (kcal: (r: never, ctx: never) => unknown) =>
  defineApp({
    id: "meals",
    name: "Meals",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      meal: {
        label: "Meal",
        displayField: "name",
        fields: { name: { type: "text", required: true }, grams: { type: "number" } },
        computed: { kcal },
      },
    },
    pages: [
      { id: "meals", title: "Meals", view: { type: "list", entity: "meal", display: { primary: "name" } } },
      { id: "heavy", title: "Heavy", view: { type: "list", entity: "meal", filter: () => false, display: { primary: "name" } } },
    ],
  } as never);

describe("smokeReport", () => {
  it("names what threw, the page that showed nothing, and what ran", async () => {
    const report = smokeReport(
      await smokeApp(
        app((_r, ctx) => (ctx as unknown as { nutrition: { lookup(): number } }).nutrition.lookup()) as never,
      ),
    );
    expect(report.errors.join("\n")).toMatch(/computed meal/);
    expect(report.warnings).toEqual(['page "heavy" showed none of the sample records — a filter that can never match?']);
    expect(report.ran).toContain("3 records");
  });

  it("is clean for an app whose logic runs", async () => {
    const report = smokeReport(await smokeApp(app((r) => ((r as { grams?: number }).grams ?? 0) * 2) as never));
    expect(report.errors).toEqual([]);
    expect(report.ran).toMatch(/3 records, 2 pages, 3 computed values/);
  });
});

describe("describeRun", () => {
  it("lists errors and warnings, capped, in words", () => {
    const text = describeRun({ errors: Array.from({ length: 20 }, (_, i) => `error ${i}`), warnings: ["page x showed nothing"], ran: "2 pages" });
    expect(text).toContain("Ran it on sample records (2 pages).");
    expect(text).toContain("- error 0");
    expect(text).toContain("… and 8 more");
    expect(text).toContain("Looks wrong:\n- page x showed nothing");
  });

  it("says when nothing went wrong, and merges two runs", () => {
    const both = mergeRuns({ errors: [], warnings: [], ran: "2 pages" }, { errors: [], warnings: [], ran: "2 pages rendered" });
    expect(describeRun(both)).toBe("Ran it on sample records (2 pages, 2 pages rendered).\nNothing threw and every page showed something.");
  });
});
