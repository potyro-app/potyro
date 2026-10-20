import { describe, expect, it } from "vitest";
import {
  analyse,
  choose,
  contrast,
  decodeColors,
  deltaE,
  encodeColors,
  extractPalette,
  formats,
  inkOn,
  MAX_COLORS,
  MIN_COLORS,
  oklabToRgb,
  oklch,
  paletteOf,
  parseHex,
  rgbToOklab,
  rng,
  SAME,
  type Picture,
  type RGB,
} from "../palette.js";

/** A picture painted by a function of (x, y). */
function paint(w: number, h: number, at: (x: number, y: number) => RGB | null): Picture {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = at(x, y);
      data.set(c ? [...c, 255] : [0, 0, 0, 0], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}

/** Each colour jittered a little, as a camera sees a flat surface. */
const noisy = (c: RGB, r: () => number, amp = 10): RGB => c.map((v) => Math.max(0, Math.min(255, Math.round(v + (r() - 0.5) * amp)))) as RGB;

const lab = (c: RGB) => rgbToOklab(c);
const closest = (pal: { lab: [number, number, number] }[], c: RGB) => Math.min(...pal.map((s) => deltaE(s.lab, lab(c))));

const TERRACOTTA: RGB = [196, 98, 64];
const SAGE: RGB = [143, 165, 128];
const CREAM: RGB = [240, 230, 208];
const NAVY: RGB = [32, 46, 86];

describe("OKLab", () => {
  it("matches the reference values for white, black and sRGB red", () => {
    const w = rgbToOklab([255, 255, 255]);
    expect(w[0]).toBeCloseTo(1, 3);
    expect(Math.abs(w[1]) + Math.abs(w[2])).toBeLessThan(1e-3);
    expect(rgbToOklab([0, 0, 0])).toEqual([0, 0, 0]);
    const red = rgbToOklab([255, 0, 0]);
    expect(red[0]).toBeCloseTo(0.628, 3);
    expect(red[1]).toBeCloseTo(0.2249, 3);
    expect(red[2]).toBeCloseTo(0.1258, 3);
  });

  it("goes there and back without losing a step of any channel", () => {
    const r = rng(3);
    for (let i = 0; i < 3000; i++) {
      const c: RGB = [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256)];
      const back = oklabToRgb(rgbToOklab(c));
      for (let k = 0; k < 3; k++) expect(Math.abs(back[k]! - c[k]!)).toBeLessThanOrEqual(1);
    }
  });
});

describe("the ways a colour is written", () => {
  it("writes hex, rgb() and oklch() as CSS one can paste", () => {
    expect(formats([255, 0, 0])).toEqual({ hex: "#FF0000", rgb: "rgb(255, 0, 0)", oklch: "oklch(62.8% 0.258 29.2)" });
    expect(formats([128, 128, 128]).oklch).toMatch(/^oklch\(\d+(\.\d)?% 0 0\)$/);
  });

  it("reads a hex back, with or without the #, and refuses what is not one", () => {
    expect(parseHex("#c2a38b")).toEqual([194, 163, 139]);
    expect(parseHex("C2A38B")).toEqual([194, 163, 139]);
    expect(parseHex("#c2a38")).toBeNull();
    expect(parseHex("red")).toBeNull();
  });

  it("stores a palette as plain hexes and reads it back, skipping anything else", () => {
    expect(encodeColors(["#C2A38B", "#3d4a5c"])).toBe("#c2a38b #3d4a5c");
    expect(decodeColors("#c2a38b #3d4a5c, junk #fff #112233")).toEqual(["#c2a38b", "#3d4a5c", "#112233"]);
    expect(decodeColors(undefined)).toEqual([]);
  });
});

describe("text on a swatch", () => {
  it("measures contrast as WCAG 2 does", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2);
  });

  it("always reads at 4.5:1 or better, on any colour", () => {
    const r = rng(11);
    for (let i = 0; i < 4000; i++) {
      const bg: RGB = [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256)];
      const { ink, ratio } = inkOn(bg);
      expect(ratio, String(bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ink, bg)).toBeCloseTo(ratio, 6);
    }
  });

  it("tints the ink with the swatch's own hue when that still reads", () => {
    const { ink } = inkOn(NAVY);
    expect(ink).not.toEqual([255, 255, 255]);
    expect(oklch(rgbToOklab(ink)).l).toBeGreaterThan(0.9);
    const onCream = inkOn(CREAM).ink;
    expect(oklch(rgbToOklab(onCream)).l).toBeLessThan(0.3);
    expect(oklch(rgbToOklab(onCream)).c).toBeGreaterThan(0.005);
  });
});

