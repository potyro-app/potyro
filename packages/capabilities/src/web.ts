// WebCapabilities — the browser (PWA) implementation of the capability seam. This is the WP4
// starter: it implements the capabilities that are trivial + safe on the web today (haptics,
// geolocation, network, basic filesystem). Camera and notifications are deferred to full WP4 /
// M2 (web local-notification scheduling is unreliable — docs/07 "the deciding feature" — so it
// degrades to `null` until the Capacitor target lands).

import type { Geo } from "karta";
import type { Capabilities, CameraCap, FileCap, GeoCap, HapticsCap, NetworkCap, NotificationCap } from "./types.js";

function makeGeo(): GeoCap | null {
  const g = globalThis.navigator;
  if (!g?.geolocation) return null;
  return {
    current: () =>
      new Promise<Geo>((resolve, reject) => {
        g.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
          (err) => reject(new Error(err.message)),
          { enableHighAccuracy: true, timeout: 10_000 },
        );
      }),
  };
}

function makeHaptics(): HapticsCap | null {
  const nav = globalThis.navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav?.vibrate !== "function") return null;
  return {
    vibrate: async (pattern = 30) => {
      nav.vibrate!(pattern);
    },
  };
}

function makeFilesystem(): FileCap {
  return {
    pick: () =>
      new Promise<Blob>((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        input.onchange = () => {
          const file = input.files?.[0];
          if (file) resolve(file);
          else reject(new Error("no file picked"));
        };
        input.click();
      }),
    save: async (name, data) => {
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}

export class WebCapabilities implements Capabilities {
  readonly camera: CameraCap | null = null; // WP4
  readonly notifications: NotificationCap | null = null; // WP4 / M2 (native gives exact scheduling)
  readonly geolocation: GeoCap | null;
  readonly haptics: HapticsCap | null;
  readonly filesystem: FileCap;
  readonly network: NetworkCap;

  constructor() {
    this.geolocation = makeGeo();
    this.haptics = makeHaptics();
    this.filesystem = makeFilesystem();
    this.network = { fetch: (input, init) => globalThis.fetch(input, init) };
  }
}
