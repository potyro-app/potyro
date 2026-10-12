// The garden's arithmetic: how a photo becomes colours, how many specks a screen can afford, where
// each speck lives and how it moves, and what to call the result. No DOM and no p5 here — the sketch
// in photo-garden.app.ts draws what these functions decide, and the tests run them in Node.

export type Style = "flow" | "points" | "mosaic";
export const STYLES: Style[] = ["flow", "points", "mosaic"];
export const STYLE_LABEL: Record<Style, string> = { flow: "Flow", points: "Points", mosaic: "Mosaic" };

/** A small RGBA picture: the photo, shrunk to the few hundred pixels the specks sample. */
export interface Source {
  w: number;
  h: number;
  data: Uint8ClampedArray | number[];
}

export type RGB = [number, number, number];

/** A seeded random in [0, 1): the same seed grows the same garden, which tests can rely on. */
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

/**
 * The part of a `sw`×`sh` photo that covers a `dw`×`dh` stage, centred: what is cropped, never what
 * is squashed. Used to shrink the photo to the stage's shape before sampling it.
 */
export function coverCrop(sw: number, sh: number, dw: number, dh: number): { x: number; y: number; w: number; h: number } {
  const want = dw / dh;
  if (sw / sh > want) {
    const w = sh * want;
    return { x: (sw - w) / 2, y: 0, w, h: sh };
  }
  const h = sw / want;
  return { x: 0, y: (sh - h) / 2, w: sw, h };
}

/** The size to shrink the cropped photo to: `long` pixels on its longer side, the stage's shape. */
export function sampleSize(dw: number, dh: number, long = 180): { w: number; h: number } {
  return dw >= dh ? { w: long, h: Math.max(1, Math.round((long * dh) / dw)) } : { w: Math.max(1, Math.round((long * dw) / dh)), h: long };
}

/** The colour at (u, v) in [0, 1]², nearest pixel. */
export function colorAt(src: Source, u: number, v: number): RGB {
  const x = Math.min(src.w - 1, Math.max(0, Math.floor(u * src.w)));
  const y = Math.min(src.h - 1, Math.max(0, Math.floor(v * src.h)));
  const i = (y * src.w + x) * 4;
  return [src.data[i]!, src.data[i + 1]!, src.data[i + 2]!];
}

/** Perceived lightness, 0–1. */
export const lightness = ([r, g, b]: RGB): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * The picture shown before there is a photo: a dusk sky over a hill, painted from a formula. It keeps
 * the stage alive and shows what the garden does before anyone has chosen anything.
 */
