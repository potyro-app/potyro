// A sealed app that took the tab down is not walked into again (#90, docs/22 §7.1).
//
// A sealed app that keeps memory without end is stopped by the browser, not by Potyro: no engine
// gives a page a way to cap a Worker or a frame. Where the app's frame has a process of its own
// (desktop Chromium), only that process goes, the shell notices the silence and the app comes to
// rest (`LoadedApp.rest`). Everywhere else measured — Firefox, Chromium without site isolation — the
// browser's answer can be the whole tab: it crashes, or hangs until it is closed. The person reloads,
// Potyro opens the same app, and it happens again.
//
// So while a sealed app is open and on screen, a marker sits in localStorage, refreshed every second
// (the sealed views' crash-loop guard, under keys of its own). A marker another page load finds
// stale means a tab died or froze with that app open: the app is not started at the next open — the
// screen says so, and offers to start it. Not proof the app did it (a browser killed for any reason
// leaves the same marker), which is why it costs the person one tap and nothing else.
//
// Only sealed apps: an app that runs as yours is the person's own code.

import { ViewGuard } from "@potyro/host/realm";

export const OPEN_MARK_PREFIX = "potyro:sealed-open:mark:";
export const OPEN_OFF_KEY = "potyro:sealed-open:off";

let guard: ViewGuard | null = null;

export function sealedOpenGuard(): ViewGuard {
  guard ??= new ViewGuard({ keys: { mark: OPEN_MARK_PREFIX, off: OPEN_OFF_KEY }, now: () => Date.now() });
  return guard;
}

/** Whether a tab died or froze with this sealed app open, and the person has not started it since. */
export function sealedOpenPaused(id: string): boolean {
  return sealedOpenGuard().isOff(id);
}

/** The person chose to start it. */
export function startSealedAgain(id: string): void {
  sealedOpenGuard().retry(id);
}

/**
 * A sealed app is about to be opened: mark it, before any of its code runs, and keep the marker
 * fresh while this tab lives and shows it. Returns the way to stop (the app was put away).
 */
export function watchSealedOpen(id: string, doc: Document = document): () => void {
  const win = doc.defaultView;
  const mark = sealedOpenGuard().mounting(id, "app");
  // The shell's own timer: it runs while the tab does. A tab that dies, or hangs with the app's
  // screen holding its thread, stops refreshing.
  const tick = setInterval(() => mark.alive(), 1000);
  // Off screen, a tab's timers are throttled and the system may end it for reasons of its own: not a crash.
  const seen = (): void => (doc.hidden ? mark.pause() : mark.resume());
  const away = (): void => mark.pause();
  doc.addEventListener("visibilitychange", seen);
  win?.addEventListener("pagehide", away);
  win?.addEventListener("pageshow", seen);
  seen();
  return () => {
    clearInterval(tick);
    doc.removeEventListener("visibilitychange", seen);
    win?.removeEventListener("pagehide", away);
    win?.removeEventListener("pageshow", seen);
    mark.done();
  };
}
