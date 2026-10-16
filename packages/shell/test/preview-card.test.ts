// What a link preview may show (docs/24 §5): a few lines of the app's DEMO records, short, and the
// app's name — drawn from the demo package only.
import { describe, expect, it } from "vitest";
import { previewLines } from "../src/preview-card.js";
import { previewMeta } from "../src/demo-share.js";
import { demoSeed } from "../src/demo-package.js";

describe("preview lines", () => {
  it("come from the first screen's records, by their naming field, three at most", async () => {
    const seed = await demoSeed("groceries", ["aisle", "item"]);
    expect(previewLines(seed, ["item", "aisle"])).toEqual(["Apples", "Bananas", "Spinach"]);
  });

  it("fall back to a short text field, skip dates and ids, and shorten long ones", () => {
    const seed = {
      note: [
        { id: "01J", when: "2026-10-15T10:00:00.000Z", body: "x".repeat(200), tag: "Garden" },
        { id: "01K", title: "A very long title that goes on and on and on past the edge" },
      ],
    };
    const lines = previewLines(seed, ["note"]);
    expect(lines[0]).toBe("Garden");
    expect(lines[1]!.length).toBeLessThanOrEqual(42);
    expect(lines[1]!.endsWith("…")).toBe(true);
  });

  it("are none without demo records", () => {
    expect(previewLines(undefined, ["x"])).toEqual([]);
    expect(previewLines({}, ["x"])).toEqual([]);
  });
});

describe("preview meta", () => {
  it("is the app's name and a line about trying it; the maker only when they chose to show it", () => {
    expect(previewMeta("Groceries", undefined)).toMatchObject({ title: "Groceries", description: expect.stringMatching(/Try it in your browser/) });
    expect(previewMeta("Groceries", "Ana").description).toMatch(/^By Ana\./);
  });
});
