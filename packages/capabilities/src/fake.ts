// FakeCapabilities — deterministic capabilities for tests (docs/09). Every member is
// configurable; network is offline-by-default (throws) so tests assert the offline-first
// invariant (docs/09 #4) unless a fetch impl is injected.

import type { Geo } from "potyro";
import type { AiCall, AiCap, AiReply, Capabilities, CameraCap, FileCap, GeoCap, HapticsCap, NetworkCap, NotificationCap } from "./types.js";
import type { LiveCameraCap } from "./live-camera.js";
import type { SocketCap } from "./sockets.js";
import type { SpeechCap } from "./speech.js";

export interface FakeOptions {
  camera?: boolean;
  notifications?: boolean;
  geolocation?: boolean;
  haptics?: boolean;
  /** Fixed position returned by geolocation.current(). */
  position?: Geo;
  /** Bytes returned by camera.capture() and filesystem.pick(). */
  blob?: Blob;
  /** What filesystem.pickFiles() returns; `[]` (a cancel) when absent. */
  files?: File[];
  /** If provided, network.fetch delegates here; otherwise it throws (offline). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** notifications.supportsExactScheduling (default false — web-like). */
  supportsExactScheduling?: boolean;
  /** A live camera — `createFakeLiveCamera().cap` — or none (the default). */
  liveCamera?: LiveCameraCap;
  /** The AI service; none (`null`) when absent. `FakeAi` scripts one. */
  ai?: AiCap;
  /** Live connections — `createFakeSockets().cap`, a server in memory — or none (the default, offline). */
  sockets?: SocketCap;
  /** Voice input — `createFakeSpeech().cap` — or none (the default). */
  speech?: SpeechCap;
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

/**
 * A scripted AI service for tests: each `complete` takes the next reply (a string, or an Error to
 * throw), and every call is recorded so a test can see exactly what would have left the device.
 */
export class FakeAi implements AiCap {
  readonly service = "FakeAI";
  readonly calls: AiCall[] = [];
  readonly language?: string;
  private choice: "on" | "off" | undefined;

  constructor(
    private readonly replies: Array<string | Error> = [],
    opts: { language?: string; standing?: "on" | "off" } = {},
  ) {
    this.language = opts.language;
    this.choice = opts.standing;
  }

  async complete(call: AiCall): Promise<AiReply> {
    this.calls.push(call);
    const next = this.replies.shift();
    if (next === undefined) throw new Error("FakeAi: no reply scripted");
    if (next instanceof Error) throw next;
    return { text: next, via: "free" };
  }

  standing(): "on" | "off" | undefined {
    return this.choice;
  }

  allow(): void {
    this.choice = "on";
  }

  /** Turn AI off for this app, as Edit tile does. */
  turnOff(): void {
    this.choice = "off";
  }
}

export class FakeCapabilities implements Capabilities {
  camera: CameraCap | null;
  notifications: FakeNotifications | null;
  geolocation: GeoCap | null;
  haptics: HapticsCap | null;
  filesystem: FileCap;
  network: NetworkCap;
  liveCamera: LiveCameraCap | null;
  ai: AiCap | null;
  sockets: SocketCap | null;
  speech: SpeechCap | null;

  private saved = new Map<string, Blob>();
  /** Recorded vibration patterns, for assertions. */
  readonly vibrations: (number | number[])[] = [];

  constructor(opts: FakeOptions = {}) {
    const blob = opts.blob ?? new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const position = opts.position ?? { lat: 52.52, lng: 13.405, label: "Berlin" };

    this.camera = opts.camera === false ? null : { capture: async () => blob };
    this.liveCamera = opts.camera === false ? null : (opts.liveCamera ?? null);
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
      pickFiles: async () => [...(opts.files ?? [])],
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
    // None unless a test brings one: a device with no AI is the default, as offline is for network.
    this.ai = opts.ai ?? null;
    this.sockets = opts.sockets ?? null;
    this.speech = opts.speech ?? null;
  }

  /** Files "written" via filesystem.save(), for assertions. */
  savedFiles(): Map<string, Blob> {
    return this.saved;
  }
}