describe("a palette from a photo", () => {
  const bands = () => {
    const r = rng(5);
    return paint(200, 160, (x) => noisy([TERRACOTTA, SAGE, CREAM, NAVY][Math.floor(x / 50)]!, r));
  };

  it("finds every colour the photo is made of, as the photo shows it", () => {
    const pal = extractPalette(bands(), 5);
    expect(pal).toHaveLength(5);
    for (const c of [TERRACOTTA, SAGE, CREAM, NAVY]) expect(closest(pal, c), String(c)).toBeLessThan(0.025);
    // Their shares are what they cover: a quarter each.
    for (const s of pal.filter((s) => !s.derived).slice(0, 4)) expect(s.weight).toBeGreaterThan(0.18);
    expect(pal.reduce((t, s) => t + s.weight, 0)).toBeCloseTo(1, 6);
  });

  it("says where each colour is: a point inside its own band", () => {
    const pal = extractPalette(bands(), 4);
    for (const [i, c] of [TERRACOTTA, SAGE, CREAM, NAVY].entries()) {
      const s = pal.find((p) => deltaE(p.lab, lab(c)) < 0.03)!;
      expect(s.at).not.toBeNull();
      expect(Math.floor((s.at!.x * 200) / 50), String(c)).toBe(i);
    }
  });

  it("keeps a small vivid accent that a big dull area would drown in an average", () => {
    const r = rng(9);
    const RED: RGB = [214, 40, 48];
    // A grey street, from a pale sky down to dark asphalt, with a red umbrella over 4% of it. Counted
    // by area alone, the greys would take every place: there are many of them and each is bigger.
    const street = paint(200, 200, (x, y) => {
      if (Math.hypot(x - 120, y - 80) < 23) return noisy(RED, r);
      const v = Math.round(215 - (y / 200) * 170);
      return noisy([v, v, v + 4], r, 8);
    });
    const pal = extractPalette(street, 5);
    expect(closest(pal, RED)).toBeLessThan(0.03);
    const red = pal.find((s) => deltaE(s.lab, lab(RED)) < 0.03)!;
    expect(red.weight).toBeLessThan(0.08);
    expect(red.at!.x).toBeGreaterThan(0.45);
    expect(red.at!.x).toBeLessThan(0.75);
  });

  it("chooses a vivid accent over one more big grey, when there is room for only one of them", () => {
    const grey = (l: number, weight: number) => ({ lab: [l, 0, 0] as [number, number, number], rgb: oklabToRgb([l, 0, 0]), weight });
    const RED = rgbToOklab([214, 40, 48]);
    const cands = [grey(0.92, 0.3), grey(0.72, 0.25), grey(0.52, 0.2), grey(0.32, 0.21), { lab: RED, rgb: oklabToRgb(RED), weight: 0.04 }];
    const picked = choose(cands, 4);
    expect(picked).toHaveLength(4);
    expect(picked.some((c) => deltaE(c.lab, RED) < 1e-9)).toBe(true);
  });

  it("is not muddy: two colours side by side do not give the colour in between", () => {
    const r = rng(2);
    const RED: RGB = [210, 40, 50];
    const BLUE: RGB = [40, 60, 200];
    const pal = extractPalette(paint(120, 80, (x) => noisy(x < 60 ? RED : BLUE, r)), 5);
    const between = oklabToRgb(lab(RED).map((v, i) => (v + lab(BLUE)[i]!) / 2) as [number, number, number]);
    expect(closest(pal.filter((s) => !s.derived), between)).toBeGreaterThan(0.1);
    expect(closest(pal, RED)).toBeLessThan(0.03);
    expect(closest(pal, BLUE)).toBeLessThan(0.03);
  });

  it("does not spend two places on one colour", () => {
    const r = rng(4);
    const sunset = paint(240, 160, (x, y) => {
      const t = y / 160;
      return noisy([Math.round(250 - 120 * t), Math.round(170 - 110 * t), Math.round(90 + 60 * t)], r, 6);
    });
    for (let n = MIN_COLORS; n <= MAX_COLORS; n++) {
      const pal = extractPalette(sunset, n);
      expect(pal).toHaveLength(n);
      for (let i = 0; i < pal.length; i++) for (let j = i + 1; j < pal.length; j++) expect(deltaE(pal[i]!.lab, pal[j]!.lab)).toBeGreaterThanOrEqual(SAME);
    }
  });

  it("fills a photo of one colour with its tints and shades, marked as made, with nowhere to point", () => {
    const pal = extractPalette(paint(60, 60, () => SAGE), 6);
    expect(pal).toHaveLength(6);
    expect(pal[0]!.derived).toBe(false);
    expect(closest([pal[0]!], SAGE)).toBeLessThan(0.01);
    expect(pal.slice(1).every((s) => s.derived && s.at === null)).toBe(true);
    // Lighter ones before darker ones, after the colour itself.
    const ls = pal.slice(1).map((s) => s.lab[0]);
    expect([...ls].sort((a, b) => b - a)).toEqual(ls);
  });

  it("ignores transparent pixels", () => {
    const pal = extractPalette(paint(80, 80, (x) => (x < 40 ? null : NAVY)), 5);
    expect(closest([pal[0]!], NAVY)).toBeLessThan(0.01);
    expect(closest(pal, [0, 0, 0])).toBeGreaterThan(0.05);
  });

  it("gives the same palette for the same photo, every time", () => {
    const a = extractPalette(bands(), 7).map((s) => s.hex);
    const b = extractPalette(bands(), 7).map((s) => s.hex);
    expect(a).toEqual(b);
  });

  it("re-chooses a different count from one analysis, without reading the photo again", () => {
    const x = analyse(bands());
    expect(paletteOf(x, 5)).toHaveLength(5);
    expect(paletteOf(x, 8)).toHaveLength(8);
    expect(paletteOf(x, 99)).toHaveLength(MAX_COLORS);
    expect(paletteOf(analyse(paint(4, 4, () => null)), 6)).toEqual([]);
  });

  it("is quick enough for a phone: even pure noise, the worst case, takes a fraction of a second (a loose bound, so a busy test machine does not fail it)", () => {
    const r = rng(1);
    const pic = paint(480, 360, () => [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256)]);
    const t = performance.now();
    const pal = extractPalette(pic, 8);
    expect(performance.now() - t).toBeLessThan(2500);
    expect(pal).toHaveLength(8);
  });
});
