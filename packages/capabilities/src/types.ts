// Native-feature seam (docs/05 "Capabilities"). Backs `ctx.caps`. Each nullable member is
// `null` when a target lacks it (runtime degrades); the *host* additionally omits members an
// untrusted app wasn't granted. Note: these platform-level shapes differ slightly from the
// app-facing `ctx.caps` shapes (docs/04) — the host adapts between them (e.g. Date <-> ISO
// string for notification scheduling).

import type { Geo } from "potyro";

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
  /**
   * Ask for one or more files, with their names (`ctx.files.import`, #252). Resolves `[]` when the
   * person cancels, rather than never: a picker closed without a choice must not hang the app.
   */
  pickFiles?(opts?: { accept?: string; multiple?: boolean }): Promise<File[]>;
}

export interface NetworkCap {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/** Haptic feedback (rest-timer buzz, set-complete tick). `pattern` follows the Web Vibration
 *  API: a single duration or an on/off ms sequence. Native maps it to platform haptics. */
export interface HapticsCap {
  vibrate(pattern?: number | number[]): Promise<void>;
}

/** One request to an AI service (docs/23): what the host built from an app's `ctx.caps.ai` call. */
export interface AiCall {
  system: string;
  /** What goes, in order: the app's words and its pictures. */
  parts: Array<{ text: string } | { image: Blob }>;
  /** A JSON Schema the answer must follow; absent = words back. */
  json?: Record<string, unknown>;
  maxTokens: number;
}

export interface AiReply {
  text: string;
  /** Who paid: the free allowance, or the person's own key. */
  via: "free" | "own-key";
  /** US dollars the person's own key was charged, when it was. */
  cost?: number;
}

/**
 * Sends AI requests for apps. Not a device feature, so no target implements it: the shell composes
 * one per app (it holds the key and the person's choices) and leaves it out where there is none.
 */
export interface AiCap {
  /** The service a request goes to, named for the person: "OpenRouter". */
  readonly service: string;
  /** The person's own language, when the shell knows it: what the model writes in. */
  readonly language?: string;
  /** Send it. Throws, in words for the person, when it cannot (offline, turned off, nobody can pay). */
  complete(call: AiCall): Promise<AiReply>;
  /** This app's standing answer on this device: allowed, turned off, or not asked yet. */
  standing?(): "on" | "off" | undefined;
  /** Remember that the person allowed it. */
  allow?(): void;
  /**
   * The consent question in the person's language, saying who would pay as things stand now (it may
   * look first: is the free allowance reachable?). The host has a neutral English one when absent.
   */
  consentWords?(appName: string, sends: "photo" | "text"): AiConsentWords | Promise<AiConsentWords>;
}

export interface AiConsentWords {
  message: string;
  detail: string;
  ok: string;
  cancel: string;
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
  /** AI for apps (docs/23), composed by the shell; absent or `null` = this device offers none. */
  ai?: AiCap | null;
}
