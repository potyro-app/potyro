// The colour science behind Palette Catcher. No DOM here: a photo comes in as RGBA bytes and a
// palette comes out, so the tests run every step in Node.
//
// How a photo becomes a palette:
//   1. Every pixel goes into OKLab, a space where equal distances look like equal differences, so
//      "these two colours are close" means what a person sees, not what the bytes say.
//   2. The pixels are binned (5 bits a channel) and k-means runs on the bins, weighted by how many
//      pixels each holds, from a k-means++ start with a seeded random — the same photo always gives
//      the same palette.
//   3. Each cluster is shown as a colour that is really IN the photo (the busiest bin near its
//      centre), not as the average of the cluster, which is how naive palettes turn muddy.
//   4. From those candidates the palette is chosen greedily: big areas count, vivid accents count
//      more than their size, and each pick must stand apart from the ones already chosen. A small
//      red umbrella on a grey street makes it in; twelve shades of the same grey do not.
//   5. When a photo has fewer distinct colours than asked for, the palette is filled with tints and
//      shades of the ones it has, marked `derived`, so there is always a full, usable set.

export type RGB = [number, number, number];
export type Lab = [number, number, number];

/** A small RGBA picture: the photo, shrunk to the few hundred pixels the palette is read from. */
export interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array | number[];
}

export interface Swatch {
  rgb: RGB;
  /** OKLab, L in 0–1. */
  lab: Lab;
  /** "#c2a38b", lowercase. */
  hex: string;
  /** The share of the photo nearest to this colour, 0–1; the palette's weights add up to 1. */
  weight: number;
  /** Where in the photo (fractions of its width and height) this colour can be seen. */
  at: { x: number; y: number } | null;
  /** A tint or shade made to fill the palette, not a colour found in the photo. */
  derived: boolean;
}

export const MIN_COLORS = 5;
export const MAX_COLORS = 8;

// ---- sRGB ⇄ OKLab (Björn Ottosson, 2020) ----

const LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const toLinear = (v: number): number => LINEAR[Math.max(0, Math.min(255, Math.round(v)))]!;
const fromLinear = (c: number): number => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};

