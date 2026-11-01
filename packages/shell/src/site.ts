// The site this build belongs to — where its relay, its services and its links live.
//
// On the web that is the page's own address: the shell, `/sync`, `/ai`, `/requests` and
// `/share-api` share one origin (deploy/potyro.app.Caddyfile), and a link a person sends is the page they
// are on. Inside the native app there is no such page. The WebView is `https://localhost` on Android
// and `capacitor://localhost` on iOS, served from the phone itself, so every address derived from
// `location` pointed at the phone: an invite link nobody else could open, a relay at
// `wss://localhost/sync`, and on iOS no relay at all (a `capacitor:` origin has no http host).
//
// So a native build is TOLD its site, once, at build time — `VITE_POTYRO_SITE=https://potyro.app` —
// and everything that used to read `location` asks here instead. A web build sets nothing and
// behaves exactly as before. A native build without it has no site: sync stays local, and the
// service calls fail the way they always did there (docs/27 §2.1).
//
// The per-service variables (`VITE_POTYRO_RELAY`, `_AI`, `_REQUESTS`, `_SHARE`) still win where set.

import { siteBase } from "./demo-link.js";

export interface Site {
  /** `https://potyro.app` — no trailing slash. */
  origin: string;
  /** `potyro.app` — for the relay's websocket address. */
  host: string;
  /** The path the shell is served at, always ending in `/` (`/`, or `/potyro/`). */
  path: string;
  /** https (so wss), or plain http in a local test. */
  secure: boolean;
  /** Named by the build rather than read from the page. */
  configured: boolean;
}

export interface SiteEnv {
  /** `VITE_POTYRO_SITE`, as the build has it. */
  configured?: string;
  location?: Pick<Location, "protocol" | "host" | "origin" | "pathname">;
  /** Running inside the Capacitor shell (Android or iOS). */
  native: boolean;
}

/** The site, or null when this build does not know one (a native build that was not told). Pure. */
export function siteFrom(env: SiteEnv): Site | null {
  const named = env.configured?.trim();
  if (named) {
    let url: URL;
    try {
      url = new URL(named);
    } catch {
      return null; // a typo in a build variable must not take the app down
    }
    if (!/^https?:$/.test(url.protocol)) return null;
    const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return { origin: url.origin, host: url.host, path, secure: url.protocol === "https:", configured: true };
  }
  const loc = env.location;
  // The native WebView's own origin is the phone, not a site; `file:` and the like have no host.
  if (env.native || !loc?.host || !/^https?:$/.test(loc.protocol)) return null;
  return { origin: loc.origin, host: loc.host, path: siteBase(loc.pathname), secure: loc.protocol === "https:", configured: false };
}

function nativeShell(): boolean {
  const cap = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === "function" ? cap.isNativePlatform() : false;
}

/** This build's site, read now. */
export function currentSite(): Site | null {
  const configured = import.meta.env?.VITE_POTYRO_SITE as string | undefined;
  return siteFrom({ configured, location: globalThis.location, native: nativeShell() });
}
