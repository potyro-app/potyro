// The clock of strokes ("o relógio de traços", DESIGN.md §3.1): every Potyro colour is only an
// ANGLE — an OKLCH hue, 0–360. Lightness and chroma are the system's, computed here, so every
// generated colour passes its contrast without a table of exceptions.
//
// A faithful TypeScript port of the designer's `source/potyro-color.js`, which stays the reference:
// test/color.test.ts proves this port produces the twelve hours exactly as `source/potyro-tokens.css`
// has them. The parameters live in `P` and change nowhere else; a colour is never adjusted by hand.
//
// Each hue has three levels, named after a pen (the fountain pen in the "y"'s negative space):
//   traço   the liveliest version: blocks, illustration, the "y", bars. Small text never sits on it.
//   tinta   the version that reads as text: links, active icons, big numbers, the focus ring.
//   aguada  the washed version: a selected chip or row, a light banner. Text on it is `--ink`.
// and a button pair: the traço with dark text when that passes, else the tinta with white.

export type Theme = "light" | "dark";

export interface Hour {
  /** 1–12 on the clock. 12 is Potyro's own pink, never an app's and never a category. */
  hora: number;
  nome: string;
  hue: number;
}

export interface Levels {
  traco: string;
  tinta: string;
  aguada: string;
  accent: string;
  onAccent: string;
}

export interface Cor {
  hue: number;
  /** The nearest hour on the clock. */
  hora: number;
  light: Levels;
  dark: Levels;
}

/** The system's parameters. They change here, never in a colour. */
export const P = {
  light: { bg: "#ffffff", surface: "#f3f3f4", ink: "#231f20" },
  dark: { bg: "#1c1b1c", surface: "#2a2829", ink: "#1c1b1c" },
  /** Traço: the liveliest lightness of the hue, held in this band. */
  traco: { minL: 0.62, maxL: 0.8, chroma: 0.88, maxC: 0.19 },
  /** Tinta: the least contrast it may have as text. */
  tinta: { onBg: 5.0, onSurface: 4.6, chroma: 0.9, maxC: 0.2 },
  /** Aguada: a tinted background. */
  aguada: { light: { L: 0.955, C: 0.032 }, dark: { L: 0.3, C: 0.055 } },
  /** A button is the traço with dark text when the dark text reaches this on it. */
  tracoComTextoEscuro: 4.5,
} as const;

export const HORAS: readonly Hour[] = [
  { hora: 12, nome: "rosa", hue: 0 },
  { hora: 1, nome: "vermelho", hue: 30 },
  { hora: 2, nome: "laranja", hue: 60 },
  { hora: 3, nome: "amarelo", hue: 90 },
  { hora: 4, nome: "lima", hue: 120 },
  { hora: 5, nome: "verde", hue: 150 },
  { hora: 6, nome: "menta", hue: 180 },
  { hora: 7, nome: "ciano", hue: 210 },
  { hora: 8, nome: "azul", hue: 240 },
  { hora: 9, nome: "anil", hue: 270 },
  { hora: 10, nome: "roxo", hue: 300 },
  { hora: 11, nome: "magenta", hue: 330 },
];

// ── OKLCH ↔ sRGB (Björn Ottosson) ──────────────────────────────────────────────────────────────
const toLin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklchToLinRgb(L: number, C: number, H: number): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = (rgb: readonly number[]): boolean => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

function maxChroma(L: number, H: number): number {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinRgb(L, mid, H))) lo = mid;
    else hi = mid;
  }
  return lo;
}

