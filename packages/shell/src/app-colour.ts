// An app's colour, on the clock of strokes (DESIGN.md §3.1, @potyro/design).
//
// Whatever an app declares — a hex, `oklch(…)` from the tile editor, a colour name — the system
// keeps only its ANGLE and derives every level itself: the traço for blocks, the tinta for text
// and links, the aguada for a selected row, the button pair. So a pale green an author wrote
// (`#7FCF8E`, white vanishes on it) still gives a button whose text reads, and the same hue
// in the dark gets the dark theme's own levels. Both themes' values go on the element as pairs;
// `.k-traco` in styles.css picks the theme's.
import { cor, hexToHue, varsBoth } from "@potyro/design";
import { parseColour } from "./tile-colour.js";

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const OKLCH = /^oklch\(\s*[\d.]+%?\s+[\d.]+\s+([\d.]+)/i;

/** The hue of any colour the shell is handed, or `undefined` if it is not a colour. */
export function hueOf(colour: string | undefined): number | undefined {
  if (!colour) return undefined;
  const s = colour.trim();
  const hex = HEX.exec(s);
  if (hex) {
    const h = hex[1]!;
    return hexToHue(h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`);
  }
  const ok = OKLCH.exec(s);
  if (ok) return Number(ok[1]);
  // A colour name needs the browser to parse it; `parseColour` knows when there is none.
  return parseColour(s)?.h;
}

/**
 * The custom properties for an element that wears this colour (`className="… k-traco"`): the
 * app's colour if it is one, else the hue the app is known by.
 */
export function tracoStyle(colour: string | undefined, fallbackHue: number): Record<string, string> {
  return varsBoth(cor(hueOf(colour) ?? fallbackHue));
}

/** The liveliest version of a hue — what a swatch shows. The same in both themes. */
export const tracoOf = (hue: number): string => cor(hue).light.traco;

/**
 * A Start tile's colours for a hue, both themes (`--tile-bg-l/-d`, `--tile-ink-l/-d`; `.k-metro` in
 * styles.css picks the theme's): the hour's button pair, `--accent` / `--on-accent` (DESIGN.md §3.1).
 * The traço with graphite where graphite reads on it at AA, else the tinta with white — so the small
 * words on a tile read at every angle. Only the tile's own tokens: inside it `--accent` stays Potyro's.
 */
export function tilePair(hue: number): Record<string, string> {
  const c = cor(hue);
  return {
    "--tile-bg-l": c.light.accent,
    "--tile-ink-l": c.light.onAccent,
    "--tile-bg-d": c.dark.accent,
    "--tile-ink-d": c.dark.onAccent,
  };
}
