import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, fieldValueProblem, isPotyroApp, structureSchema, wordGaps, wordSlots } from "potyro";
import app from "../mood-sleep.app.js";

describe("Sleep & Mood", () => {
  it("is a valid app", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
  });

  it("imports chart.js by an exact-version URL", () => {
    const source = readFileSync(new URL("../mood-sleep.app.ts", import.meta.url), "utf8");
    expect(source).toMatch(/from "https:\/\/esm\.sh\/chart\.js@\d+\.\d+\.\d+\?bundle"/);
  });

  it("ships a seed whose every value fits its field", () => {
    const seed = JSON.parse(readFileSync(new URL("../seed.json", import.meta.url), "utf8")) as Record<string, Array<Record<string, unknown>>>;
    expect(Object.keys(seed)).toEqual(["checkin"]);
    const fields = app.entities.checkin!.fields;
    expect(seed.checkin!.length).toBeGreaterThanOrEqual(18);
    for (const row of seed.checkin!) {
      for (const [key, value] of Object.entries(row)) {
        expect(fields[key], key).toBeDefined();
        expect(fieldValueProblem(fields[key]!, value, "write", key), `${key}=${JSON.stringify(value)}`).toBeNull();
      }
    }
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
