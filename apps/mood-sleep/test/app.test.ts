import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { catalogProblems } from "@potyro/generator/app-catalog";
import { readAppSources } from "@potyro/generator/app-sources";
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

  it("carries a catalog for each other language, in step with its code, every word translated (docs/30)", async () => {
    // Its source and the modules of its own it imports: their words are the app's.
    const { source, modules } = readAppSources(fileURLToPath(new URL("../mood-sleep.app.ts", import.meta.url)));
    const read = (l: string): string | undefined => {
      try {
        return readFileSync(new URL(`../locales/${l}.po`, import.meta.url), "utf8");
      } catch {
        return undefined;
      }
    };
    const catalogs = Object.fromEntries(["pt-BR", "de", "es", "pl", "it"].map((l) => [l, read(l)]));
    expect(await catalogProblems({ source, modules, catalogs, same: /^(\S{1,5}|Sleep & Mood)$/ })).toEqual([]);
  });
});
