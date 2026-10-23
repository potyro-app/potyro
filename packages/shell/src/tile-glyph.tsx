// What goes inside an app's tile, splash or mark: its icon drawn the system's way when it names a
// Lucide icon (#425), the character when it is an emoji, the monogram when it has none — one
// element for every place that shows a `TileIdentity`, so the app is the same mark everywhere.

import { Glyph } from "@potyro/views";
import type { ReactNode } from "react";
import type { TileIdentity } from "./tile-identity.js";

export function TileGlyph({ identity, size = 36 }: { identity: TileIdentity; size?: number }): ReactNode {
  if (identity.kind !== "icon") return identity.glyph;
  return <Glyph icon={identity.glyph} size={size} fallback={identity.monogram} />;
}
