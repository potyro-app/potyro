// WebCapabilities — the browser (PWA) implementation of the capability seam (WP4 / KA-02). It
// implements what the web does reliably today: camera (file-input capture), geolocation, haptics,
// filesystem (File System Access API with an <input>/<a download> fallback), and network (fetch).
//
// Notifications stay `null` on the web deliberately: durable/exact local-notification scheduling is
// not reliable in a browser (docs/07), so reminders degrade to the in-app "due" surface (issue #18)
// and exact offline scheduling arrives with the native target (KA-03). The host wraps whichever caps
// are present with per-app mediation for untrusted code — unchanged by what this class exposes.

import type { Geo } from "potyro";
import type { Capabilities, CameraCap, FileCap, GeoCap, HapticsCap, NetworkCap, NotificationCap } from "./types.js";
import { sharedLiveCamera, type LiveCameraCap } from "./live-camera.js";
import { sharedWebSockets, type SocketCap } from "./sockets.js";

// Minimal shapes for the File System Access API (not in older lib.dom typings).
interface WritableFileStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
interface FileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<WritableFileStream>;
}
interface FsAccessGlobals {
  showOpenFilePicker?: () => Promise<FileHandle[]>;
  showSaveFilePicker?: (opts?: { suggestedName?: string }) => Promise<FileHandle>;
}

const hasDom = (): boolean => typeof document !== "undefined";

/**
 * Files chosen in a transient `<input type=file>`, `[]` if the person cancels.
 *
 * Cancelling fires `cancel` on the input in current browsers. Where it does not, focus coming back
 * to the window with nothing chosen means the same thing; the delay lets a real `change` land first.
 */
export function pickFilesFromInput(opts: { accept?: string; multiple?: boolean } = {}): Promise<File[]> {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (opts.accept) input.accept = opts.accept;
    input.multiple = opts.multiple === true;
    let settled = false;
    const done = (files: File[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      resolve(files);
    };
    const onFocus = () => setTimeout(() => done(Array.from(input.files ?? [])), 400);
    input.onchange = () => done(Array.from(input.files ?? []));
    input.addEventListener("cancel", () => done([]));
    window.addEventListener("focus", onFocus);
    input.click();
  });
}

/** Read a Blob from a transient file input (optionally cueing the camera on mobile). */
function pickFile(opts: { accept?: string; capture?: string } = {}): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    if (opts.accept) input.accept = opts.accept;
    if (opts.capture) input.setAttribute("capture", opts.capture);
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) resolve(file);
      else reject(new Error("no file selected"));
    };
    input.click();
  });
}

function makeCamera(): CameraCap | null {
  if (!hasDom()) return null;
  return {
    // On mobile web, `capture` cues the camera directly; on desktop it falls back to a file dialog.
    capture: (o) => pickFile(o?.source === "library" ? { accept: "image/*" } : { accept: "image/*", capture: "environment" }),
  };
}

/**
 * How long we are willing to wait for a fix, in total.
 *
 * `getCurrentPosition`'s own `timeout` only starts once permission has been GRANTED — while the
 * browser is showing its permission prompt the clock is not running. So a prompt the user never
 * answers (or one a headless browser never shows) leaves the promise pending forever, and any caller
 * that put itself in a "locating…" state stays there for good. This is the outer bound that makes
 * the promise always settle.
 */
const GEO_TIMEOUT_MS = 12_000;

function makeGeo(): GeoCap | null {
  const g = globalThis.navigator;
  if (!g?.geolocation) return null;
  return {
    current: () =>
      new Promise<Geo>((resolve, reject) => {
        let settled = false;
        const done = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn();
        };
        const timer = setTimeout(
          () => done(() => reject(new Error("Timed out waiting for your location — is location permission allowed?"))),
          GEO_TIMEOUT_MS,
        );
        g.geolocation.getCurrentPosition(
          (p) => done(() => resolve({ lat: p.coords.latitude, lng: p.coords.longitude })),
          (err) => done(() => reject(new Error(err.message || "Could not get your location"))),
          { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS },
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
  const fs = globalThis as unknown as FsAccessGlobals;
  return {
    pick: async () => {
      if (fs.showOpenFilePicker) {
        const [handle] = await fs.showOpenFilePicker();
        if (!handle) throw new Error("no file picked");
        return handle.getFile();
      }
      return pickFile();
    },
    pickFiles: (opts) => pickFilesFromInput(opts),
    save: async (name, data) => {
      if (fs.showSaveFilePicker) {
        const handle = await fs.showSaveFilePicker({ suggestedName: name });
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        return;
      }
      // Fallback: trigger a download via an object URL.
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
  readonly camera: CameraCap | null;
  readonly notifications: NotificationCap | null = null; // web → in-app "due"; native (KA-03) schedules exactly
  readonly geolocation: GeoCap | null;
  readonly haptics: HapticsCap | null;
  readonly filesystem: FileCap;
  readonly network: NetworkCap;
  /** getUserMedia, one session per page (docs/25). */
  readonly liveCamera: LiveCameraCap | null;
  /** The browser's WebSocket, one set per page (docs/28). */
  readonly sockets: SocketCap | null;

  constructor() {
    this.camera = makeCamera();
    this.geolocation = makeGeo();
    this.haptics = makeHaptics();
    this.filesystem = makeFilesystem();
    this.network = { fetch: (input, init) => globalThis.fetch(input, init) };
    this.liveCamera = sharedLiveCamera();
    this.sockets = sharedWebSockets();
  }
}

/** Factory for the web target's capability set (used by the shell composition root). */
export function createWebCapabilities(): Capabilities {
  return new WebCapabilities();
}
