// An app's own theme (DESIGN.md §8.2, #423): light or dark for this app whatever the device says.
// The app may declare it (`theme.appearance`); the person may choose it for the app on this device
// (the Studio's switch, kept on the launcher entry), which wins. While the app is open the choice
// goes on the document root, as the Look's own does, so the chrome around the app follows; on the
// way out the Look is put back. "system" means nothing of the app's: the Look decides.

import { useEffect } from "react";
import type { AppDefinition } from "potyro";
import { applyLook } from "./look.js";
import { getEntry, type AppKey } from "./launcher-store.js";

export type Appearance = "light" | "dark" | "system";

/** What this app shows in: the device's choice for it, else its own, else the Look's. */
export function appAppearance(key: AppKey | undefined, def: Pick<AppDefinition, "theme"> | undefined): Appearance {
  const chosen = key ? getEntry(key).appearance : undefined;
  return chosen ?? def?.theme?.appearance ?? "system";
}

/** The class a frame wears to show an app in its own theme (tokens.css `.k-theme-*`); none for "system". */
export function themeClass(appearance: Appearance): string | undefined {
  return appearance === "system" ? undefined : `k-theme-${appearance}`;
}

/** While on: the app's appearance on the document root; the Look's own when it goes. */
export function useAppTheme(appearance: Appearance, on = true): void {
  useEffect(() => {
    if (!on || appearance === "system" || typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", appearance);
    return () => applyLook();
  }, [appearance, on]);
}
