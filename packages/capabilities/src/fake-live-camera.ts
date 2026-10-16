// A live camera over fakes (docs/25): no browser, every rule of `createLiveCamera` still real. The
// page can be hidden or closed, the device can end the track, a refusal can be scripted, and frames
// are pushed by hand — so a test says exactly which frame an app saw.

import type { Face, FacesFailure } from "potyro";
import { scriptedFinder } from "./faces.js";
import { createLiveCamera, type LiveCameraCap } from "./live-camera.js";

class FakeTrack extends EventTarget {
  readyState: "live" | "ended" = "live";
  stopped = false;
  constructor(private readonly facing: string) {
    super();
  }
  stop(): void {
    this.stopped = true;
    this.readyState = "ended";
  }
  getSettings(): MediaTrackSettings {
    return { facingMode: this.facing };
  }
  /** The device taking the camera away (unplugged, revoked). */
  end(): void {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

class FakeStream {
  constructor(readonly track: FakeTrack) {}
  getTracks(): FakeTrack[] {
    return [this.track];
  }
  getVideoTracks(): FakeTrack[] {
    return [this.track];
  }
}

class FakeVideo extends EventTarget {
  muted = false;
  playsInline = false;
  autoplay = false;
  srcObject: unknown = null;
  videoWidth = 0;
  videoHeight = 0;
  readyState = 0;
  currentTime = 0;
  paused = true;
  private frameCbs = new Map<number, (now: number, meta: { mediaTime: number; width: number; height: number }) => void>();
  private nextHandle = 1;
  constructor(private readonly size: { width: number; height: number }) {
    super();
  }
  setAttribute(): void {}
  async play(): Promise<void> {
    this.paused = false;
    this.videoWidth = this.size.width;
    this.videoHeight = this.size.height;
    this.readyState = 4;
    this.dispatchEvent(new Event("loadedmetadata"));
  }
  pause(): void {
    this.paused = true;
  }
  requestVideoFrameCallback(cb: (now: number, meta: { mediaTime: number; width: number; height: number }) => void): number {
    const h = this.nextHandle++;
    this.frameCbs.set(h, cb);
    return h;
  }
  cancelVideoFrameCallback(h: number): void {
    this.frameCbs.delete(h);
  }
  /** A new frame from the camera: every waiting callback runs once. */
  frame(): void {
    this.currentTime += 1 / 30;
    const cbs = [...this.frameCbs.values()];
    this.frameCbs.clear();
    for (const cb of cbs) cb(0, { mediaTime: this.currentTime, width: this.videoWidth, height: this.videoHeight });
  }
  get waiting(): number {
    return this.frameCbs.size;
  }
}

export interface FakeLiveCameraOptions {
  /** The frame size the fake camera gives. */
  size?: { width: number; height: number };
  /** Start hidden. */
  hidden?: boolean;
  /** Refuse the next `getUserMedia` with a DOMException of this name ("NotAllowedError"…). */
  refuse?: string;
  /**
   * Faces, scripted: what every frame of a `live({ faces: true })` session finds (change it with
   * `setFaces`). Absent, faces are `"unsupported"` — as on a Potyro with no face finder.
   */
  faces?: Face[];
  /** Make loading the face finder fail with this code. */
  facesFail?: FacesFailure;
  /** What `LiveCamera.graphics` says ("unknown" when absent). */
  graphics?: "gpu" | "software" | "unknown";
}

export interface FakeLiveCamera {
  cap: LiveCameraCap;
  /** Every constraint `getUserMedia` was asked with. */
  asked: MediaStreamConstraints[];
  /** The tracks handed out, newest last. */
  tracks: FakeTrack[];
  /** The videos made, newest last; `.frame()` pushes a frame. */
  videos: FakeVideo[];
  /** Hide or show the page (fires `visibilitychange`). */
  setHidden(hidden: boolean): void;
  /** The page going away (`pagehide`). */
  close(): void;
  /** Script the next refusal. */
  refuseNext(name: string): void;
  /** Hold the next `getUserMedia` until `release()` — a prompt the person has not answered yet. */
  holdNext(): { release(): void };
  /** What the scripted face finder finds from now on. */
  setFaces(faces: Face[]): void;
  /** How many times the face finder was loaded, and asked. */
  faceCalls: { loads: number; finds: number };
  /** The stills taken for `sameFrame` (each `{ time, closed }`, `time` the video's then), newest last. */
  stills: Array<{ time: number; closed: boolean }>;
}

export function createFakeLiveCamera(opts: FakeLiveCameraOptions = {}): FakeLiveCamera {
  const size = opts.size ?? { width: 640, height: 480 };
  const doc = Object.assign(new EventTarget(), { hidden: opts.hidden ?? false });
  const win = new EventTarget();
  const asked: MediaStreamConstraints[] = [];
  const tracks: FakeTrack[] = [];
  const videos: FakeVideo[] = [];
  let refuse = opts.refuse;
  let hold: Promise<void> | null = null;
  let faces = opts.faces;
  const faceCalls = { loads: 0, finds: 0 };
  const stills: Array<{ time: number; closed: boolean }> = [];
  const finder = scriptedFinder(() => {
    faceCalls.finds++;
    return faces ?? [];
  });

  const cap = createLiveCamera({
    getUserMedia: async (c) => {
      asked.push(c);
      if (hold) {
        const h = hold;
        hold = null;
        await h;
      }
      if (refuse) {
        const name = refuse;
        refuse = undefined;
        throw Object.assign(new Error(name), { name });
      }
      const facing = ((c.video as { facingMode?: { ideal?: string } })?.facingMode?.ideal ?? "user") as string;
      const track = new FakeTrack(facing);
      tracks.push(track);
      return new FakeStream(track) as unknown as MediaStream;
    },
    doc: doc as unknown as LiveCameraFakeDoc,
    win: win as unknown as { addEventListener(type: "pagehide", fn: () => void): void },
    makeVideo: () => {
      const v = new FakeVideo(size);
      videos.push(v);
      return v as unknown as HTMLVideoElement;
    },
    makeCanvas: (w, h) =>
      ({
        width: w,
        height: h,
        getContext: () => ({ drawImage: () => undefined }),
        toBlob: (cb: (b: Blob | null) => void, type?: string) => cb(new Blob([new Uint8Array([w % 256, h % 256])], { type: type ?? "image/png" })),
      }) as unknown as HTMLCanvasElement,
    nextFrame: (cb) => {
      const t = setTimeout(cb, 0);
      return () => clearTimeout(t);
    },
    metadataTimeoutMs: 50,
    grab: async (video) => {
      const still = { time: video.currentTime * 1000, closed: false };
      stills.push(still);
      return { width: video.videoWidth, height: video.videoHeight, time: still.time, close: () => (still.closed = true) } as unknown as ImageBitmap;
    },
    graphics: () => opts.graphics ?? "unknown",
    ...(opts.faces || opts.facesFail
      ? {
          faces: async () => {
            faceCalls.loads++;
            if (opts.facesFail) throw Object.assign(new Error("no faces"), { code: opts.facesFail });
            return finder;
          },
        }
      : {}),
  });

  return {
    cap,
    asked,
    tracks,
    videos,
    setHidden(hidden) {
      doc.hidden = hidden;
      doc.dispatchEvent(new Event("visibilitychange"));
    },
    close() {
      win.dispatchEvent(new Event("pagehide"));
    },
    refuseNext(name) {
      refuse = name;
    },
    setFaces(next) {
      faces = next;
    },
    faceCalls,
    stills,
    holdNext() {
      let release!: () => void;
      hold = new Promise<void>((r) => (release = r));
      return { release: () => release() };
    },
  };
}

type LiveCameraFakeDoc = { readonly hidden: boolean; addEventListener(type: "visibilitychange", fn: () => void): void };
