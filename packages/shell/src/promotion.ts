// Letting a sealed app run as yours (owner, 2026-10-13): always reachable after install.
//
// Everything comes in sealed, and a link is never trusted on the way in (docs/07). But once an app is
// here there must ALWAYS be a way to promote it — from the app's badge, from a sealed custom screen,
// from the screen that says it could not open, from the card after it was added, from its tile on
// your apps and from the Studio. Every one of them opens the same dialog (trust-dialog.tsx).
//
// What this file decides is narrower: whether a failure to open is one that running as yours FIXES.
// The sealed box is the browser realm (docs/22): a Worker with no page, so `window` and `document`
// are not there (QuickJS, the fallback behind a flag, lacks more — sandbox-runner.ts). An app or a
// library that needs a page or a feature the box lacks (missing-features.ts) only works direct, so
// the failure screen offers that as the way out. Nothing else is: code that does not compile or an app's own mistake fails direct too, and a
// library or module that does not match its lock must never be one tap from full authority. Such an
// app can still be promoted from its tile — deliberately, not as the suggested fix.

import { isLibraryStartError, ModuleError } from "./package-modules.js";
import { missingFeature } from "./missing-features.js";
import { setUserAppTrusted } from "./user-apps.js";
import { urlFor } from "./router.js";

/** What package-modules.ts says of bytes that are not the ones the app was installed with. */
const TAMPERED = /is not the copy this app was installed with|was changed outside the app/;

/** Whether running this sealed app as yours would fix this failure to open it. */
export function promotionFixes(error: unknown): boolean {
  if (error instanceof ModuleError) return false;
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (TAMPERED.test(text)) return false;
  return isLibraryStartError(text) || missingFeature(text) !== undefined;
}

/**
 * Promote and open it as yours. A full navigation, not a switch in place: the app is loaded again
 * from the start, as a trusted module, with nothing of the sealed attempt left in the page.
 */
export function promoteAndOpen(id: string): void {
  setUserAppTrusted(id, true, new Date().toISOString());
  location.assign(urlFor({ kind: "user", id }));
}
