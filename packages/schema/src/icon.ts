// An app's icon strings (AppDefinition, EntityDef, Page, the actions, a UiItem, a record's
// `display.icon`): a Lucide icon's name (#425, DESIGN.md §3.5), a picture, or — from before — one
// emoji or short glyph, which keeps working. The shell draws a name in the system's stroke, a
// picture as it is, a glyph as the character it is.
//
// A picture is one of: a file the app ships (`"icon.svg"`, `"art/logo.png"` — a path in its own
// folder), an inline `<svg>…</svg>` string, or a `data:image/…` URL. The last two live in the
// source itself, which is what a generated app can carry without a file. A picture is only ever
// shown through <img> (or drawn on a canvas), never inserted as markup: nothing in it runs, sealed
// or not.

/** The shape of a Lucide name: kebab-case ASCII, as on lucide.dev ("map-pin", "gamepad-2"). */
export const LUCIDE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The longest a Lucide name gets ("message-circle-question-mark" is 28); a glyph is far shorter. */
export const ICON_MAX = 48;

/** The most UTF-16 units an emoji/glyph icon may be: one character with its modifiers. */
export const GLYPH_MAX = 8;

/** The most an inline picture (`<svg>` or `data:` URL) may be: an icon, not an illustration. */
export const ICON_IMAGE_MAX = 64 * 1024;

/** A shipped image file's path: relative, no scheme, no `..`, an image extension. */
const IMAGE_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))[\w .()@-]+(?:\/[\w .()@-]+)*\.(?:svg|png|jpe?g|webp|gif|avif)$/i;
const DATA_IMAGE = /^data:image\/(?:svg\+xml|png|jpeg|webp|gif|avif)[;,]/i;
const INLINE_SVG = /^\s*<svg[\s>]/i;

export type IconKind = "lucide" | "image" | "glyph";

/** Whether a string is the shape of a Lucide icon name (not whether that icon exists). */
export function isLucideName(s: string | undefined | null): s is string {
  return typeof s === "string" && s.length >= 2 && s.length <= ICON_MAX && LUCIDE_NAME.test(s);
}

/** Whether a string is a picture: a shipped file's path, an inline `<svg>`, or a `data:image` URL. */
export function isImageIcon(s: string | undefined | null): s is string {
  if (typeof s !== "string" || !s || s.length > ICON_IMAGE_MAX) return false;
  return DATA_IMAGE.test(s) || INLINE_SVG.test(s) || (s.length <= 200 && IMAGE_PATH.test(s));
}

/** A picture that needs the app's files to be shown (a path), as opposed to one carried in the string. */
export function isImagePath(s: string | undefined | null): boolean {
  return typeof s === "string" && s.length <= 200 && IMAGE_PATH.test(s);
}

/** What kind of icon a string is; a glyph when it is neither a name nor a picture. */
export function iconKind(s: string): IconKind {
  if (isLucideName(s)) return "lucide";
  if (isImageIcon(s)) return "image";
  return "glyph";
}

/** Whether a string may be an icon: a Lucide name, a picture, or one emoji/glyph. */
export function isIcon(s: string): boolean {
  return s.length >= 1 && (s.length <= GLYPH_MAX || isLucideName(s) || isImageIcon(s));
}
