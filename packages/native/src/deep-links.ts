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

export interface CapacitorAppPlugin {
  getLaunchUrl(): Promise<{ url: string } | undefined | null>;
  addListener(
    event: "appUrlOpen",
    cb: (data: { url: string }) => void,
  ): Promise<{ remove: () => Promise<void> }> | { remove: () => void };
}

/**
 * The plugin, WRAPPED IN A BOX — never returned bare from an async function.
 *
 * A Capacitor plugin is a Proxy that answers to any method name by calling native. Returning one
 * from an `async` function makes the runtime treat it as a thenable and call `App.then(...)`, which
 * on Android answers `"App.then()" is not implemented on android` — and the promise then never
 * settles. Boot awaits `getLaunchUrl()` before it renders anything, so the whole app sat on a black
 * screen, on a device, forever. The box is what keeps `await` away from the proxy.
 */
async function plugin(): Promise<{ app: CapacitorAppPlugin } | null> {
  if (!isNativePlatform()) return null;
  try {
    const mod = (await import("@capacitor/app")) as unknown as { App?: CapacitorAppPlugin };
    return mod.App ? { app: mod.App } : null;
  } catch {
    // `@capacitor/app` not installed (or not linked into this build). Deep links simply do not
    // arrive; nothing else should break because of it.
    return null;
  }
}

/** The URL this app was launched with, when a link started it. `null` on the web. */
export async function getLaunchUrl(): Promise<string | null> {
  const found = await plugin();
  return found ? launchUrlFrom(found.app) : null;
}

/** Call `cb` whenever a link opens the app while it is already running. No-op on the web. */
export async function onUrlOpen(cb: (url: string) => void): Promise<Unsubscribe> {
  const found = await plugin();
  return found ? listenForUrls(found.app, cb) : () => {};
}

/** Split out from `getLaunchUrl` so a test can hand it a plugin-shaped object. */
export async function launchUrlFrom(app: CapacitorAppPlugin): Promise<string | null> {
  try {
    const launched = await app.getLaunchUrl();
    return launched?.url ?? null;
  } catch {
    return null;
  }
}

/** Split out from `onUrlOpen` for the same reason. */
export async function listenForUrls(app: CapacitorAppPlugin, cb: (url: string) => void): Promise<Unsubscribe> {
  try {
    const handle = await app.addListener("appUrlOpen", (d) => cb(d.url));
    return () => void handle.remove();
  } catch {
    return () => {};
  }
}