export function dusk(w = 120, h = 160): Source {
  const data = new Uint8ClampedArray(w * h * 4);
  const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const sky: RGB[] = [[46, 42, 110], [173, 82, 140], [247, 160, 98], [255, 214, 150]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = y / (h - 1);
      const u = x / (w - 1);
      const k = Math.min(0.999, v * 1.25) * (sky.length - 1);
      let c = mix(sky[Math.floor(k)]!, sky[Math.floor(k) + 1]!, k - Math.floor(k));
      // the sun, low on the left
      const sun = Math.hypot(u - 0.32, v - 0.6);
      if (sun < 0.13) c = mix(c, [255, 236, 190], Math.min(1, (0.13 - sun) * 14));
      // a dark hill with a gentle ridge
      const ridge = 0.7 + 0.06 * Math.sin(u * 5.2 + 0.8) + 0.03 * Math.sin(u * 13);
      if (v > ridge) c = mix([40, 64, 72], [18, 30, 40], Math.min(1, (v - ridge) * 3));
      const i = (y * w + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return { w, h, data };
}

// ---- how many specks ----

/** Fewest and most specks at the two ends of the density slider (0–100), for a stage of this size. */
export function particleBudget(width: number, height: number, phone: boolean): { min: number; max: number } {
  const area = width * height;
  // About one speck per 70 px² is dense enough to read a face; a phone stops at 2,800 so a mid-range
  // one keeps 60 fps, a desktop at 7,000.
  const cap = phone ? 2800 : 7000;
  const max = Math.round(Math.min(cap, Math.max(600, area / 70)));
  return { min: Math.round(max * 0.18), max };
}

export function particleCount(width: number, height: number, density: number, phone: boolean): number {
  const { min, max } = particleBudget(width, height, phone);
  const t = Math.min(100, Math.max(0, density)) / 100;
  return Math.round(min + (max - min) * t);
}

/** Mosaic tiles across the stage's shorter side, by density: 14 coarse to 46 fine. */
export function mosaicCells(width: number, height: number, density: number): { cols: number; rows: number; size: number } {
  const across = Math.round(14 + (46 - 14) * (Math.min(100, Math.max(0, density)) / 100));
  const size = Math.min(width, height) / across;
  return { cols: Math.ceil(width / size), rows: Math.ceil(height / size), size };
}

// ---- the specks ----

/** Struct-of-arrays: thousands of specks without thousands of objects for the collector to chase. */
export interface Specks {
  n: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  hx: Float32Array; // home: where in the picture it belongs
  hy: Float32Array;
  size: Float32Array;
  rgb: Uint8Array; // 3 per speck
  fill: string[]; // the colour as CSS, made once
}

const cssOf = (r: number, g: number, b: number) => `rgb(${r},${g},${b})`;

/**
 * Specks for a style. Flow and points scatter homes over the stage (points on a jittered grid, so the
 * dots tile evenly); mosaic puts one per tile. Each takes its colour from the picture at its home.
 * Start positions are random: switching a style or a photo makes the specks gather into it.
 */
export function makeSpecks(style: Style, src: Source, width: number, height: number, density: number, phone: boolean, random: () => number): Specks {
  let homes: Array<[number, number]> = [];
  let sizes: number[] = [];
  if (style === "mosaic") {
    const { cols, rows, size } = mosaicCells(width, height, density);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) homes.push([(c + 0.5) * size, (r + 0.5) * size]);
    sizes = homes.map(() => size);
  } else {
    // Flow strokes are thin, so it takes more of them to read a picture; still within the cap.
    const n = style === "flow" ? Math.min(particleBudget(width, height, phone).max, Math.round(particleCount(width, height, density, phone) * 1.6)) : particleCount(width, height, density, phone);
    if (style === "points") {
      const step = Math.sqrt((width * height) / n);
      for (let y = step / 2; y < height; y += step) for (let x = step / 2; x < width; x += step) homes.push([x + (random() - 0.5) * step * 0.7, y + (random() - 0.5) * step * 0.7]);
      sizes = homes.map(() => step);
    } else {
      for (let i = 0; i < n; i++) homes.push([random() * width, random() * height]);
      sizes = homes.map(() => 2.2 + random() * 1.6);
    }
  }
  const n = homes.length;
  const s: Specks = {
    n,
    x: new Float32Array(n),
    y: new Float32Array(n),
    vx: new Float32Array(n),
    vy: new Float32Array(n),
    hx: new Float32Array(n),
    hy: new Float32Array(n),
    size: new Float32Array(n),
    rgb: new Uint8Array(n * 3),
    fill: new Array<string>(n),
  };
  for (let i = 0; i < n; i++) {
    const [hx, hy] = homes[i]!;
    s.hx[i] = hx;
    s.hy[i] = hy;
    s.x[i] = random() * width;
    s.y[i] = random() * height;
    s.size[i] = sizes[i]!;
    const [r, g, b] = colorAt(src, hx / width, hy / height);
    s.rgb.set([r, g, b], i * 3);
    s.fill[i] = cssOf(r, g, b);
  }
  return s;
}

/** Recolour specks from a new picture without moving them: a new photo flows into the old shapes. */
export function recolor(s: Specks, src: Source, width: number, height: number): void {
  for (let i = 0; i < s.n; i++) {
    const [r, g, b] = colorAt(src, s.hx[i]! / width, s.hy[i]! / height);
    s.rgb.set([r, g, b], i * 3);
    s.fill[i] = cssOf(r, g, b);
  }
}

export interface Touch {
  x: number;
  y: number;
  /** 0 when nobody is touching; a hovering mouse is gentle, a press or a finger is strong. */
  strength: number;
  radius: number;
}

export interface Motion {
  /** How hard a speck is pulled home, per frame. Grows from 0 as a new picture gathers. */
  spring: number;
  /** How hard the noise field pushes. */
  flow: number;
  /** Velocity kept per frame. */
  damping: number;
  /** How hard a touch shoves, per frame. Tiles are heavy, specks are light. */
  push: number;
}

export const MOTION: Record<Style, Motion> = {
  flow: { spring: 0.026, flow: 0.38, damping: 0.88, push: 9 },
  points: { spring: 0.06, flow: 0.08, damping: 0.8, push: 6 },
  mosaic: { spring: 0.1, flow: 0, damping: 0.72, push: 2.6 },
};

/**
 * One frame for every speck: the field's push (an angle per position, from `field`), the pull home,
 * and the push away from a touch. `gather` (0–1) eases the pull in after a new picture.
 */
export function step(s: Specks, m: Motion, gather: number, field: (x: number, y: number) => number, touch: Touch): void {
  const spring = m.spring * gather;
  const r2 = touch.radius * touch.radius;
  for (let i = 0; i < s.n; i++) {
    let vx = s.vx[i]!;
    let vy = s.vy[i]!;
    const x = s.x[i]!;
    const y = s.y[i]!;
    if (m.flow) {
      const a = field(x, y);
      vx += Math.cos(a) * m.flow;
      vy += Math.sin(a) * m.flow;
    }
    vx += (s.hx[i]! - x) * spring;
    vy += (s.hy[i]! - y) * spring;
    if (touch.strength > 0) {
      const dx = x - touch.x;
      const dy = y - touch.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2 && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const push = (1 - d / touch.radius) * touch.strength * m.push;
        vx += (dx / d) * push;
        vy += (dy / d) * push;
      }
    }
    vx *= m.damping;
    vy *= m.damping;
    s.vx[i] = vx;
    s.vy[i] = vy;
    s.x[i] = x + vx;
    s.y[i] = y + vy;
  }
}

