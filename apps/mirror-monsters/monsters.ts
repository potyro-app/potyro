// The arithmetic of Mirror Monsters, in plain functions with tests: where the face-ish blob is, how a
// googly eye wobbles, where the camera moved, which colour a pixel becomes, what a snap is called.
// No canvas, no DOM — the app draws; this decides.

export const MODES = ["monster", "twin", "kaleido", "trails", "pixel"] as const;
export type Mode = (typeof MODES)[number];

/** The thumbnail every analysis reads: small enough to read every frame on a phone. */
export const THUMB_W = 64;
export const THUMB_H = 48;

/** A box in fractions of the frame (0..1), in the camera's own (unmirrored) coordinates. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Whether a pixel is skin-ish, by the classic YCbCr box (Chai & Ngan). It is not a face detector and
 * does not pretend to be: it finds the warm, mid-bright blob a face usually is, across skin tones,
 * well enough for a monster to sit on — and a monster that sits on a hand is part of the fun.
 */
export function isSkin(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 45 && y < 245 && cb >= 77 && cb <= 127 && cr >= 137 && cr <= 173;
}

/** Below this share of skin pixels there is no face to follow. */
export const MIN_SKIN = 0.025;

/**
 * The face-ish box in an RGBA thumbnail, or `null`. The densest column and row bands of skin, not the
 * mean of all of it: a bare arm at the edge of the frame should not drag the eyes off the face.
 */
export function findFace(data: ArrayLike<number>, w: number, h: number): Box | null {
  const cols = new Float32Array(w);
  const rows = new Float32Array(h);
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isSkin(data[i]!, data[i + 1]!, data[i + 2]!)) {
        cols[x]!++;
        rows[y]!++;
        total++;
      }
    }
  }
  if (total < MIN_SKIN * w * h) return null;
  const [x0, x1] = densestBand(cols, total);
  const [y0, y1] = densestBand(rows, total);
  return { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h };
}

/** The narrowest run of a histogram holding 70% of its mass around its peak. */
function densestBand(hist: Float32Array, total: number): [number, number] {
  let peak = 0;
  for (let i = 1; i < hist.length; i++) if (hist[i]! > hist[peak]!) peak = i;
  let lo = peak;
  let hi = peak;
  let mass = hist[peak]!;
  while (mass < total * 0.7 && (lo > 0 || hi < hist.length - 1)) {
    const left = lo > 0 ? hist[lo - 1]! : -1;
    const right = hi < hist.length - 1 ? hist[hi + 1]! : -1;
    if (left >= right) mass += hist[--lo]!;
    else mass += hist[++hi]!;
  }
  return [lo, hi];
}

/** Where a monster sits when there is no face: the middle, a face's size. */
export const RESTING: Box = { x: 0.32, y: 0.22, w: 0.36, h: 0.5 };

/**
 * One step of following: ease toward what was found (or back to rest), faster when the jump is
 * small, so the eyes stay steady on a still face and still catch up with a quick one.
 */
export function follow(prev: Box, found: Box | null, dt: number): Box {
  const target = found ?? RESTING;
  const rate = found ? 9 : 1.5;
  const k = 1 - Math.exp((-rate * Math.min(dt, 100)) / 1000);
  // A face is taller than it is wide; a blob that is not is clamped toward a face's shape.
  const w = Math.min(Math.max(target.w, 0.14), 0.8);
  const h = Math.min(Math.max(target.h, w * 0.9), w * 1.6);
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  const t: Box = { x: cx - w / 2, y: cy - h / 2, w, h };
  return {
    x: prev.x + (t.x - prev.x) * k,
    y: prev.y + (t.y - prev.y) * k,
    w: prev.w + (t.w - prev.w) * k,
    h: prev.h + (t.h - prev.h) * k,
  };
}

/** A googly eye's pupil: where it is in the eye (in eye radii) and how fast it moves. */
export interface Pupil {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** How far the pupil's centre may go from the eye's, in eye radii (eye minus pupil). */
export const PUPIL_ROOM = 0.52;

/**
 * One step of a googly eye. The pupil is a loose bead in a dish: gravity pulls it down, the face
 * moving shoves it the other way (the eye moves, the bead lags), and it bounces off the rim.
 * `shove` is the face's acceleration in eye radii per s².
 */
export function wobble(p: Pupil, shove: { x: number; y: number }, dt: number): Pupil {
  const s = Math.min(dt, 50) / 1000;
  const gravity = 9;
  const drag = 2.2;
  let vx = p.vx + (-shove.x - drag * p.vx) * s;
  let vy = p.vy + (gravity - shove.y - drag * p.vy) * s;
  let x = p.x + vx * s;
  let y = p.y + vy * s;
  const d = Math.hypot(x, y);
  if (d > PUPIL_ROOM) {
    // Back onto the rim, and the velocity reflected about it with a little lost to the knock.
    const nx = x / d;
    const ny = y / d;
    x = nx * PUPIL_ROOM;
    y = ny * PUPIL_ROOM;
    const dot = vx * nx + vy * ny;
    if (dot > 0) {
      vx -= 1.6 * dot * nx;
      vy -= 1.6 * dot * ny;
    }
  }
  return { x, y, vx, vy };
}

/**
 * The cells of a thumbnail where the picture moved: luminance changed by more than `threshold`.
 * `prev` and `cur` are one luminance byte per cell.
 */
export function motion(prev: Uint8Array, cur: Uint8Array, threshold = 28): number[] {
  const out: number[] = [];
  const n = Math.min(prev.length, cur.length);
  for (let i = 0; i < n; i++) if (Math.abs(cur[i]! - prev[i]!) > threshold) out.push(i);
  return out;
}

/** RGBA → one luminance byte per pixel. */
export function luma(data: ArrayLike<number>, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (data[i * 4]! * 77 + data[i * 4 + 1]! * 150 + data[i * 4 + 2]! * 29) >> 8;
  return out;
}

/** A spark of the trails: where (fractions), how it drifts, how long it has left (0..1), its hue. */
export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
}

