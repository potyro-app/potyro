import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, structureSchema, wordGaps, wordSlots } from "potyro";
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
    expect(() => checkLevels({ colors: { R: "#f00" }, levels: [{ name: 3, speed: 1, rows: ["R"] }] })).toThrow(/needs a `name`/);
  });

  it("names each shipped level in all six languages (#303)", async () => {
    const levels = checkLevels(JSON.parse(await readFile(new URL("../levels.json", import.meta.url), "utf8")));
    for (const lv of levels.levels) expect(Object.keys(lv.name as object)).toEqual(["en", "pt-BR", "de", "es", "pl", "it"]);
  });
});

describe("in six languages (#303)", () => {
  it("is written in English and carries all six, with no map missing one", () => {
    expect(app.language).toBe("en");
    expect(app.languages).toEqual(["en", "pt-BR", "de", "es", "pl", "it"]);
    expect(checkWords(app)).toEqual([]);
    expect(wordGaps(app)).toEqual([]);
  });

  it("leaves plain only what reads the same everywhere: units and the game's name", () => {
    const plain = wordSlots(app)
      .filter((s) => typeof s.value === "string")
      .map((s) => s.value as string);
    for (const p of plain) expect(p, p).toMatch(/^(\S{1,5}|Breakout)$/);
  });
});
