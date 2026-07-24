// Native-feature seam (docs/05 "Capabilities"). Backs `ctx.caps`. Each nullable member is
// `null` when a target lacks it (runtime degrades); the *host* additionally omits members an
// untrusted app wasn't granted. Note: these platform-level shapes differ slightly from the
// app-facing `ctx.caps` shapes (docs/04) — the host adapts between them (e.g. Date <-> ISO
// string for notification scheduling).

import type { Geo } from "karta";

export interface CameraCap {
  capture(o?: { source?: "camera" | "library" }): Promise<Blob>;
}

export interface NotificationCap {
  schedule(n: { id: string; at: string; title: string; body?: string }): Promise<void>;
  cancel(id: string): Promise<void>;
  list(): Promise<{ id: string; at: string }[]>;
  supportsExactScheduling: boolean;
}

export interface GeoCap {
  current(): Promise<Geo>;
}

export interface FileCap {
  pick(): Promise<Blob>;
  save(name: string, data: Blob): Promise<void>;
}

export interface NetworkCap {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/** Haptic feedback (rest-timer buzz, set-complete tick). `pattern` follows the Web Vibration
 *  API: a single duration or an on/off ms sequence. Native maps it to platform haptics. */
export interface HapticsCap {
  vibrate(pattern?: number | number[]): Promise<void>;
}

export interface Capabilities {
  camera: CameraCap | null;
  notifications: NotificationCap | null;
  geolocation: GeoCap | null;
  /** Haptics; `null` when the platform has no vibration support. */
  haptics: HapticsCap | null;
  /** Always present at the platform level. */
  filesystem: FileCap;
  /** Always present at the platform level; gated per-app by the host. */
  network: NetworkCap;
}
