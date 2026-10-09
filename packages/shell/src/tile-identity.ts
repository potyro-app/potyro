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

import { personHue, personInitials } from "@potyro/runtime";

/** The twelve hues a tile can be, evenly spread — the same wheel `personHue` picks from. */
export const TILE_HUES: readonly number[] = [25, 55, 85, 115, 145, 175, 205, 235, 265, 295, 325, 355];

export interface TileIdentity {
  /** What goes in the avatar: the icon, or the monogram. */
  glyph: string;
  kind: "icon" | "monogram";
  /** A CSS colour: the user's hue, else the declared accent, else one derived from the key. */
  accent: string;
  /** The hue in use when the colour is a hue (derived or chosen); the derived one otherwise. */
  hue: number;
}

export const hueColour = (hue: number): string => `oklch(72% 0.13 ${hue})`;

export function tileIdentity(app: { key: string; name: string; icon?: string; accent?: string; hue?: number }): TileIdentity {
  const derived = personHue(app.key);
  const chosen = typeof app.hue === "number" ? app.hue : undefined;
  const hue = chosen ?? derived;
  const accent = chosen !== undefined ? hueColour(chosen) : app.accent?.trim() || hueColour(derived);
  const icon = app.icon?.trim();
  if (icon) return { glyph: icon, kind: "icon", accent, hue };
  return { glyph: personInitials(app.name, app.key.replace(/^[a-z]+:/, "")), kind: "monogram", accent, hue };
}
