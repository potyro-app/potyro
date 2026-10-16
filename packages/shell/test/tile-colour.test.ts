import { describe, expect, it } from "vitest";
import { TILE_CONTRAST, contrastWithWhite, parseColour, readableOnWhite, tileBackground } from "../src/tile-colour.js";
import { checkTileContent, hasLiveFace, showTile, TILE_LIMITS } from "../src/tile-content.js";

// A Metro tile is the app's own colour with white on it, readable whatever the colour (owner, 2026-10-15).

const contrast = (css: string): number => contrastWithWhite(parseColour(css)!);

describe("tile colour", () => {
  it("reads hex, rgb(), hsl() and oklch()", () => {
    expect(parseColour("#fff")!.l).toBeCloseTo(1, 3);
    expect(parseColour("#000000")!.l).toBeCloseTo(0, 3);
    expect(parseColour("rgb(255 0 0)")!.h).toBeCloseTo(29.2, 0);
    expect(parseColour("hsl(120, 100%, 25%)")!.h).toBeCloseTo(142.5, 0);
    expect(parseColour("oklch(62% 0.2 250)")).toEqual({ l: 0.62, c: 0.2, h: 250 });
    expect(parseColour("not a colour")).toBeNull();
  });

  it("knows white on white fails and white on black passes", () => {
    expect(contrast("#ffffff")).toBeCloseTo(1, 2);
    expect(contrast("#000000")).toBeCloseTo(21, 0);
  });

  it("darkens a pale accent until white on it reaches AA, keeping its hue", () => {
    // Plants' own green: white on it is 1.8:1.
    expect(contrast("#7FCF8E")).toBeLessThan(2);
    const fixed = readableOnWhite(parseColour("#7FCF8E")!);
    expect(contrastWithWhite(fixed)).toBeGreaterThanOrEqual(TILE_CONTRAST);
    expect(contrastWithWhite(fixed)).toBeLessThan(TILE_CONTRAST + 0.3); // only as far as needed
    expect(fixed.h).toBeCloseTo(parseColour("#7FCF8E")!.h, 0);
    expect(contrast(tileBackground("#7FCF8E", 0))).toBeGreaterThanOrEqual(TILE_CONTRAST);
  });

  it("uses a colour that already passes exactly as the app wrote it", () => {
    expect(tileBackground("#0050EF", 0)).toBe("#0050EF");
    expect(tileBackground("  #1b5e20 ", 0)).toBe("#1b5e20");
  });

  it("falls back to a readable colour of the app's own hue, for every hue on the wheel", () => {
    for (let h = 0; h < 360; h += 15) {
      expect(contrast(tileBackground(undefined, h))).toBeGreaterThanOrEqual(TILE_CONTRAST);
      expect(contrast(tileBackground(`oklch(80% 0.15 ${h})`, h))).toBeGreaterThanOrEqual(TILE_CONTRAST);
    }
    expect(contrast(tileBackground("garbage", 200))).toBeGreaterThanOrEqual(TILE_CONTRAST);
  });
});

describe("tile content", () => {
  it("keeps what can be shown and drops the rest", () => {
    expect(
      checkTileContent({
        count: 3.7,
        title: "  3 to   water ",
        lines: ["Fern", { en: "Basil", pl: "Bazylia" }, 42, null, "Mint", "Sage"],
        image: { key: "b1", mime: "image/jpeg", extra: true },
        script: "<b>no</b>",
      }),
    ).toEqual({ count: 3, title: "3 to water", lines: ["Fern", { en: "Basil", pl: "Bazylia" }, "42"], image: { key: "b1", mime: "image/jpeg" } });
  });

  it("answers null for what is not a tile at all, so the plain face shows", () => {
    for (const junk of [null, undefined, 3, "3 to water", [], {}, { count: -1 }, { count: Number.NaN, title: "" }, { lines: [] }, { image: "https://evil.example/x.png" }]) {
      expect(checkTileContent(junk)).toBeNull();
    }
  });

  it("caps the count and the length of words", () => {
    const t = checkTileContent({ count: 1e9, title: "x".repeat(200), lines: ["y".repeat(200)] })!;
    expect(t.count).toBe(TILE_LIMITS.count);
    expect((t.title as string).length).toBe(TILE_LIMITS.title);
    expect((t.lines![0] as string).endsWith("…")).toBe(true);
  });

  it("keeps a picture by path in the app's folder or by file reference, never an address", () => {
    expect(checkTileContent({ image: "photos/fern.jpg" })).toEqual({ image: "photos/fern.jpg" });
    expect(checkTileContent({ image: { id: "f1", path: "a.png" } })).toEqual({ image: { id: "f1", path: "a.png" } });
    expect(checkTileContent({ image: "data:image/png;base64,AAA" })).toBeNull();
  });

  it("says its words in the language the app is shown in, and is serialisable", () => {
    const tile = checkTileContent({ count: 2, title: { en: "2 to water", pl: "2 do podlania" }, lines: [{ en: "Fern", pl: "Paproć" }] })!;
    expect(JSON.parse(JSON.stringify(tile))).toEqual(tile);
    expect(showTile(tile, "pl", { language: "en", languages: ["en", "pl"] })).toEqual({ count: 2, title: "2 do podlania", lines: ["Paproć"] });
    expect(showTile(tile, "de", { language: "en", languages: ["en", "pl"] }).title).toBe("2 to water");
    expect(hasLiveFace(showTile({ count: 2 }, "en", {}))).toBe(false);
    expect(hasLiveFace(showTile(tile, "en", {}))).toBe(true);
  });
});
