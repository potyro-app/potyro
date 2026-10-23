// What leads a record wherever it is listed: its photo, or — with no photo — a tinted initial or the
// entity's icon. Every built-in that lists records (list rows, gallery cards, the record page's hero)
// draws the same lead, so a record looks like itself everywhere.
//
// The colour is the record's own, never decoration: its first coloured badge's (an enum option wears
// the same colour in the form, the row and the record page, #98), else one derived from its text, so
// "Fern" is the same green in every list it appears in. The letter is always there beside the colour.

import { personHue } from "@potyro/runtime";
import type { EntityDef, Field } from "potyro";
import type { Badge } from "./types.js";
import { enumSwatch } from "./enum.js";
import { Glyph } from "./glyph.js";

export type LeadKind = "monogram" | "icon" | "none";

/** The entity's first photo field: the picture a record is shown by when the page names none. */
export function firstPhotoField(entity: Pick<EntityDef, "fields"> | undefined): string | undefined {
  if (!entity) return undefined;
  for (const [key, field] of Object.entries(entity.fields) as [string, Field][]) {
    if (field.type === "media" && (field.accept ?? "image") === "image") return key;
  }
  return undefined;
}

/**
 * The media field a page shows a record by: the one it names, else the entity's first photo field.
 * `false` (a detail page that wants no picture) is none.
 */
export function mediaFieldFor(named: string | false | undefined, entity: Pick<EntityDef, "fields"> | undefined): string | undefined {
  if (named === false) return undefined;
  return named ?? firstPhotoField(entity);
}

/** The first letter a person would read — a whole emoji or accented letter, never half of one. */
export function initialOf(text: string | undefined): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "·";
  const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) {
    for (const s of new Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)) return s.segment.toLocaleUpperCase();
  }
  return (Array.from(trimmed)[0] ?? "·").toLocaleUpperCase();
}

/** The `--swatch` a record's lead wears: its first coloured badge's, else a hue from its text. */
export function leadSwatch(badges: readonly Badge[] | undefined, text: string | undefined): { [key: string]: string } {
  const coloured = badges?.find((b) => b.field);
  if (coloured) {
    const style = enumSwatch(coloured.field, coloured.text).style;
    if (style) return style;
  }
  return { "--swatch": `oklch(72% 0.13 ${personHue(text ?? "")})` };
}

export interface LeadProps {
  /** The record's picture, when it has one. */
  url?: string;
  /** The words the initial is taken from. */
  text?: string;
  badges?: readonly Badge[];
  kind?: LeadKind;
  /** The entity's icon, for `kind: "icon"`. */
  icon?: string;
  className?: string;
  size?: number;
}

/** A record's lead: picture, initial or icon. Decorative — the row's words say what it is. */
export function Lead({ url, text, badges, kind = "monogram", icon, className = "k-lead", size = 44 }: LeadProps) {
  if (url) return <img className={`${className} k-lead-photo`} src={url} alt="" width={size} height={size} loading="lazy" decoding="async" draggable={false} />;
  if (kind === "none") return null;
  const initial = initialOf(text);
  // The icon in the system's stroke at half the lead's box (22 in a 44 lead), the initial behind a
  // name Lucide has not.
  const glyph = kind === "icon" && icon ? <Glyph icon={icon} size={Math.round(size / 2)} fallback={initial} /> : initial;
  return (
    <span className={className} data-glyph={kind === "icon" && icon ? "icon" : "initial"} style={leadSwatch(badges, text)} aria-hidden>
      {glyph}
    </span>
  );
}
