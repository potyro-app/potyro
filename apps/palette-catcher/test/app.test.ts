import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReferences, checkWords, isPotyroApp, structureSchema, word, wordGaps } from "potyro";
import type { Ctx, Words } from "potyro";
import app from "../palette-catcher.app.js";
import { colorWords, paletteName, slug } from "../names.js";
import { extractPalette, rgbToOklab, type Picture, type RGB } from "../palette.js";
import { paintSample } from "../sample.js";
import { W } from "../words.js";

const source = readFileSync(new URL("../palette-catcher.app.ts", import.meta.url), "utf8");
const LANGS = ["en", "pt-BR", "de", "es", "pl", "it"] as const;

/** `ctx.t` for one language, without ICU: enough for names, which have no variables. */
const sayIn = (lang: (typeof LANGS)[number]): Pick<Ctx, "t"> => ({
  t: (w: Words) => word(w, lang, app),
});

describe("Palette Catcher", () => {
  it("is a valid app", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(structureSchema.safeParse(app).success).toBe(true);
    expect(checkReferences(app)).toEqual([]);
  });

  it("reaches the camera only through ctx (CLAUDE.md rule 2), and shares through ctx.files", () => {
    expect(app.permissions?.camera).toBe(true);
    expect(source).toContain("ctx.caps.camera");
    expect(source).not.toMatch(/navigator\.(mediaDevices|getUserMedia)|getUserMedia/);
    expect(source).toContain("ctx.files.export");
    expect(source).toContain("ctx.files.write");
  });

  it("keeps a palette as a record: its name, its colours as hexes, and its photo in its own folder", () => {
    const fields = app.entities.palette!.fields;
    expect(fields.name).toMatchObject({ type: "text", required: true });
    expect(fields.colors).toMatchObject({ type: "text", required: true });
    expect(fields.photo).toMatchObject({ type: "file", folder: "photos" });
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

  it("has a word for every colour in every language", () => {
    for (let h = 0; h < 360; h += 5)
      for (const l of [0.3, 0.75]) {
        const lab: [number, number, number] = [l, 0.12 * Math.cos((h * Math.PI) / 180), 0.12 * Math.sin((h * Math.PI) / 180)];
        const w = colorWords(lab) as Record<string, string>;
        for (const lang of LANGS) expect(w[lang], `${h}° ${lang}`).toBeTruthy();
      }
    for (const g of [0, 0.4, 0.7, 0.95]) expect(colorWords([g, 0, 0])).toBeTruthy();
  });
});

describe("naming a palette", () => {
  const two = (a: RGB, b: RGB): Picture => {
    const w = 40;
    const data = new Uint8ClampedArray(w * w * 4);
    for (let i = 0; i < w * w; i++) data.set([...((i % w) < 30 ? a : b), 255], i * 4);
    return { width: w, height: w, data };
  };

  it("pairs the biggest colour with the most vivid other one", () => {
    const pal = extractPalette(two([30, 40, 90], [240, 190, 70]), 5);
    expect(paletteName(pal, sayIn("en"))).toBe("Midnight & Honey");
    expect(paletteName(pal, sayIn("pl"))).toBe("Północ & Miód");
  });

  it("adds a numeral when the name is taken", () => {
    const pal = extractPalette(two([30, 40, 90], [240, 190, 70]), 5);
    expect(paletteName(pal, sayIn("en"), ["Midnight & Honey"])).toBe("Midnight & Honey II");
    expect(paletteName(pal, sayIn("en"), ["Midnight & Honey", "Midnight & Honey II"])).toBe("Midnight & Honey III");
  });

  it("names grey colours as greys", () => {
    expect(sayIn("en").t(colorWords(rgbToOklab([40, 40, 42])))).toBe("Charcoal");
    expect(sayIn("en").t(colorWords(rgbToOklab([245, 244, 240])))).toBe("Chalk");
  });

  it("makes a file name any device can store, from any language", () => {
    const at = new Date(2026, 9, 15, 9, 30, 5);
    expect(slug("Północ & Miód", at)).toBe("polnoc-miod-20261015-093005");
    expect(slug("Céu & Limão", at)).toBe("ceu-limao-20261015-093005");
    expect(slug("???", at)).toBe("palette-20261015-093005");
  });
});

describe("the sample photo", () => {
  it("is a dusk with distinct colours enough for a full palette, all found in it", () => {
    const pal = extractPalette(paintSample(320, 240), 8);
    expect(pal).toHaveLength(8);
    expect(pal.filter((s) => !s.derived).length).toBeGreaterThanOrEqual(6);
  });
});
