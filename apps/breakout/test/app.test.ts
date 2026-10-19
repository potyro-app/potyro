import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { catalogProblems } from "@potyro/generator/app-catalog";
import { readAppSources } from "@potyro/generator/app-sources";
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

  it("carries a catalog for each other language, in step with its code, every word translated (docs/30)", async () => {
    // Its source and the modules of its own it imports: their words are the app's.
    const { source, modules } = readAppSources(fileURLToPath(new URL("../breakout.app.ts", import.meta.url)));
    const read = (l: string): string | undefined => {
      try {
        return readFileSync(new URL(`../locales/${l}.po`, import.meta.url), "utf8");
      } catch {
        return undefined;
      }
    };
    const catalogs = Object.fromEntries(["pt-BR", "de", "es", "pl", "it"].map((l) => [l, read(l)]));
    expect(await catalogProblems({ source, modules, catalogs, same: /^(\S{1,5}|Breakout)$/ })).toEqual([]);
  });
});
