// One app's live connections (docs/28): the page's `SocketCap`, with what is the person's per app —
// where Potyro's rooms are, which hosts they let this app connect to, and the question in their words.
//
// The standing answer lives in localStorage under `potyro:sockets:<appId>`, like AI's
// (`potyro:ai:<appId>`, ai-setting.ts) and never in `ctx.storage`, which the app itself can write and
// which syncs across a space. Deleting the app forgets it (remove-app.ts). It holds what was allowed
// and what the person then turned off in Edit tile — so the switch can be turned on again — and, for
// an app that reaches a device on the home network, that device's address (`local:<address>`).

import { t } from "@lingui/core/macro";
import type { AddressAskWords, ConsentNote, ConsentWords, SocketCap, SocketTarget } from "@potyro/capabilities";
import { currentSite } from "./site.js";

const key = (appId: string): string => `potyro:sockets:${appId}`;
const targetKey = (target: SocketTarget): string => ("rooms" in target ? "rooms" : "local" in target ? `local:${target.local.toLowerCase()}` : target.host.toLowerCase());

/** What one target is, for its row in Edit tile. */
export function socketTargetOf(k: string): SocketTarget {
  return k === "rooms" ? { rooms: true } : k.startsWith("local:") ? { local: k.slice(6) } : { host: k };
}

interface Standing {
  on: string[];
  off: string[];
}

function readStanding(appId: string): Standing {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(key(appId)) ?? "[]") as unknown;
    const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
    // Before Edit tile had switches the answer was a list of what was allowed.
    if (Array.isArray(v)) return { on: strings(v), off: [] };
    const o = (v ?? {}) as { on?: unknown; off?: unknown };
    return { on: strings(o.on), off: strings(o.off) };
  } catch {
    return { on: [], off: [] };
  }
}

function writeStanding(appId: string, s: Standing): void {
  try {
    globalThis.localStorage?.setItem(key(appId), JSON.stringify({ on: s.on.slice(-32), off: s.off.slice(-32) }));
  } catch {
    // Storage refused: the app asks again next time, which errs on the person's side.
  }
}

/** One row of Edit tile's "Live connections": a target this app was allowed, on or turned off. */
export interface SocketSwitch {
  key: string;
  target: SocketTarget;
  on: boolean;
}

/** Every target this app was allowed on this device, in the order they were first allowed. */
export function socketSwitches(appId: string): SocketSwitch[] {
  const s = readStanding(appId);
  const seen = new Set<string>();
  const rows: SocketSwitch[] = [];
  for (const k of [...s.on, ...s.off]) {
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({ key: k, target: socketTargetOf(k), on: s.on.includes(k) && !s.off.includes(k) });
  }
  return rows;
}

const offListeners = new Map<string, Set<(target: SocketTarget) => void>>();

/**
 * Turn one target on or off for this app (Edit tile). Off ends the app's open connections there at
 * once (the host hears it through `onTurnedOff`) and refuses the next without asking; on lets it
 * connect again without a question. `forget` drops it, so the next connection asks again — for a
 * home device, for its address too.
 */
export function setSocketSwitch(appId: string, k: string, to: "on" | "off" | "forget"): void {
  const s = readStanding(appId);
  const on = s.on.filter((x) => x !== k);
  const off = s.off.filter((x) => x !== k);
  if (to === "on") on.push(k);
  if (to === "off") off.push(k);
  writeStanding(appId, { on, off });
  if (to !== "on") for (const cb of [...(offListeners.get(appId) ?? [])]) cb(socketTargetOf(k));
}

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

/** The targets this app may connect to without asking again, on this device (not those turned off). */
export function socketStanding(appId: string): string[] {
  const s = readStanding(appId);
  return s.on.filter((k) => !s.off.includes(k));
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
  const k = targetKey(target);
  const s = readStanding(appId);
  // One home device per app: a new address replaces the one before.
  const keep = (x: string): boolean => x !== k && !("local" in target && x.startsWith("local:"));
  writeStanding(appId, { on: [...s.on.filter(keep), k], off: s.off.filter(keep) });
}

