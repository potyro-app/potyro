// Where a panel anchored to a control goes on a wide screen (#98, #103).
//
// Under the control when there is room, above it when there is not, and never off the side. A
// picker that opened below a control near the bottom of the window ran off the screen and the
// options at the end of the list could not be reached.

/**
 * Either edge, never both. Above the control the panel hangs from its BOTTOM edge, so a list that
 * shrinks as you search stays against the control instead of floating off, pinned where its old
 * top was, over the fields above.
 */
export type Placement = { left: number; top: number; bottom?: undefined } | { left: number; bottom: number; top?: undefined };

const GAP = 6;
const EDGE = 8;

export function placeUnder(anchor: DOMRect, panel: { width: number; height: number }, viewport = { width: window.innerWidth, height: window.innerHeight }): Placement {
  const below = viewport.height - anchor.bottom - GAP;
  const above = anchor.top - GAP;
  const left = Math.max(EDGE, Math.min(anchor.left, viewport.width - EDGE - panel.width));
  // Prefer below; flip only when above genuinely has more room for the panel.
  if (panel.height <= below || below >= above) return { top: anchor.bottom + GAP, left };
  return { bottom: Math.max(EDGE, viewport.height - anchor.top + GAP), left };
}
