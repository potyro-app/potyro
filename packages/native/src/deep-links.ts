// Receiving a shared-app link on a device.
//
// On the web an invite arrives in the address bar, so `location.hash` is the whole story. On a
// device it arrives as an OS event — an Android App Link / iOS Universal Link handed to the app by
// `@capacitor/app` — and never touches `location`. Both entry points have to reach the same join
// path, or sharing works in the browser and silently does nothing in the shipped app.
//
// Two cases, and missing either one is a bug someone would report as "the link does nothing":
//   COLD start — the app was launched BY the link. Nothing has listened yet, so the URL must be
//                fetched with `getLaunchUrl()`.
//   WARM start — the app was already open. No launch URL; the event fires instead.
//
// The URL fragment survives every path (App Links, Universal Links, custom schemes): the OS hands
// over the whole URL, and if the app is not installed the browser opens the page with the fragment
// still client-side. So the invite secret never reaches a server on any route.
//
// Everything here is a no-op on the web, and the import is dynamic so the web bundle stays free of
// Capacitor — the same rule `maybeCreateNativeCapabilities` follows.

import { isNativePlatform } from "./index.js";

type Unsubscribe = () => void;

interface CapacitorAppPlugin {
  getLaunchUrl(): Promise<{ url: string } | undefined | null>;
  addListener(
    event: "appUrlOpen",
    cb: (data: { url: string }) => void,
  ): Promise<{ remove: () => Promise<void> }> | { remove: () => void };
}

async function plugin(): Promise<CapacitorAppPlugin | null> {
  if (!isNativePlatform()) return null;
  try {
    const mod = (await import("@capacitor/app")) as unknown as { App?: CapacitorAppPlugin };
    return mod.App ?? null;
  } catch {
    // `@capacitor/app` not installed (or not linked into this build). Deep links simply do not
    // arrive; nothing else should break because of it.
    return null;
  }
}

/** The URL this app was launched with, when a link started it. `null` on the web. */
export async function getLaunchUrl(): Promise<string | null> {
  const app = await plugin();
  if (!app) return null;
  try {
    return (await app.getLaunchUrl())?.url ?? null;
  } catch {
    return null;
  }
}

/** Call `cb` whenever a link opens the app while it is already running. No-op on the web. */
export async function onUrlOpen(cb: (url: string) => void): Promise<Unsubscribe> {
  const app = await plugin();
  if (!app) return () => {};
  try {
    const handle = await app.addListener("appUrlOpen", (d) => cb(d.url));
    return () => void handle.remove();
  } catch {
    return () => {};
  }
}
