// One app's live connections (docs/28): the page's `SocketCap`, with what is the person's per app —
// where Potyro's rooms are, which hosts they let this app connect to, and the question in their words.
//
// The standing answer lives in localStorage under `potyro:sockets:<appId>`, like AI's
// (`potyro:ai:<appId>`, ai-setting.ts) and never in `ctx.storage`, which the app itself can write and
// which syncs across a space. Deleting the app forgets it (remove-app.ts).

import { t } from "@lingui/core/macro";
import type { ConsentWords, SocketCap, SocketTarget } from "@potyro/capabilities";
import { currentSite } from "./site.js";

const key = (appId: string): string => `potyro:sockets:${appId}`;
const targetKey = (target: SocketTarget): string => ("rooms" in target ? "rooms" : target.host.toLowerCase());

/** In development only: a relay this browser was pointed at by hand (or by a test), docs/28 §7. */
export const DEV_ROOMS_KEY = "potyro:dev:rooms";

/**
 * Where Potyro's rooms relay is (docs/26): the build's own address for it, or `/rooms` on the site.
 * A development server (which has no relay behind `/rooms`) also takes one from `DEV_ROOMS_KEY`;
 * a production build never does — the consent words call this "Potyro's rooms".
 */
export function roomsRelayUrl(): string | undefined {
  const configured = import.meta.env?.VITE_POTYRO_ROOMS?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (import.meta.env?.DEV) {
    try {
      const dev = globalThis.localStorage?.getItem(DEV_ROOMS_KEY)?.trim();
      if (dev) return dev.replace(/\/+$/, "");
    } catch {
      // no storage: the site's own
    }
  }
  const site = currentSite();
  if (!site) return undefined;
  return `${site.secure ? "wss" : "ws"}://${site.host}/rooms`;
}

/** The targets this app may connect to without asking again, on this device. */
export function socketStanding(appId: string): string[] {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(key(appId)) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Forget every answer for this app (it was deleted). */
export function forgetSocketStanding(appId: string): void {
  try {
    globalThis.localStorage?.removeItem(key(appId));
  } catch {
    // nothing to forget
  }
}

function remember(appId: string, target: SocketTarget): void {
  const all = new Set(socketStanding(appId));
  all.add(targetKey(target));
  try {
    globalThis.localStorage?.setItem(key(appId), JSON.stringify([...all].slice(-32)));
  } catch {
    // Storage refused: the app asks again next time, which errs on the person's side.
  }
}

/** The question a shared app's first connection asks, in the person's language. */
export function socketConsentWords(appName: string, target: SocketTarget): ConsentWords {
  if ("rooms" in target) {
    return {
      message: t({ message: `“${appName}” wants a live connection to Potyro’s rooms.`, comment: "Asked before a shared app first joins a room on Potyro's rooms relay (multiplayer)" }),
      detail: t({
        message: "Everyone with the room’s link sees what the app sends there. Potyro closes the connection when you leave the app.",
        comment: "Detail of the question before a shared app joins Potyro's rooms",
      }),
      ok: t({ message: "Allow", comment: "Button: let a shared app open a live connection" }),
      cancel: t({ message: "Not now", comment: "Button: refuse a shared app's live connection this time" }),
    };
  }
  const host = target.host;
  return {
    message: t({ message: `“${appName}” wants a live connection to ${host}.`, comment: "Asked before a shared app first opens a live connection (WebSocket) to a server; {host} is its address" }),
    detail: t({
      message: "While the app is open it can send and receive anything there. Potyro closes the connection when you leave the app.",
      comment: "Detail of the question before a shared app opens a live connection",
    }),
    ok: t({ message: "Allow", comment: "Button: let a shared app open a live connection" }),
    cancel: t({ message: "Not now", comment: "Button: refuse a shared app's live connection this time" }),
  };
}

/** The page's connections, as one app sees them. `null` when the device has none. */
export function appSockets(page: SocketCap | null | undefined, appId: string, roomsUrl: string | undefined = roomsRelayUrl()): SocketCap | null {
  if (!page) return null;
  return {
    open: (url, opts, events) => page.open(url, opts, events),
    closeAll: (why) => page.closeAll(why),
    get openCount() {
      return page.openCount;
    },
    ...(roomsUrl ? { roomsUrl: roomsUrl.replace(/\/+$/, "") } : {}),
    allowed: (target) => socketStanding(appId).includes(targetKey(target)),
    allow: (target) => remember(appId, target),
    consentWords: socketConsentWords,
  };
}
