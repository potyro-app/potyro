// Where a panel anchored to a control goes on a wide screen (#98, #103).
//
// Under the control when there is room, above it when there is not, and never off the side. A
// picker that opened below a control near the bottom of the window ran off the screen and the
// options at the end of the list could not be reached.

export interface Placement {
  top: number;
  left: number;
}

const GAP = 6;
const EDGE = 8;

export function placeUnder(anchor: DOMRect, panel: { width: number; height: number }, viewport = { width: window.innerWidth, height: window.innerHeight }): Placement {
  const below = viewport.height - anchor.bottom - GAP;
  const above = anchor.top - GAP;
  // Prefer below; flip only when above genuinely has more room for the panel.
  const top = panel.height <= below || below >= above ? anchor.bottom + GAP : Math.max(EDGE, anchor.top - GAP - panel.height);
  const left = Math.max(EDGE, Math.min(anchor.left, viewport.width - EDGE - panel.width));
  return { top, left };
}