function hex(L: number, C: number, H: number): string {
  return (
    "#" +
    oklchToLinRgb(L, C, H)
      .map((c) =>
        Math.round(Math.min(1, Math.max(0, toGam(Math.min(1, Math.max(0, c))))) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function luminance(h: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => toLin(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast between two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The OKLCH hue of a `#rrggbb` colour: the only thing the system keeps of a colour it is handed. */
export function hexToHue(h: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => toLin(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
}

// ── The three levels ───────────────────────────────────────────────────────────────────────────
/** Traço: the lightness where the hue is liveliest (its cusp), held in the system's band. */
function traco(H: number): string {
  let best: [number, number] = [0.62, 0];
  for (let L = 0.4; L <= 0.98; L += 0.005) {
    const c = maxChroma(L, H);
    if (c > best[1]) best = [L, c];
  }
  const L = Math.min(P.traco.maxL, Math.max(P.traco.minL, best[0]));
  return hex(L, Math.min(P.traco.maxC, maxChroma(L, H) * P.traco.chroma), H);
}

/** Tinta: the lightest (light theme) or darkest (dark theme) colour that still passes as text. */
function tinta(H: number, theme: Theme): string {
  const t = P[theme];
  const dir = theme === "light" ? -1 : 1;
  for (let i = 0; i <= 200; i++) {
    const L = theme === "light" ? 0.8 + dir * i * 0.0025 : 0.74 + dir * i * 0.0025;
    const h = hex(L, Math.min(P.tinta.maxC, maxChroma(L, H) * P.tinta.chroma), H);
    if (contrast(h, t.bg) >= P.tinta.onBg && contrast(h, t.surface) >= P.tinta.onSurface) return h;
  }
  return theme === "light" ? t.ink : "#f3f3f4";
}

function aguada(H: number, theme: Theme): string {
  const a = P.aguada[theme];
  return hex(a.L, Math.min(a.C, maxChroma(a.L, H)), H);
}

// ── A whole colour from an angle, an hour's name or number, or a hex ───────────────────────────
export type HueInput = number | string;

/** The hue of an angle (any number, wrapped), a `#hex` (its hue only) or an hour's name or number. */
export function resolveHue(x: HueInput): number {
  if (typeof x === "number") return ((x % 360) + 360) % 360;
  if (x.startsWith("#")) return hexToHue(x);
  const h = HORAS.find((h) => h.nome === x || String(h.hora) === x);
  if (!h) throw new Error(`Cor desconhecida: "${x}". Use um ângulo (0–360), um hex ou um nome de hora.`);
  return h.hue;
}

export function horaMaisProxima(H: number): number {
  let best = HORAS[0]!;
  let d = 999;
  for (const h of HORAS) {
    const dd = Math.min(Math.abs(h.hue - H), 360 - Math.abs(h.hue - H));
    if (dd < d) {
      d = dd;
      best = h;
    }
  }
  return best.hora;
}

/** Every level of a hue, for both themes. */
export function cor(x: HueInput): Cor {
  const H = resolveHue(x);
  const T = traco(H);
  const lt = tinta(H, "light");
  const dt = tinta(H, "dark");
  const claroComEscuro = contrast(T, P.light.ink) >= P.tracoComTextoEscuro;
  const escuroComEscuro = contrast(T, P.dark.ink) >= P.tracoComTextoEscuro;
  return {
    hue: Math.round(H * 10) / 10,
    hora: horaMaisProxima(H),
    light: {
      traco: T,
      tinta: lt,
      aguada: aguada(H, "light"),
      accent: claroComEscuro ? T : lt,
      onAccent: claroComEscuro ? P.light.ink : "#ffffff",
    },
    dark: {
      traco: T,
      tinta: dt,
      aguada: aguada(H, "dark"),
      accent: escuroComEscuro ? T : dt,
      onAccent: P.dark.ink,
    },
  };
}

/**
 * Category colours (DESIGN.md §3.1): the app's own hour first, then five hours on each time, never
 * 12 o'clock. Five is the most that stay apart; the sixth onwards is grey, "Others".
 */
export function categorias(x: HueInput, n: number): string[] {
  const start = horaMaisProxima(resolveHue(x)) % 12;
  const out: string[] = [];
  for (let k = 0; out.length < n && k < 24; k++) {
    const h = (start + 5 * k) % 12;
    if (h === 0) continue;
    const hh = HORAS.find((o) => o.hora % 12 === h)!;
    if (!out.includes(hh.nome)) out.push(hh.nome);
  }
  return out;
}

/** The CSS custom properties of a colour, for one theme — what `[data-traco]` in tokens.css sets. */
export function vars(c: Cor, theme: Theme): Record<string, string> {
  const t = c[theme];
  return {
    "--hue": String(c.hue),
    "--traco": t.traco,
    "--tinta": t.tinta,
    "--aguada": t.aguada,
    "--accent": t.accent,
    "--on-accent": t.onAccent,
    "--focus": t.tinta,
  };
}

/**
 * The same, for BOTH themes at once, as `-l` / `-d` pairs: an element carrying these follows the
 * theme in CSS (`.k-traco` in the shell's stylesheet picks the pair), so a system theme that
 * flips at dusk needs no JavaScript to re-run. The traço is the same in both.
 */
export function varsBoth(c: Cor): Record<string, string> {
  return {
    "--hue": String(c.hue),
    "--traco": c.light.traco,
    "--tinta-l": c.light.tinta,
    "--tinta-d": c.dark.tinta,
    "--aguada-l": c.light.aguada,
    "--aguada-d": c.dark.aguada,
    "--accent-l": c.light.accent,
    "--accent-d": c.dark.accent,
    "--on-accent-l": c.light.onAccent,
    "--on-accent-d": c.dark.onAccent,
  };
}

/** Sets a colour on an element (normally `<html>`), for the theme in force right now. */
export function apply(el: HTMLElement, x: HueInput): Cor {
  const c = cor(x);
  const theme = el.getAttribute("data-theme");
  const dark =
    theme === "dark" ||
    (theme !== "light" && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);
  const v = vars(c, dark ? "dark" : "light");
  for (const k in v) el.style.setProperty(k, v[k]!);
  return c;
}

/** The designer's API, under the name DESIGN.md uses. */
export const PotyroColor = { P, HORAS, cor, categorias, apply, vars, varsBoth, contrast, hexToHue, horaMaisProxima, resolveHue };