export function rgbToOklab([r8, g8, b8]: RGB): Lab {
  const r = toLinear(r8);
  const g = toLinear(g8);
  const b = toLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab back to 8-bit sRGB, clipped into the screen's gamut. */
export function oklabToRgb([L, a, b]: Lab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** OKLCH: lightness 0–1, chroma (0 – about 0.37), hue in degrees 0–360. */
export function oklch(lab: Lab): { l: number; c: number; h: number } {
  const c = Math.hypot(lab[1], lab[2]);
  let h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: lab[0], c, h: c < 1e-4 ? 0 : h };
}

export function fromOklch(l: number, c: number, h: number): Lab {
  const r = (h * Math.PI) / 180;
  return [l, c * Math.cos(r), c * Math.sin(r)];
}

const dist2 = (p: Lab, q: Lab): number => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
export const deltaE = (p: Lab, q: Lab): number => Math.sqrt(dist2(p, q));

// ---- the ways a colour is written ----

const h2 = (n: number) => n.toString(16).padStart(2, "0");
export const hexOf = ([r, g, b]: RGB): string => `#${h2(r)}${h2(g)}${h2(b)}`;

export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The three ways the swatch sheet writes a colour, as CSS a designer can paste. */
export function formats(rgb: RGB): { hex: string; rgb: string; oklch: string } {
  const { l, c, h } = oklch(rgbToOklab(rgb));
  const round = (n: number, d: number) => Number(n.toFixed(d)).toString();
  return {
    hex: hexOf(rgb).toUpperCase(),
    rgb: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    oklch: `oklch(${round(l * 100, 1)}% ${round(c, 3)} ${c < 0.002 ? "0" : round(h, 1)})`,
  };
}

// ---- contrast (WCAG 2) ----

export const luminance = ([r, g, b]: RGB): number => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * What to write ON a swatch: a dark or light ink tinted with the swatch's own hue, which reads as
 * part of the colour, as long as it keeps 4.5:1 (WCAG AA for text); black or white when a tint
 * cannot. Pure black or white always reaches at least 4.58:1 against any colour.
 */
export function inkOn(bg: RGB): { ink: RGB; ratio: number } {
  const { c, h } = oklch(rgbToOklab(bg));
  const tints: RGB[] = [oklabToRgb(fromOklch(0.2, Math.min(0.06, c * 0.6), h)), oklabToRgb(fromOklch(0.985, Math.min(0.02, c * 0.25), h))];
  const best = (cands: RGB[]) =>
    cands.map((ink) => ({ ink, ratio: contrast(ink, bg) })).reduce((x, y) => (y.ratio > x.ratio ? y : x));
  const tinted = best(tints);
  if (tinted.ratio >= 4.5) return tinted;
  return best([
    [0, 0, 0],
    [255, 255, 255],
  ]);
}

// ---- extraction ----

/** A seeded random in [0, 1): the same photo always gives the same palette. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Bin {
  lab: Lab;
  rgb: RGB;
  count: number;
}

/** The photo as it was sampled, in OKLab, so a colour can be found again in it. */
export interface Grid {
  w: number;
  h: number;
  /** L, a, b per sampled pixel; NaN where the pixel was transparent. */
  lab: Float32Array;
}

/** The photo's pixels, binned at 5 bits a channel, each bin carrying its pixels' mean colour. */
export function binPixels(pic: Picture, maxSamples = 60_000): { bins: Bin[]; grid: Grid } {
  const { width, height, data } = pic;
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / maxSamples)));
  const gw = Math.ceil(width / stride);
  const gh = Math.ceil(height / stride);
  const grid: Grid = { w: gw, h: gh, lab: new Float32Array(gw * gh * 3).fill(NaN) };
  const acc = new Map<number, { r: number; g: number; b: number; count: number }>();
  const labOf = new Map<number, Lab>();
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const i = (gy * stride * width + gx * stride) * 4;
      if ((data[i + 3] ?? 255) < 128) continue; // a transparent pixel is no colour of the photo
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const exact = (r << 16) | (g << 8) | b;
      let lab = labOf.get(exact);
      if (!lab) {
        lab = rgbToOklab([r, g, b]);
        labOf.set(exact, lab);
      }
      grid.lab.set(lab, (gy * gw + gx) * 3);
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const a = acc.get(key);
      if (a) {
        a.r += r;
        a.g += g;
        a.b += b;
        a.count++;
      } else acc.set(key, { r, g, b, count: 1 });
    }
  }
  const bins: Bin[] = [];
  for (const a of acc.values()) {
    const rgb: RGB = [Math.round(a.r / a.count), Math.round(a.g / a.count), Math.round(a.b / a.count)];
    bins.push({ lab: rgbToOklab(rgb), rgb, count: a.count });
  }
  return { bins, grid };
}

/**
 * Where a colour can be seen in the photo: the pixel closest to it whose neighbours are close to it
 * too — the middle of a patch of that colour, not a stray pixel on an edge — with a slight pull
 * towards the middle of the picture, where a marker is easiest to see.
 */
export function locate(grid: Grid, lab: Lab, taken: Array<{ x: number; y: number }> = []): { x: number; y: number } | null {
  const { w, h } = grid;
  const L = grid.lab;
  const d = (i: number) => {
    const l = L[i * 3]!;
    if (Number.isNaN(l)) return 1;
    return Math.sqrt((l - lab[0]) ** 2 + (L[i * 3 + 1]! - lab[1]) ** 2 + (L[i * 3 + 2]! - lab[2]) ** 2);
  };
  const r = Math.max(1, Math.round(Math.min(w, h) / 40));
  let best = -1;
  let bestScore = Infinity;
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      const i = y * w + x;
      const here = d(i);
      if (here > 0.12) continue;
      const around = (d(i - r) + d(i + r) + d(i - r * w) + d(i + r * w)) / 4;
      // Away from markers already placed, so two never sit on top of each other.
      let crowd = 0;
      for (const t of taken) crowd += Math.max(0, 1 - Math.hypot(x / w - t.x, y / h - t.y) / 0.14);
      const score = here + around + 0.02 * Math.hypot(x / w - 0.5, y / h - 0.5) + 0.06 * crowd;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }
  if (best < 0) return null;
  return { x: ((best % w) + 0.5) / w, y: (Math.floor(best / w) + 0.5) / h };
}

