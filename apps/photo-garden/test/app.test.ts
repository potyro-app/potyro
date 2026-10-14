import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, structureSchema, wordGaps, wordSlots } from "potyro";
import app from "../photo-garden.app.js";

const source = readFileSync(new URL("../photo-garden.app.ts", import.meta.url), "utf8");

describe("Photo Garden", () => {
  it("is a valid app", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
  });

  it("asks for the camera, and imports p5 by an exact-version URL", () => {
    expect(app.permissions?.camera).toBe(true);
    expect(source).toMatch(/from "https:\/\/esm\.sh\/p5@\d+\.\d+\.\d+\?bundle"/);
  });

  it("reaches the camera only through ctx (CLAUDE.md rule 2)", () => {
    expect(source).toContain("ctx.caps.camera");
    expect(source).not.toMatch(/navigator\.(mediaDevices|getUserMedia)|getUserMedia/);
  });

  it("uses p5 in instance mode and tears it down", () => {
    expect(source).toMatch(/new p5\(\(p\) =>/);
    expect(source).toContain("sketch?.remove()");
  });

  it("keeps an artwork as a record pointing at a PNG in its own folder", () => {
    const fields = app.entities.artwork!.fields;
    expect(fields.image).toMatchObject({ type: "file", folder: "garden" });
    expect(fields.style).toMatchObject({ type: "enum", options: ["flow", "points", "mosaic"] });
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