export const MAX_SPARKS = 900;

/** New sparks where it moved (a few per moved cell, never past the cap), then everyone ages. */
export function sparkle(sparks: Spark[], moved: number[], w: number, h: number, dt: number, t: number, random: () => number): Spark[] {
  const s = Math.min(dt, 50) / 1000;
  const next: Spark[] = [];
  for (const k of sparks) {
    const life = k.life - s * 0.9;
    if (life > 0) next.push({ x: k.x + k.vx * s, y: k.y + k.vy * s, vx: k.vx * 0.96, vy: k.vy * 0.96 - 0.02 * s, life, hue: k.hue });
  }
  const room = MAX_SPARKS - next.length;
  const take = Math.min(room, moved.length);
  // Spread what fits evenly over the moved cells, rather than only the first rows of them.
  for (let j = 0; j < take; j++) {
    const cell = moved[Math.floor((j * moved.length) / take)]!;
    const cx = (cell % w) + random();
    const cy = Math.floor(cell / w) + random();
    const a = random() * Math.PI * 2;
    const speed = 0.02 + random() * 0.06;
    next.push({ x: cx / w, y: cy / h, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 0.03, life: 0.6 + random() * 0.4, hue: (t * 0.06 + cx * 4) % 360 });
  }
  return next;
}

/** The pixel monster's palette: a handheld console's, in a monster's colours. */
export const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [26, 16, 46],
  [86, 38, 110],
  [190, 64, 130],
  [255, 138, 101],
  [255, 214, 120],
  [56, 150, 80],
  [140, 230, 180],
  [250, 246, 236],
];

/** The palette colour nearest a pixel (by weighted distance, the eye's). */
export function nearest(r: number, g: number, b: number, palette = PALETTE): readonly [number, number, number] {
  let best = palette[0]!;
  let bestD = Infinity;
  for (const c of palette) {
    const dr = r - c[0];
    const dg = g - c[1];
    const db = b - c[2];
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Map an RGBA buffer onto the palette, in place. */
export function posterize(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const c = nearest(data[i]!, data[i + 1]!, data[i + 2]!);
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
  }
}

/** The part of a `vw`×`vh` frame that covers a `w`×`h` stage, centred (like CSS `object-fit: cover`). */
export function cover(vw: number, vh: number, w: number, h: number): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(w / vw, h / vh);
  const sw = w / scale;
  const sh = h / scale;
  return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh };
}

// ---- the kaleidoscope ----
//
// A real one: ONE triangular sample of the picture, reflected into every segment. Segment k of n
// covers the angles [k·a, (k+1)·a] (a = 2π/n); the even ones show the sample as it is, the odd ones
// its mirror image, so neighbours meet on a reflection line and the edges are seamless. n is even, or
// the last segment would meet the first unmirrored.

/** The mirror counts a tap cycles through. */
export const MIRRORS = [8, 10, 12] as const;
export type Mirrors = (typeof MIRRORS)[number];

/** The next mirror count after `n` (and back to the first). */
export const moreMirrors = (n: number): Mirrors => MIRRORS[(MIRRORS.indexOf(n as Mirrors) + 1) % MIRRORS.length]!;

/**
 * How segment `k` of `n` places the sample's wedge — the wedge lies between the angles 0 and a:
 * rotate by `angle`, then, when `flip`, mirror across the rotated x-axis. A mirrored wedge has to be
 * rotated to its segment's FAR edge: mirrored at its near edge it lands on the segment before it,
 * and every other segment stays empty (the black wedges a phone showed).
 */
export function segment(k: number, n: number): { angle: number; flip: boolean } {
  const a = (Math.PI * 2) / n;
  return k % 2 ? { angle: (k + 1) * a, flip: true } : { angle: k * a, flip: false };
}

/** Where `segment(k, n)` puts the wedge's angle `theta` (0..a) on the stage. */
export function placed(k: number, n: number, theta: number): number {
  const s = segment(k, n);
  return s.angle + (s.flip ? -theta : theta);
}

/** The piece of the camera's picture the kaleidoscope reflects: a circle's centre and radius, and how far it has turned (video pixels, radians). */
export interface Sample {
  cx: number;
  cy: number;
  radius: number;
  turn: number;
}

/**
 * The sample at time `t` (ms): around the face when there is one (`centre`, fractions of the frame)
 * or the middle, drifting in a slow figure and turning about once in 40 s, so it feels alive. The
 * whole circle stays inside the picture, so no turn of it ever shows the edge of the frame.
 */
export function sample(t: number, centre: { x: number; y: number } | null, vw: number, vh: number, still = false): Sample {
  const m = Math.min(vw, vh);
  const radius = m * 0.36;
  const drift = still ? 0 : m * 0.05;
  const x = (centre?.x ?? 0.5) * vw + Math.sin(t * 0.00031) * drift;
  const y = (centre?.y ?? 0.5) * vh + Math.sin(t * 0.00023 + 1) * drift;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return { cx: clamp(x, radius, vw - radius), cy: clamp(y, radius, vh - radius), radius, turn: still ? 0 : (t * 0.00016) % (Math.PI * 2) };
}

/** The file a snap is kept in: its mode and the moment, so two never collide. */
export function snapPath(mode: Mode, at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `snaps/${mode}-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}-${String(at.getMilliseconds()).padStart(3, "0")}.png`;
}

/** A small deterministic random, so a test can say what a seed does. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}
