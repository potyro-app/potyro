import { describe, expect, it } from "vitest";
import { contrast } from "@potyro/design";
import { parseColour } from "../src/tile-colour.js";
import { tilePair } from "../src/app-colour.js";
import { checkTileContent, hasLiveFace, showTile, TILE_LIMITS } from "../src/tile-content.js";

describe("tile colour", () => {
  it("reads hex, rgb(), hsl() and oklch()", () => {
    expect(parseColour("#fff")!.l).toBeCloseTo(1, 3);
    expect(parseColour("#000000")!.l).toBeCloseTo(0, 3);
    expect(parseColour("rgb(255 0 0)")!.h).toBeCloseTo(29.2, 0);
    expect(parseColour("hsl(120, 100%, 25%)")!.h).toBeCloseTo(142.5, 0);
    expect(parseColour("oklch(62% 0.2 250)")).toEqual({ l: 0.62, c: 0.2, h: 250 });
    expect(parseColour("not a colour")).toBeNull();
  });

  // DESIGN.md §3.1: a tile is its hour's button pair, so the small words on it read (AA) at every
  // angle, in both themes. Graphite on the bare traço does not: roxo's is 4.1:1.
  it("is the hour's button pair, readable at every angle in both themes", () => {
    for (let h = 0; h < 360; h += 5) {
      const p = tilePair(h);
      expect(contrast(p["--tile-bg-l"]!, p["--tile-ink-l"]!), `light ${h}°`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p["--tile-bg-d"]!, p["--tile-ink-d"]!), `dark ${h}°`).toBeGreaterThanOrEqual(4.5);
    }
    // Roxo (10h): the tinta with white in the light, the dark theme's tinta with graphite in the dark.
    expect(tilePair(300)).toEqual({ "--tile-bg-l": "#884dd5", "--tile-ink-l": "#ffffff", "--tile-bg-d": "#b995f7", "--tile-ink-d": "#1c1b1c" });
    // Verde (5h): the traço with graphite, the same in both.
    expect(tilePair(150)).toEqual({ "--tile-bg-l": "#49de78", "--tile-ink-l": "#231f20", "--tile-bg-d": "#49de78", "--tile-ink-d": "#1c1b1c" });
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
