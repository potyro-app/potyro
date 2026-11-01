// Any CSS colour an app may write in `theme.accent` (a hex, `rgb()`, `hsl()`, `oklch()`, a name),
// read as OKLCH. The shell keeps only its HUE: every level of an app's colour — a tile, a button, a
// link — comes from the colour clock (DESIGN.md §3.1, `app-colour.ts`), never from the colour as the
// app wrote it, and never adjusted by hand.
//
// The arithmetic is Björn Ottosson's OKLab. Pure, so it is tested in Node; parsing a colour name
// (`teal`) needs the browser and falls back to it only when present.

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