/** The home-network address the person gave this app (on or turned off), if any. */
export function localAddressOf(appId: string): string | undefined {
  const k = socketSwitches(appId).find((r) => r.key.startsWith("local:"));
  return k ? k.key.slice(6) : undefined;
}

/** The question a shared app's first connection asks, in the person's language. */
export function socketConsentWords(appName: string, target: SocketTarget, note?: ConsentNote): ConsentWords {
  const ok = t({ message: "Allow", comment: "Button: let a shared app open a live connection" });
  const cancel = t({ message: "Not now", comment: "Button: refuse a shared app's live connection this time" });
  if ("rooms" in target) {
    return {
      message: t({ message: `“${appName}” wants a live connection to Potyro’s rooms.`, comment: "Asked before a shared app first joins a room on Potyro's rooms relay (multiplayer)" }),
      detail: t({
        message: "Everyone with the room’s link sees what the app sends there. Potyro closes the connection when you leave the app.",
        comment: "Detail of the question before a shared app joins Potyro's rooms",
      }),
      ok,
      cancel,
    };
  }
  const detail = t({
    message: "While the app is open it can send and receive anything there. Potyro closes the connection when you leave the app.",
    comment: "Detail of the question before a shared app opens a live connection",
  });
  if ("local" in target) {
    const address = target.local;
    const web = note?.secureOnly
      ? ` ${t({
          message: "In a browser it connects only if the device offers a secure (wss://) connection; the Potyro app for Android connects either way.",
          comment: "Added to the question about a device on the home network when Potyro runs as a website: an https page cannot open plain ws:// connections",
        })}`
      : "";
    return {
      message: t({
        message: `“${appName}” wants a live connection to ${address} on your home network.`,
        comment: "Asked before a shared app first connects to a device on the person's home network (a smart-home hub, lights); {address} is what the person typed, like 192.168.1.20",
      }),
      detail: `${detail}${web}`,
      ok,
      cancel,
    };
  }
  const host = target.host;
  return {
    message: t({ message: `“${appName}” wants a live connection to ${host}.`, comment: "Asked before a shared app first opens a live connection (WebSocket) to a server; {host} is its address" }),
    detail,
    ok,
    cancel,
  };
}

/** The question asking for a home device's address; `retry` is what they typed that was not one. */
export function localAddressWords(appName: string, retry: string | null): AddressAskWords {
  const typed = retry?.slice(0, 60) ?? "";
  return {
    message: retry
      ? t({ message: `“${typed}” is not an address on your home network.`, comment: "The person typed an address that is not on their local network (like a website); they are asked again" })
      : t({
          message: `“${appName}” wants to connect to a device on your home network.`,
          comment: "Asked the first time an app connects to a device on the person's home network (a smart-home hub, lights); they then type its local address",
        }),
    detail: t({
      message: "What is the device’s address? For example 192.168.1.20 or homeassistant.local — it is in the device’s own settings or app.",
      comment: "Under the question asking for a home device's address; the field below takes it",
    }),
    ok: t({ message: "Continue", comment: "Button: use the address the person typed for a home device (the permission question follows)" }),
    cancel: t({ message: "Not now", comment: "Button: refuse a shared app's live connection this time" }),
    placeholder: "192.168.1.20",
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
    get plainLocal() {
      return page.plainLocal;
    },
    ...(roomsUrl ? { roomsUrl: roomsUrl.replace(/\/+$/, "") } : {}),
    allowed: (target) => socketStanding(appId).includes(targetKey(target)),
    allow: (target) => remember(appId, target),
    turnedOff: (target) => readStanding(appId).off.includes(targetKey(target)),
    onTurnedOff: (cb) => {
      let set = offListeners.get(appId);
      if (!set) offListeners.set(appId, (set = new Set()));
      set.add(cb);
      return () => {
        set.delete(cb);
        if (set.size === 0) offListeners.delete(appId);
      };
    },
    localAddress: () => localAddressOf(appId),
    consentWords: socketConsentWords,
    localAddressWords,
  };
}