interface Cluster {
  centre: Lab;
  weight: number;
  members: Bin[];
}

/** Weighted k-means over the bins, from a k-means++ start. */
export function kmeans(bins: Bin[], k: number, random: () => number, rounds = 24): Cluster[] {
  if (!bins.length) return [];
  const total = bins.reduce((s, b) => s + b.count, 0);
  k = Math.min(k, bins.length);
  // k-means++: each next centre is drawn with odds ∝ weight × squared distance to the nearest centre.
  const centres: Lab[] = [];
  let pick = random() * total;
  for (const b of bins) {
    pick -= b.count;
    if (pick <= 0) {
      centres.push([...b.lab]);
      break;
    }
  }
  if (!centres.length) centres.push([...bins[0]!.lab]);
  const nearest = bins.map((b) => dist2(b.lab, centres[0]!));
  while (centres.length < k) {
    let sum = 0;
    for (let i = 0; i < bins.length; i++) sum += nearest[i]! * bins[i]!.count;
    if (sum <= 0) break; // every bin already sits on a centre
    let r = random() * sum;
    let chosen = bins.length - 1;
    for (let i = 0; i < bins.length; i++) {
      r -= nearest[i]! * bins[i]!.count;
      if (r <= 0) {
        chosen = i;
        break;
      }
    }
    const c: Lab = [...bins[chosen]!.lab];
    centres.push(c);
    for (let i = 0; i < bins.length; i++) nearest[i] = Math.min(nearest[i]!, dist2(bins[i]!.lab, c));
  }
  const owner = new Int32Array(bins.length).fill(-1);
  for (let round = 0; round < rounds; round++) {
    let moved = 0;
    for (let i = 0; i < bins.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < centres.length; j++) {
        const d = dist2(bins[i]!.lab, centres[j]!);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (owner[i] !== best) {
        owner[i] = best;
        moved++;
      }
    }
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < bins.length; i++) {
      const s = sums[owner[i]!]!;
      const b = bins[i]!;
      s[0] += b.lab[0] * b.count;
      s[1] += b.lab[1] * b.count;
      s[2] += b.lab[2] * b.count;
      s[3] += b.count;
    }
    sums.forEach((s, j) => {
      if (s[3]! > 0) centres[j] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!];
    });
    if (moved === 0) break;
  }
  const clusters: Cluster[] = centres.map((centre) => ({ centre, weight: 0, members: [] }));
  for (let i = 0; i < bins.length; i++) {
    const c = clusters[owner[i]!]!;
    c.members.push(bins[i]!);
    c.weight += bins[i]!.count / total;
  }
  return clusters.filter((c) => c.members.length > 0);
}

interface Candidate {
  lab: Lab;
  rgb: RGB;
  weight: number;
}

