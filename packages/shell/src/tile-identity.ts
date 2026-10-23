// What a launcher tile shows for an app (#82): its declared icon and accent when it has them, and
// otherwise an identity that cannot collide by accident — a monogram of the name plus a hue derived
// from the app's key, the same trick people get (`personHue` / `personInitials`).
//
// Six apps seeded with names starting in P used to be six beige squares with a P in them. The
// letters still carry the name; the colour is what tells two Ps apart. Never colour alone.
//
// The person using the app may want something else on the tile than the author chose (#83): a
// nickname, an emoji that means something to them, a colour. Those come in already merged into
// `name` / `icon` (the launcher store does that), and `hue` is their colour, which wins over the
// declared accent — it is their device.

import { isLucideName, lucideKnown } from "@potyro/design";
import { personHue, personInitials } from "@potyro/runtime";
import { isImagePath } from "potyro";

/** The twelve hues a tile can be, evenly spread — the same wheel `personHue` picks from. */
export const TILE_HUES: readonly number[] = [25, 55, 85, 115, 145, 175, 205, 235, 265, 295, 325, 355];

export interface TileIdentity {
  /** What goes in the avatar: the icon (a Lucide name or an emoji — draw it with `TileGlyph`), or the monogram. */
  glyph: string;
  kind: "icon" | "monogram";
  /** The monogram, whichever kind: what an icon Lucide turns out not to have falls back to. */
  monogram: string;
  /** A CSS colour: the user's hue, else the declared accent, else one derived from the key. */
  accent: string;
  /** The hue in use when the colour is a hue (derived or chosen); the derived one otherwise. */
  hue: number;
}

export const hueColour = (hue: number): string => `oklch(72% 0.13 ${hue})`;

export function tileIdentity(app: { key: string; name: string; icon?: string; image?: string; accent?: string; hue?: number }): TileIdentity {
  const derived = personHue(app.key);
  const chosen = typeof app.hue === "number" ? app.hue : undefined;
  const hue = chosen ?? derived;
  const accent = chosen !== undefined ? hueColour(chosen) : app.accent?.trim() || hueColour(derived);
  const icon = app.icon?.trim();
  const monogram = personInitials(app.name, app.key.replace(/^[a-z]+:/, ""));
  // A picture the app ships (`icon: "icon.svg"`, #425) is on the tile once it has been read into
  // `image` (the app opened once); until then, the monogram — never the path as text.
  if (isImagePath(icon)) return app.image ? { glyph: app.image, kind: "icon", monogram, accent, hue } : { glyph: monogram, kind: "monogram", monogram, accent, hue };
  // A Lucide name the paths turn out not to have is no icon at all: the monogram, not the name as text.
  if (icon && (!isLucideName(icon) || lucideKnown(icon))) return { glyph: icon, kind: "icon", monogram, accent, hue };
  return { glyph: monogram, kind: "monogram", monogram, accent, hue };
}
