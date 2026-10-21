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
// The accent is a HUE, not a colour: an hour on the clock of strokes (DESIGN.md §3.1, @potyro/design).
// The system computes every level from the angle, so a choice here cannot walk the palette into
// unreadable contrast the way a free colour picker would. No choice is Potyro's own rosa.

import { useSyncExternalStore } from "react";
import { cor, varsBoth } from "@potyro/design";
import { tracoOf } from "./app-colour.js";

export type Appearance = "system" | "light" | "dark";
/**
 * The home screen's style (#96, owner 2026-10-16): Classic, the default, or Start — the Windows Phone
 * tile wall. A matter of taste, so it is the person's, per device, with the rest of the look. Each
 * style keeps its own arrangement (Classic's pins and order, Start's wall), so switching loses nothing.
 */
export type LauncherStyle = "classic" | "start";

export interface Look {
  appearance: Appearance;
  /** A hue in degrees — an hour of the clock, or any angle — or absent for Potyro's own rosa. */
  accent?: number;
  /** Absent: Classic. */
  launcher?: LauncherStyle;
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
    return { appearance, ...(accent === undefined ? {} : { accent }), ...(parsed.launcher === "start" ? { launcher: "start" as const } : {}) };
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
  // Classic is what "no choice" means: written as absence, like Potyro's own rosa.
  if (next.launcher !== "start") {
    const { launcher: _classic, ...rest } = next;
    next = rest;
  }
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
  // Both themes' values at once (`.k-traco` in styles.css picks the theme's), so a system theme
  // that flips at dusk needs no re-run. No choice: the pairs come off and tokens.css's rosa is back.
  const vars = look.accent === undefined ? undefined : varsBoth(cor(look.accent));
  for (const name of TRACO_VARS) {
    if (vars) root.style.setProperty(name, vars[name]!);
    else root.style.removeProperty(name);
  }
  root.classList.toggle("k-traco", vars !== undefined);
}
const TRACO_VARS = Object.keys(varsBoth(cor(0)));

/** The colour of the chosen accent (its traço, as a swatch shows it), or null for Potyro's own. */
export function accentColour(look: Look = readLook()): string | null {
  return look.accent === undefined ? null : tracoOf(look.accent);
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
