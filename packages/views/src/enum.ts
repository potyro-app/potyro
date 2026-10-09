// What an enum value looks like, and which control asks for one (#98).
//
// A value's colour is the same wherever it appears — the form, the row badge, the record page —
// because it is derived from the value itself unless the field names one. Colour is never the only
// signal: the word is always there beside it.

import { personHue } from "@potyro/runtime";
import type { EnumColor, EnumField } from "potyro";

/** Above this many options a row of buttons stops fitting and stops being scannable. */
export const SEGMENTED_MAX = 5;

/** The named colours, as a hue on the same wheel people and tiles use. */
const HUES: Record<EnumColor, number> = {
  red: 25,
  orange: 55,
  yellow: 85,
  green: 145,
  teal: 175,
  blue: 235,
  purple: 295,
  pink: 340,
  grey: 0,
};

export interface Swatch {
  /** The inline custom property the stylesheet mixes into a tint; grey has none. */
  style?: { [key: string]: string };
}

/**
 * The tint for one value: the field's colour when it names one, else a hue derived from the value
 * so "pull" is the same colour in every app that has a "pull".
 */
export function enumSwatch(field: { colors?: Record<string, string> } | undefined, value: string): Swatch {
  const named = field?.colors?.[value];
  if (named === "grey") return {};
  const hue = named && named in HUES ? HUES[named as EnumColor] : personHue(value);
  return { style: { "--swatch": `oklch(72% 0.13 ${hue})` } };
}

/** A row of buttons, or a searchable picker? The field may say; otherwise the option count does. */
export function wantsSegmented(field: { options: string[]; control?: EnumField["control"] }): boolean {
  if (field.control) return field.control === "segmented";
  return field.options.length <= SEGMENTED_MAX;
}

/** Options whose name contains every word typed, in any order. */
export function filterOptions(options: readonly string[], query: string): string[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...options];
  return options.filter((o) => {
    const hay = o.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
