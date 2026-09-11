// What a launcher tile shows for an app (#82): its declared icon and accent when it has them, and
// otherwise an identity that cannot collide by accident — a monogram of the name plus a hue derived
// from the app's key, the same trick people get (`personHue` / `personInitials`).
//
// Six apps seeded with names starting in P used to be six beige squares with a P in them. The
// letters still carry the name; the colour is what tells two Ps apart. Never colour alone.

import { personHue, personInitials } from "@karta/runtime";

export interface TileIdentity {
  /** What goes in the avatar: the icon, or the monogram. */
  glyph: string;
  kind: "icon" | "monogram";
  /** A CSS colour: the declared accent, else one derived from the key. */
  accent: string;
  /** The derived hue, for callers that want to build their own colour from it. */
  hue: number;
}

export function tileIdentity(app: { key: string; name: string; icon?: string; accent?: string }): TileIdentity {
  const hue = personHue(app.key);
  const accent = app.accent?.trim() || `oklch(72% 0.13 ${hue})`;
  const icon = app.icon?.trim();
  if (icon) return { glyph: icon, kind: "icon", accent, hue };
  return { glyph: personInitials(app.name, app.key.replace(/^[a-z]+:/, "")), kind: "monogram", accent, hue };
}
