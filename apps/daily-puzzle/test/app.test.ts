import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, structureSchema, wordGaps, wordSlots, type Words } from "potyro";
import app from "../daily-puzzle.app.js";
import { GEMS } from "../gems.js";
import { COLOURS } from "../puzzle.js";
import { GEM_NAMES, W } from "../words.js";

const source = readFileSync(new URL("../daily-puzzle.app.ts", import.meta.url), "utf8");
const LANGUAGES = ["en", "pt-BR", "de", "es", "pl", "it"];

describe("Potyro Daily", () => {
  it("is a valid app", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
  });

  it("keeps a finished day as a record, and asks only for haptics", () => {
    expect(Object.keys(app.entities.game!.fields)).toEqual(["number", "date", "won", "guesses", "grid"]);
    expect(app.permissions).toEqual({ haptics: true });
  });

  it("shares through ctx.ui.share, never the browser's clipboard or share sheet itself (CLAUDE.md rule 2)", () => {
    expect(source).toContain("ui.share(");
    expect(source).not.toMatch(/navigator\.(clipboard|share)/);
  });

  it("has a gem, a shape and a name for every colour", () => {
    expect(GEMS).toHaveLength(COLOURS);
    expect(GEM_NAMES).toHaveLength(COLOURS);
    expect(new Set(GEMS.map((g) => g.shape)).size).toBe(COLOURS);
  });
});

describe("in six languages (#303)", () => {
  it("is written in English and carries all six, with no declared map missing one", () => {
    expect(app.language).toBe("en");
    expect(app.languages).toEqual(LANGUAGES);
    expect(checkWords(app)).toEqual([]);
    expect(wordGaps(app)).toEqual([]);
    expect(wordSlots(app).filter((s) => typeof s.value === "string")).toEqual([]);
  });

  /** `{n}`, `{exact}`… — the names an ICU message expects, so every language fills the same ones. */
  const names = (text: string) => [...new Set([...text.matchAll(/\{(\w+)(?=[,}])/g)].map((m) => m[1]))].sort();
  const all: Array<[string, Words]> = [
    ...Object.entries(W).flatMap(([k, v]) => (Array.isArray(v) ? v.map((w, i): [string, Words] => [`${k}.${i}`, w]) : [[k, v] as [string, Words]])),
    ...GEM_NAMES.map((w, i): [string, Words] => [`gem.${i}`, w]),
  ];

  it.each(all)("%s says it in all six, with the same placeholders", (_key, words) => {
    expect(typeof words).toBe("object");
    const map = words as Record<string, string>;
    expect(Object.keys(map)).toEqual(LANGUAGES);
    for (const l of LANGUAGES) {
      expect(map[l]!.trim().length, l).toBeGreaterThan(0);
      expect(names(map[l]!), l).toEqual(names(map.en!));
    }
  });
});
