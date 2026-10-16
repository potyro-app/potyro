// A Metro tile is the app's own colour with white on it (owner, 2026-10-15), and white has to be
// readable on whatever colour an app declares: Plants says `#7FCF8E`, a pale green white text all but
// vanishes on (1.8:1). So the tile keeps the colour's hue and chroma and darkens it, in OKLCH, until
// white on it reaches WCAG AA for normal text (4.5:1) — the name on a tile is small text. A colour
// that already passes is used exactly as the app wrote it.
//
// The arithmetic is Björn Ottosson's OKLab, and WCAG 2's relative luminance. Pure, so it is tested
// in Node; parsing a colour name (`teal`) needs the browser and falls back to it only when present.

/** White on the tile must reach this. AA for normal text, with a hair of room for rounding. */
export const TILE_CONTRAST = 4.6;

export interface Oklch {
  l: number; // 0..1
  c: number;
  h: number; // degrees
}

type Rgb = readonly [number, number, number]; // sRGB, 0..1, gamma-encoded

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function rgbToOklch([r8, g8, b8]: Rgb): Oklch {
  const r = toLinear(r8);
  const g = toLinear(g8);
  const b = toLinear(b8);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const h = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c: Math.hypot(A, B), h };
}

/** Linear sRGB for an OKLCH colour; channels outside 0..1 mean it is outside the sRGB gamut. */
function oklchToLinear({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (rgb: Rgb): boolean => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** WCAG relative luminance of an OKLCH colour (clipped into sRGB). */
export function luminance(colour: Oklch): number {
  const [r, g, b] = oklchToLinear(colour).map((v) => Math.min(1, Math.max(0, v))) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast of white text on this colour. */
export function contrastWithWhite(colour: Oklch): number {
  return 1.05 / (luminance(colour) + 0.05);
}

/** The colour with chroma reduced just enough to sit inside sRGB at its lightness. */
function intoGamut(colour: Oklch): Oklch {
  if (inGamut(oklchToLinear(colour))) return colour;
  let lo = 0;
  let hi = colour.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear({ ...colour, c: mid }))) lo = mid;
    else hi = mid;
  }
  return { ...colour, c: lo };
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function parseHex(s: string): Rgb | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (!m) return null;
  let hex = m[1]!;
  if (hex.length === 3 || hex.length === 4) hex = [...hex.slice(0, 3)].map((c) => c + c).join("");
  if (hex.length !== 6 && hex.length !== 8) return null;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as Rgb;
}

const number = (part: string, scale: number): number => (part.endsWith("%") ? (parseFloat(part) / 100) * scale : parseFloat(part));
const parts = (inner: string): string[] => inner.replace(/\/.*$/, "").replace(/,/g, " ").trim().split(/\s+/);

function parseFunction(s: string): Oklch | null {
  const m = /^(rgba?|hsla?|oklch)\((.*)\)$/i.exec(s.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const kind = m[1]!.toLowerCase();
  const p = parts(m[2]!);
  if (p.length < 3 || p.slice(0, 3).some((x) => Number.isNaN(parseFloat(x)))) return null;
  if (kind === "oklch") return { l: clamp01(number(p[0]!, 1) > 1 ? number(p[0]!, 1) / 100 : number(p[0]!, 1)), c: Math.max(0, number(p[1]!, 0.4)), h: parseFloat(p[2]!) };
  if (kind.startsWith("rgb")) return rgbToOklch(p.slice(0, 3).map((x) => clamp01(number(x, 255) / 255)) as unknown as Rgb);
  // hsl
  const h = ((parseFloat(p[0]!) % 360) + 360) % 360;
  const sat = clamp01(number(p[1]!, 1));
  const light = clamp01(number(p[2]!, 1));
  const k = (n: number): number => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number): number => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return rgbToOklch([f(0), f(8), f(4)]);
}

/** A colour the browser knows by name (`teal`), as hex — only where there is a canvas to ask. */
function viaBrowser(s: string): Rgb | null {
  try {
    const ctx = globalThis.document?.createElement("canvas").getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000001";
    ctx.fillStyle = s;
    const out = String(ctx.fillStyle);
    return out === "#000001" ? null : parseHex(out);
  } catch {
    return null;
  }
}

/** Any CSS colour an app may write in `theme.accent`, as OKLCH; `null` when it is not one. */
export function parseColour(input: string): Oklch | null {
  const s = input.trim();
  if (!s) return null;
  const hex = parseHex(s);
  if (hex) return rgbToOklch(hex);
  const fn = parseFunction(s);
  if (fn) return fn;
  const named = viaBrowser(s);
  return named ? rgbToOklch(named) : null;
}

// Lightness rounded DOWN: rounding up could lift a colour that just passes back under the line.
const fmt = (c: Oklch): string => `oklch(${(Math.floor(c.l * 1000) / 10).toFixed(1)}% ${c.c.toFixed(3)} ${c.h.toFixed(1)})`;

/** The colour, darkened only as far as white on it needs to reach `TILE_CONTRAST`. */
export function readableOnWhite(colour: Oklch): Oklch {
  const start = intoGamut(colour);
  if (contrastWithWhite(start) >= TILE_CONTRAST) return start;
  let lo = 0;
  let hi = start.l;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (contrastWithWhite(intoGamut({ ...start, l: mid })) >= TILE_CONTRAST) lo = mid;
    else hi = mid;
  }
  return intoGamut({ ...start, l: lo });
}

/**
 * The tile's background for an app's colour: the colour itself when white reads on it, else the same
 * hue darkened until it does. `fallbackHue` is used when the colour cannot be read at all.
 */
export function tileBackground(accent: string | undefined, fallbackHue: number): string {
  const parsed = accent ? parseColour(accent) : null;
  if (parsed) {
    const fixed = readableOnWhite(parsed);
    return fixed === parsed || (Math.abs(fixed.l - parsed.l) < 1e-6 && Math.abs(fixed.c - parsed.c) < 1e-6) ? accent!.trim() : fmt(fixed);
  }
  return fmt(readableOnWhite({ l: 0.58, c: 0.13, h: fallbackHue }));
}
