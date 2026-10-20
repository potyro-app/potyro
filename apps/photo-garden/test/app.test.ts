import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { catalogProblems } from "@potyro/generator/app-catalog";
import { readAppSources } from "@potyro/generator/app-sources";
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

  it("asks for the camera, and imports p5 by an exact-version URL — only when the Studio mounts (#388)", () => {
    expect(app.permissions?.camera).toBe(true);
    // At the top, a type only: p5 reads `window` as it loads, and a shared app's logic runs in a Worker.
    expect(source).toMatch(/import type p5 from "https:\/\/esm\.sh\/p5@\d+\.\d+\.\d+\?bundle"/);
    expect(source).toMatch(/await import\("https:\/\/esm\.sh\/p5@\d+\.\d+\.\d+\?bundle"\)/);
    expect(source).not.toMatch(/^import p5 from/m);
  });

  it("reaches the camera only through ctx (CLAUDE.md rule 2)", () => {
    expect(source).toContain("ctx.caps.camera");
    expect(source).not.toMatch(/navigator\.(mediaDevices|getUserMedia)|getUserMedia/);
  });

  it("uses p5 in instance mode and tears it down", () => {
    expect(source).toMatch(/new P5\(\(p\) =>/);
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

  it("carries a catalog for each other language, in step with its code, every word translated (docs/30)", async () => {
    // Its source and the modules of its own it imports: their words are the app's.
    const { source, modules } = readAppSources(fileURLToPath(new URL("../photo-garden.app.ts", import.meta.url)));
    const read = (l: string): string | undefined => {
      try {
        return readFileSync(new URL(`../locales/${l}.po`, import.meta.url), "utf8");
      } catch {
        return undefined;
      }
    };
    const catalogs = Object.fromEntries(["pt-BR", "de", "es", "pl", "it"].map((l) => [l, read(l)]));
    expect(await catalogProblems({ source, modules, catalogs, same: /^(\S{1,5}|Photo Garden)$/ })).toEqual([]);
  });
});
