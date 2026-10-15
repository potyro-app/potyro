import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, structureSchema, wordGaps, wordSlots, type Words } from "potyro";
import app from "../photo-puzzle.app.js";
import { LEVEL_NAMES, W } from "../words.js";

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const code = ["photo-puzzle.app.ts", "common.ts", "play.ts", "puzzles.ts"].map(read).join("\n");
const LANGUAGES = ["en", "pt-BR", "de", "es", "pl", "it"];

describe("Photo Puzzle", () => {
  it("is a valid app", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
  });

  it("keeps the photo as a file a puzzle points at, and each solve as a record", () => {
    expect(app.entities.puzzle!.fields.photo).toMatchObject({ type: "file", folder: "photos" });
    expect(app.entities.solve!.fields.puzzle).toMatchObject({ type: "relation", to: "puzzle" });
    expect(app.entities.solve!.fields.level).toMatchObject({ type: "enum", options: ["easy", "medium", "hard"] });
  });

  it("reaches the camera, the clipboard and the share sheet only through ctx (CLAUDE.md rule 2)", () => {
    expect(app.permissions).toEqual({ camera: true, haptics: true });
    expect(code).toContain("ctx.caps.camera");
    expect(code).toContain("ui.share(");
    expect(code).toContain("space.invite()");
    expect(code).not.toMatch(/navigator\.(mediaDevices|clipboard|share)|getUserMedia/);
  });

  it("says the photo goes to whoever gets the link before making one", () => {
    const send = read("common.ts");
    expect(send.indexOf("W.sendDetail")).toBeGreaterThan(-1);
    expect(send.indexOf("W.sendDetail")).toBeLessThan(send.indexOf("space.invite()"));
    expect(String((W.sendDetail as Record<string, string>).en)).toMatch(/Whoever gets the link/);
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

  const names = (text: string) => [...new Set([...text.matchAll(/\{(\w+)(?=[,}])/g)].map((m) => m[1]))].sort();
  const all: Array<[string, Words]> = [...Object.entries(W), ...Object.entries(LEVEL_NAMES).map(([k, v]): [string, Words] => [`level.${k}`, v])];

  it.each(all)("%s says it in all six, with the same placeholders", (_key, words) => {
    const map = words as Record<string, string>;
    expect(Object.keys(map)).toEqual(LANGUAGES);
    for (const l of LANGUAGES) {
      expect(map[l]!.trim().length, l).toBeGreaterThan(0);
      expect(names(map[l]!), l).toEqual(names(map.en!));
    }
  });
});
