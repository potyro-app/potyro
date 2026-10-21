import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, structureSchema, wordGaps } from "potyro";
import app from "../which-is-cheaper.app.js";
import { W } from "../words.js";

const LANGS = ["en", "pt-BR", "de", "es", "pl", "it"] as const;

describe("Which is cheaper", () => {
  it("is a valid app", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
  });

  it("keeps a comparison as a record: a name, a currency, and up to three priced items in whole minor units (KA-26)", () => {
    const fields = app.entities.comparison!.fields;
    expect(fields.name).toMatchObject({ type: "text", required: true });
    expect(fields.currency).toMatchObject({ type: "enum" });
    for (const k of ["a", "b", "c"]) {
      expect(fields[`${k}Price`]).toMatchObject({ type: "money" });
      expect(fields[`${k}Amount`]).toMatchObject({ type: "number" });
      expect(fields[`${k}Unit`]).toMatchObject({ type: "enum", options: ["g", "kg", "ml", "l", "pcs"] });
    }
  });

  it("opens on the comparison, with the kept ones a tab away, and reopens a kept one on the cards", () => {
    expect(app.pages.map((p) => p.id)).toEqual(["compare", "kept"]);
    expect(app.pages[1]!.view).toMatchObject({ type: "list", entity: "comparison", onOpen: { page: "compare", param: { id: "id" } } });
  });

  it("ships a sample comparison, so a demo opens on an answer", () => {
    const seed = JSON.parse(readFileSync(new URL("../seed.json", import.meta.url), "utf8")) as { comparison: Array<Record<string, unknown>> };
    expect(seed.comparison).toHaveLength(1);
    expect(seed.comparison[0]).toMatchObject({ aPrice: 499, aUnit: "ml", bPrice: 849, bUnit: "l", winner: "B" });
  });
});

describe("in six languages (#303)", () => {
  it("is written in English and carries all six, with no map missing one", () => {
    expect(app.language).toBe("en");
    expect(app.languages).toEqual([...LANGS]);
    expect(checkWords(app)).toEqual([]);
    expect(wordGaps(app)).toEqual([]);
  });

  it("says everything on its screens in every language", () => {
    for (const [key, words] of Object.entries(W)) {
      for (const l of LANGS) expect((words as Record<string, string>)[l], `${key}.${l}`).toBeTruthy();
    }
  });

  it("keeps the same {placeholders} in every language of a message", () => {
    for (const [key, words] of Object.entries(W)) {
      const vars = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
      const en = vars((words as Record<string, string>).en!);
      for (const l of LANGS) expect(vars((words as Record<string, string>)[l]!), `${key}.${l}`).toEqual(en);
    }
  });
});
