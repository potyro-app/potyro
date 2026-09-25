// @karta/native — Capacitor target (WP8 / KA-03): native capability impls. The composition root
// swaps `WebCapabilities` for `CapacitorCapabilities` when running under Capacitor; the QuickJS-WASM
// isolate and the host's per-app mediation run unchanged.

import type { Capabilities } from "@karta/capabilities";

export { getLaunchUrl, onUrlOpen, launchUrlFrom, listenForUrls, type CapacitorAppPlugin } from "./deep-links.js";
export { maybeCreateNativeVault, vaultOver, type NativeSecretVault } from "./secure-vault.js";
export { fetchOver, maybeCreateNativeSourceHttp, type HttpPlugin, type SourceHttp } from "./native-http.js";
export { listenForShares, textOfShare, type SharedText } from "./share-target.js";

export {
  CapacitorCapabilities,
  createCapacitorCapabilities,
  stableNotificationId,
  type CapacitorPlugins,
  type CapacitorHostHelpers,
} from "./capacitor-capabilities.js";

/** True once the native impl is wired (kept for callers that gate on it). */
export const NATIVE_TARGET_READY = true;

/** Is the app running inside a Capacitor native shell (Android/iOS), vs a plain browser? Reads the
 *  global Capacitor bridge injected by the native runtime — safe to call on the web (returns false). */
export function isNativePlatform(): boolean {
  const cap = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === "function" ? cap.isNativePlatform() : false;
}

/**
 * Composition-root helper: returns the native capabilities when running under Capacitor, else null
 * (the caller falls back to `createWebCapabilities()`). Keeps the web bundle free of Capacitor —
 * the native module is only imported when actually on a device.
 */
export async function maybeCreateNativeCapabilities(): Promise<Capabilities | null> {
  if (!isNativePlatform()) return null;
  const { createCapacitorCapabilities } = await import("./capacitor-capabilities.js");
  return createCapacitorCapabilities();
}
