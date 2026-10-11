import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { checkReferences, isPotyroApp, structureSchema } from "potyro";
import app, { checkLevels } from "../breakout.app.js";

describe("breakout", () => {
  it("is a valid app", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
  });

  it("ships levels that check out", async () => {
    const levels = checkLevels(JSON.parse(await readFile(new URL("../levels.json", import.meta.url), "utf8")));
    expect(levels.levels.length).toBeGreaterThan(1);
  });

  it("says what is wrong with a broken levels file", () => {
    expect(() => checkLevels({ colors: { R: "#f00" }, levels: [{ name: "x", speed: 1, rows: ["RX"] }] })).toThrow(/"X" is not one of the colours/);
    expect(() => checkLevels({ colors: {}, levels: [] })).toThrow(/at least one level/);
  });
});
