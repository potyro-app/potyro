// What this device looks like: light or dark, and the colour the shell wears.
//
// PER DEVICE, like the launcher's order and a map's remembered camera. A phone at night and a
// laptop in daylight want different answers, and "follow the system" — the default — already gives
// each the right one. It also works before there is an account, which a look that travelled with
// the recovery words could not.
//
// The CSS was built for this from the start: the palette is defined once under `:root`, overridden
// under `prefers-color-scheme: dark`, and `[data-theme]` on the root beats both — "so a manual
// toggle can", says the comment that has been sitting there with nothing to set it. This is the
// thing that sets it.
//
// The accent is a HUE, not a colour. Every token is OKLCH with fixed lightness and chroma, so a
// hue-only choice cannot walk the palette into unreadable contrast the way a free colour picker
// would — the same reason a tile's colour is a hue (`tile-identity.ts`).

import { useSyncExternalStore } from "react";
import { hueColour } from "./tile-identity.js";

export type Appearance = "system" | "light" | "dark";

export interface Look {
  appearance: Appearance;
  /** A hue from `TILE_HUES`, or absent for Potyro's own gold. */
  accent?: number;
}

const KEY = "potyro:look";
export const DEFAULT_LOOK: Look = { appearance: "system" };

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Private windows and embedded contexts throw on access rather than returning null. A look that
    // cannot be saved must still be a look.
    return null;
  }
}

export function readLook(): Look {
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) return DEFAULT_LOOK;
    const parsed = JSON.parse(raw) as Partial<Look>;
    const appearance: Appearance =
      parsed.appearance === "light" || parsed.appearance === "dark" ? parsed.appearance : "system";
    const accent = typeof parsed.accent === "number" && Number.isFinite(parsed.accent) ? parsed.accent : undefined;
    return accent === undefined ? { appearance } : { appearance, accent };
  } catch {
    return DEFAULT_LOOK;
  }
}

const listeners = new Set<() => void>();

/**
 * The look as one object that only changes when the look does.
 *
 * `useSyncExternalStore` compares snapshots by identity: handing it a freshly parsed object every
 * render is an infinite loop, and React says so before tearing the tree down — which is exactly
 * what clicking the button did until this existed.
 */
let snapshot: Look | null = null;
function current(): Look {
  return (snapshot ??= readLook());
}

export function setLook(next: Look): void {
  snapshot = next;
  try {
    store()?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Unsaveable, but still applied below: the choice holds for this session.
  }
  applyLook(next);
  for (const cb of listeners) cb();
}

/**
 * Put the look on the document.
 *
 * `data-theme` only for a deliberate choice — "system" removes it, so the media query is back in
 * charge rather than being frozen to whatever the system said at boot.
 */
export function applyLook(look: Look = readLook()): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (look.appearance === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", look.appearance);
  if (look.accent === undefined) root.style.removeProperty("--accent");
  else root.style.setProperty("--accent", hueColour(look.accent));
}

/** The colour of the chosen accent, or null for Potyro's own. */
export function accentColour(look: Look = readLook()): string | null {
  return look.accent === undefined ? null : hueColour(look.accent);
}

export function useLook(): Look {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    current,
    () => DEFAULT_LOOK,
  );
}
