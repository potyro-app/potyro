// Adding Potyro to the home screen (#123).
//
// On a phone Potyro is a web page until someone adds it to the home screen; after that it opens like
// an app, full screen, from its own icon, and the service worker has it working offline. Most people
// never find the browser's own menu entry for that, so the You panel offers it — ONE quiet row, and
// only where it can work:
//
// - **Chrome, Edge, Samsung Internet** fire `beforeinstallprompt` when the site can be installed. It
//   is caught here, as early as the shell loads, and `preventDefault()`ed: that stops Chrome's own
//   mini-infobar, which is exactly the banner-on-first-paint this row exists instead of. The row's
//   button replays the browser's own dialog.
// - **Safari on iPhone and iPad** has no such event. The row says the two steps instead.
// - **Anywhere else**, and wherever Potyro is already installed (opened from the home screen, or
//   the native app), nothing is shown.
//
// Never twice: "No thanks" is remembered on this device, and so is declining the browser's dialog —
// Chrome would not offer it again for months anyway. The memory is a per-viewer convenience, so
// `localStorage` is right for it; a browser that refuses storage just shows the row again next time.

import { useSyncExternalStore } from "react";

/** The event Chromium fires when the site can be installed. Not in TypeScript's DOM types. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

/** What the You panel offers: the browser's own dialog, the two Safari steps, or nothing. */
export type InstallOffer = "prompt" | "ios" | null;

/** Everything the offer depends on, gathered by `readInstallEnv` so the rule itself is testable. */
export interface InstallEnv {
  /** Running from the home screen already (display-mode standalone, or iOS's `navigator.standalone`). */
  standalone: boolean;
  /** The Capacitor app: it IS the installed app. */
  native: boolean;
  /** Safari on iPhone/iPad, where adding is a manual Share → Add to Home Screen. */
  iosSafari: boolean;
  /** The browser has offered installing (a held `beforeinstallprompt`). */
  canPrompt: boolean;
  /** Installed during this visit (`appinstalled`), before the page itself becomes standalone. */
  installed: boolean;
  /** "No thanks", or the browser's dialog declined, on this device. */
  dismissed: boolean;
}

export const DISMISSED_KEY = "potyro:install:dismissed";

/** The rule, on its own: who gets which offer. */
export function installOfferFor(env: InstallEnv): InstallOffer {
  if (env.standalone || env.native || env.installed || env.dismissed) return null;
  if (env.canPrompt) return "prompt";
  if (env.iosSafari) return "ios";
  return null;
}

/**
 * Safari on an iPhone or iPad — not Chrome, Firefox or an app's built-in browser there, whose menus
 * differ or cannot add to the home screen at all. iPadOS asks for the desktop site and reads as a Mac,
 * so a Mac with a touch screen is an iPad.
 */
export function isIosSafari(userAgent: string, platform = "", maxTouchPoints = 0): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  if (!ios) return false;
  if (!/Safari\//.test(userAgent)) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\//.test(userAgent);
}

let held: InstallPromptEvent | null = null;
let installedNow = false;
/** Declined during this visit: holds even where the browser will not let it be written down. */
let dismissedNow = false;
let listening = false;
let snapshot: InstallOffer = null;
const listeners = new Set<() => void>();

function readDismissed(): boolean {
  if (dismissedNow) return true;
  try {
    return Boolean(globalThis.localStorage?.getItem(DISMISSED_KEY));
  } catch {
    return false;
  }
}

function rememberDismissed(): void {
  dismissedNow = true;
  try {
    globalThis.localStorage?.setItem(DISMISSED_KEY, new Date().toISOString());
  } catch {
    // Not remembered: the row comes back on the next visit. Annoying, never wrong.
  }
}

function matches(win: Window, query: string): boolean {
  try {
    return win.matchMedia?.(query).matches ?? false;
  } catch {
    return false;
  }
}

/** This page's situation, read now. */
export function readInstallEnv(win: Window = window): InstallEnv {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  const cap = (win as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return {
    standalone:
      nav.standalone === true ||
      matches(win, "(display-mode: standalone)") ||
      matches(win, "(display-mode: fullscreen)") ||
      matches(win, "(display-mode: minimal-ui)"),
    native: typeof cap?.isNativePlatform === "function" ? cap.isNativePlatform() : false,
    iosSafari: isIosSafari(nav.userAgent ?? "", nav.platform ?? "", nav.maxTouchPoints ?? 0),
    canPrompt: held !== null,
    installed: installedNow,
    dismissed: readDismissed(),
  };
}

function changed(): void {
  snapshot = typeof window === "undefined" ? null : installOfferFor(readInstallEnv(window));
  for (const cb of listeners) cb();
}

/**
 * Catch the browser's install offer. Call once, as the shell loads: the event fires once per page and
 * is lost if nothing is listening yet.
 */
export function listenForInstall(win: Window = window): void {
  if (listening) return;
  listening = true;
  win.addEventListener("beforeinstallprompt", (e) => {
    // No mini-infobar: the offer lives in the You panel, where somebody went looking.
    e.preventDefault();
    held = e as InstallPromptEvent;
    changed();
  });
  win.addEventListener("appinstalled", () => {
    held = null;
    installedNow = true;
    changed();
  });
  changed();
}

/** "Add": the browser's own dialog. Declining it counts as "No thanks". */
export async function acceptInstall(): Promise<void> {
  const event = held;
  if (!event) return;
  // A held event can be replayed once; whatever happens next, it is spent.
  held = null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "dismissed") rememberDismissed();
    else installedNow = true;
  } catch {
    // The browser refused to show it (already shown, or no longer installable): nothing to offer.
  }
  changed();
}

/** "No thanks": not offered again on this device. */
export function dismissInstall(): void {
  rememberDismissed();
  changed();
}

/** The offer, kept current as the browser offers, the person answers, or the app gets installed. */
export function useInstallOffer(): InstallOffer {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => null,
  );
}

/** Tests only: forget everything this module has seen. */
export function resetInstallOfferForTests(): void {
  held = null;
  installedNow = false;
  dismissedNow = false;
  listening = false;
  snapshot = null;
  listeners.clear();
}