/** How far a speck is from home, in tile sizes, clamped to 0–1: how much a mosaic tile turns and shrinks. */
export function unsettled(s: Specks, i: number): number {
  const d = Math.hypot(s.x[i]! - s.hx[i]!, s.y[i]! - s.hy[i]!);
  return Math.min(1, d / (s.size[i]! * 1.5));
}

// ---- a name for what you kept ----

const HUES: Array<[number, string]> = [
  [15, "Ember"],
  [40, "Amber"],
  [65, "Honey"],
  [100, "Moss"],
  [160, "Fern"],
  [200, "Tide"],
  [245, "Dusk"],
  [290, "Plum"],
  [350, "Rose"],
  [360, "Ember"],
];

/** Hue (0–360), saturation and lightness (0–1) of one colour. */
function hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

/**
 * The picture's main colour, as a word: Rose, Fern, Tide… Each pixel votes for its hue by how vivid
 * it is, so a green photo with a pink flower is Fern, not the muddy yellow its average would be. A
 * picture with little colour is Ink, Stone or Pearl, by how light it is.
 */
export function colorName(src: Source): string {
  const votes = new Map<string, number>();
  let vivid = 0;
  let light = 0;
  const n = src.w * src.h;
  for (let i = 0; i < n; i++) {
    const [h, s, l] = hsl(src.data[i * 4]!, src.data[i * 4 + 1]!, src.data[i * 4 + 2]!);
    light += l;
    if (s < 0.15 || l < 0.1 || l > 0.94) continue;
    const name = HUES.find(([upTo]) => h < upTo)![1];
    votes.set(name, (votes.get(name) ?? 0) + s);
    vivid += s;
  }
  if (vivid < n * 0.08) {
    const l = light / n;
    return l < 0.3 ? "Ink" : l > 0.75 ? "Pearl" : "Stone";
  }
  return [...votes].sort((a, b) => b[1] - a[1])[0]![0];
}

const NOUN: Record<Style, string> = { flow: "Drift", points: "Bloom", mosaic: "Tessera" };

/** "Amber Drift", or "Amber Drift II" when that name is taken. */
export function titleFor(src: Source, style: Style, taken: readonly string[] = []): string {
  const base = `${colorName(src)} ${NOUN[style]}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  const roman = ["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  for (const r of roman) if (!used.has(`${base} ${r}`)) return `${base} ${r}`;
  return `${base} ${used.size + 1}`;
}

/** `garden/2026-10-12-1530-amber-drift.png` — sortable, readable, no characters a file system minds. */
export function snapshotPath(title: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `garden/${stamp}-${slug || "garden"}.png`;
}