/** A cluster as a colour that is really in the photo: the busiest bin close to its centre. */
function representative(c: Cluster): Candidate {
  let best = c.members[0]!;
  let bestScore = -Infinity;
  for (const b of c.members) {
    // Close to the centre matters most; among close ones, the bin with the most pixels wins.
    const score = Math.log(b.count + 1) - dist2(b.lab, c.centre) / 0.0009;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return { lab: best.lab, rgb: best.rgb, weight: c.weight };
}

/** How much a candidate deserves a place: its area, with vivid colours counted above their size. */
const appeal = (c: Candidate): number => Math.pow(c.weight, 0.55) * (0.55 + 4 * Math.min(0.25, oklch(c.lab).c));

/** Below this (OKLab ΔE) two colours read as one, and a palette should not spend a place on both. */
export const SAME = 0.045;

/**
 * Choose `n` colours from the candidates: the most appealing first, then each next one by appeal
 * times how far it stands from those already chosen (weighted farthest-point selection).
 */
export function choose(cands: Candidate[], n: number): Candidate[] {
  const left = [...cands].sort((a, b) => appeal(b) - appeal(a));
  const out: Candidate[] = [];
  while (out.length < n && left.length) {
    let bestI = -1;
    let best = -Infinity;
    for (let i = 0; i < left.length; i++) {
      const c = left[i]!;
      const d = out.length ? Math.min(...out.map((o) => deltaE(o.lab, c.lab))) : 1;
      if (d < SAME) continue;
      const score = appeal(c) * Math.min(d, 0.22);
      if (score > best) {
        best = score;
        bestI = i;
      }
    }
    if (bestI < 0) break;
    out.push(left.splice(bestI, 1)[0]!);
  }
  return out;
}

/** Tints and shades of the colours found, until the palette holds `n` (a flat photo still gets a set). */
function fill(found: Candidate[], n: number): Array<Candidate & { derived: boolean }> {
  const out = found.map((c) => ({ ...c, derived: false }));
  if (!out.length) return out;
  const steps = [0.16, -0.16, 0.3, -0.3, 0.08, -0.08, 0.4, -0.4];
  let s = 0;
  while (out.length < n && s < steps.length * found.length) {
    const base = found[s % found.length]!;
    const dl = steps[Math.floor(s / found.length) % steps.length]!;
    s++;
    const { l, c, h } = oklch(base.lab);
    const nl = Math.max(0.12, Math.min(0.97, l + dl));
    const lab = fromOklch(nl, c * (1 - Math.abs(dl) * 0.6), h);
    const rgb = oklabToRgb(lab);
    const real = rgbToOklab(rgb);
    if (out.some((o) => deltaE(o.lab, real) < SAME)) continue;
    out.push({ lab: real, rgb, weight: 0, derived: true });
  }
  return out;
}

export interface Extraction {
  /** Every candidate colour, from which any count between MIN_COLORS and MAX_COLORS is chosen. */
  candidates: Candidate[];
  bins: Bin[];
  grid: Grid;
}

/** The slow half, done once per photo: bin the pixels and cluster them. */
export function analyse(pic: Picture, seed = 7): Extraction {
  const { bins, grid } = binPixels(pic);
  const clusters = kmeans(bins, 18, rng(seed));
  // Merge clusters that would read as one colour, keeping the heavier one's look.
  const cands = clusters.map(representative).sort((a, b) => b.weight - a.weight);
  const merged: Candidate[] = [];
  for (const c of cands) {
    const twin = merged.find((m) => deltaE(m.lab, c.lab) < SAME * 0.6);
    if (twin) twin.weight += c.weight;
    else merged.push({ ...c });
  }
  return { candidates: merged, bins, grid };
}

/** The fast half: a palette of `n` colours from an analysis, with each colour's true share. */
export function paletteOf(x: Extraction, n: number): Swatch[] {
  n = Math.max(1, Math.min(MAX_COLORS, Math.round(n)));
  const picked = fill(choose(x.candidates, n), n);
  if (!picked.length) return [];
  // Each colour's share: the pixels nearer to it than to any other chosen colour.
  const share = new Float64Array(picked.length);
  let total = 0;
  for (const b of x.bins) {
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < picked.length; j++) {
      const d = dist2(b.lab, picked[j]!.lab);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    share[best] += b.count;
    total += b.count;
  }
  const placed: Array<{ x: number; y: number }> = [];
  const swatches: Swatch[] = picked.map((p, j) => {
    const at = p.derived ? null : locate(x.grid, p.lab, placed);
    if (at) placed.push(at);
    return { rgb: p.rgb, lab: p.lab, hex: hexOf(p.rgb), weight: total ? share[j]! / total : 1 / picked.length, at, derived: p.derived };
  });
  return order(swatches);
}

/**
 * The order a palette is shown in: the colours found, most of the photo first, then the tints and
 * shades made to fill it, light to dark.
 */
export function order(s: Swatch[]): Swatch[] {
  const found = s.filter((x) => !x.derived).sort((a, b) => b.weight - a.weight);
  const made = s.filter((x) => x.derived).sort((a, b) => b.lab[0] - a.lab[0]);
  return [...found, ...made];
}

/** One call: photo in, palette out. */
export function extractPalette(pic: Picture, n = 6, seed = 7): Swatch[] {
  return paletteOf(analyse(pic, seed), n);
}

// ---- stored form ----

/** A palette as a record keeps it: "#c2a38b #3d4a5c …", in the order shown. */
export const encodeColors = (hexes: string[]): string => hexes.map((h) => h.toLowerCase()).join(" ");

export function decodeColors(text: unknown): string[] {
  if (typeof text !== "string") return [];
  return text
    .split(/[\s,]+/)
    .map((t) => parseHex(t))
    .filter((x): x is RGB => x !== null)
    .map(hexOf);
}
