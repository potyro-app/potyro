// An app's icon strings (AppDefinition, EntityDef, Page, the actions, a UiItem): a Lucide icon's
// name (#425, DESIGN.md §3.5) — or, from before, one emoji or short glyph, which keeps working.
// The shell draws a name as the icon in the system's stroke, and a glyph as the character it is.

/** The shape of a Lucide name: kebab-case ASCII, as on lucide.dev ("map-pin", "gamepad-2"). */
export const LUCIDE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The longest a Lucide name gets ("message-circle-question-mark" is 28); a glyph is far shorter. */
export const ICON_MAX = 48;

/** The most UTF-16 units an emoji/glyph icon may be: one character with its modifiers. */
export const GLYPH_MAX = 8;

/** Whether a string is the shape of a Lucide icon name (not whether that icon exists). */
export function isLucideName(s: string | undefined | null): s is string {
  return typeof s === "string" && s.length >= 2 && s.length <= ICON_MAX && LUCIDE_NAME.test(s);
}

/** Whether a string may be an icon: a Lucide name, or one emoji/glyph. */
export function isIcon(s: string): boolean {
  return s.length >= 1 && (s.length <= GLYPH_MAX || isLucideName(s));
}
