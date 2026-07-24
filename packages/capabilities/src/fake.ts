// FakeCapabilities — deterministic capabilities for tests (docs/09). Every member is
// configurable; network is offline-by-default (throws) so tests assert the offline-first
// invariant (docs/09 #4) unless a fetch impl is injected.

import type { Geo } from "karta";
import type { Capabilities, CameraCap, FileCap, GeoCap, HapticsCap, NetworkCap, NotificationCap } from "./types.js";

export interface FakeOptions {
  camera?: boolean;
  notifications?: boolean;
  geolocation?: boolean;
  haptics?: boolean;
  /** Fixed position returned by geolocation.current(). */
  position?: Geo;
  /** Bytes returned by camera.capture() and filesystem.pick(). */
  blob?: Blob;
  /** If provided, network.fetch delegates here; otherwise it throws (offline). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** notifications.supportsExactScheduling (default false — web-like). */
  supportsExactScheduling?: boolean;
}

/** A recording notification cap so tests can assert scheduling. */
export class FakeNotifications implements NotificationCap {
  readonly scheduled = new Map<string, { id: string; at: string; title: string; body?: string }>();
  supportsExactScheduling: boolean;

  constructor(supportsExactScheduling = false) {
    this.supportsExactScheduling = supportsExactScheduling;
  }

  async schedule(n: { id: string; at: string; title: string; body?: string }): Promise<void> {
    this.scheduled.set(n.id, n);
  }

  async cancel(id: string): Promise<void> {
    this.scheduled.delete(id);
  }

  async list(): Promise<{ id: string; at: string }[]> {
    return [...this.scheduled.values()].map((n) => ({ id: n.id, at: n.at }));
  }
}

export class FakeCapabilities implements Capabilities {
  camera: CameraCap | null;
  notifications: FakeNotifications | null;
  geolocation: GeoCap | null;
  haptics: HapticsCap | null;
  filesystem: FileCap;
  network: NetworkCap;

  private saved = new Map<string, Blob>();
  /** Recorded vibration patterns, for assertions. */
  readonly vibrations: (number | number[])[] = [];

  constructor(opts: FakeOptions = {}) {
    const blob = opts.blob ?? new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const position = opts.position ?? { lat: 52.52, lng: 13.405, label: "Berlin" };

    this.camera = opts.camera === false ? null : { capture: async () => blob };
    this.notifications = opts.notifications === false ? null : new FakeNotifications(opts.supportsExactScheduling ?? false);
    this.geolocation = opts.geolocation === false ? null : { current: async () => position };
    this.haptics =
      opts.haptics === false
        ? null
        : {
            vibrate: async (pattern = 0) => {
              this.vibrations.push(pattern);
            },
          };

    this.filesystem = {
      pick: async () => blob,
      save: async (name, data) => {
        this.saved.set(name, data);
      },
    };

    this.network = {
      fetch: async (input, init) => {
        if (opts.fetch) return opts.fetch(input, init);
        throw new Error(`FakeCapabilities: offline (no fetch configured) for ${input}`);
      },
    };
  }

  /** Files "written" via filesystem.save(), for assertions. */
  savedFiles(): Map<string, Blob> {
    return this.saved;
  }
}
