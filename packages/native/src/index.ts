// @karta/native — Capacitor target (WP8). Introduced at M2 (docs/08). Placeholder now: the
// interface it will implement (`Capabilities`) already exists; only the composition root swaps
// `WebCapabilities` for `CapacitorCapabilities`. The QuickJS-WASM isolate runs unchanged.

import type { Capabilities } from "@karta/capabilities";

/** Marker so downstream can detect the native target is not yet wired. */
export const NATIVE_TARGET_READY = false;

/**
 * Placeholder factory. At M2 this returns a `CapacitorCapabilities` (real camera, exact local
 * notifications, geo, filesystem) satisfying the same conformance suite as the web impl.
 */
export function createCapacitorCapabilities(): Capabilities {
  throw new Error("@karta/native: CapacitorCapabilities is implemented at M2 (see docs/08).");
}
