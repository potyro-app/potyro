// "The first real screen is up" — one mark on <html>, for whoever waits to show the page (#48).
//
// The page's HTML carries a first screen of its own (first-screen.ts), and an app being opened
// shows a splash: neither is something to act on. The Android app keeps its native splash up until
// what the person came for is on screen, and asks exactly
// `document.documentElement.dataset.potyroReady === "1"`. Do not rename it.
//
// Set once, after the render that shows it has committed (an effect, not the call to render): Home,
// an app, one of the shell's pages, a demo. And for a screen the person must read although nothing
// opened: an app that could not open, "open in another tab", a start-up error.
import { useEffect } from "react";

export const READY_ATTRIBUTE = "data-potyro-ready";

export function markReady(): void {
  globalThis.document?.documentElement.setAttribute(READY_ATTRIBUTE, "1");
}

/** Rendered beside a real screen: marks the page ready once that screen has committed. */
export function Ready(): null {
  useEffect(markReady, []);
  return null;
}
