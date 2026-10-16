// The live camera (docs/25): one getUserMedia session per page, the frames it gives, and the rules
// that stop it. The host hands it to trusted apps as `ctx.caps.camera.live`; the shell watches it for
// the "Camera on" indicator and stops it when the person leaves an app.
//
// ONE PER PAGE (`sharedLiveCamera()`), whatever number of `Capabilities` objects exist: the Studio's
// preview builds capabilities of its own, and a session started there must be one the indicator sees
// and the stop rules reach. Every browser dependency is an argument (`createLiveCamera(deps)`), so the
// rules are tested without a browser.
//
// The rules, all here rather than in the app:
//   - it never starts while the page is hidden;
//   - it stops when the page is hidden ("hidden") or goes away ("closed"), when the device ends the
//     track ("ended"), when a newer `start` takes over ("replaced"), and when the shell says so;
//   - it never restarts by itself — the app hears `onStop` and asks the person.

import type { Face, FacesFailure, LiveCamera, LiveCameraFailure, LiveCameraOptions, LiveCameraStop, LiveFrameInfo } from "potyro";
import { facesFailureOf, graphicsOf, type FaceFinder, type FaceLoader, type FindOptions } from "./faces.js";

/** The platform half of `ctx.caps.camera.live` (docs/05). */
export interface LiveCameraCap {
  /** Start the camera; a running session is stopped first ("replaced"). */
  start(opts?: LiveCameraOptions): Promise<LiveCamera>;
  /** The running session, if any. */
  current(): LiveCamera | null;
  /** Told the running session (or `null`) now and on every change. Returns the way to stop listening. */
  subscribe(fn: (on: LiveCamera | null) => void): () => void;
  /** Stop whatever runs — the shell's Turn off ("person"), leaving an app ("closed"). */
  stopAll(why: LiveCameraStop): void;
  /**
   * How faces are found when a session asks for them (`live({ faces: true })`): the shell's loader,
   * called the first time a session wants faces. With none, those frames say `"unsupported"`.
   */
  useFaces(loader: FaceLoader | null): void;
}

/** What the live camera needs from a browser. `createLiveCamera` is given these; tests give fakes. */
export interface LiveCameraDeps {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  /** The document: `hidden`, and its `visibilitychange`. */
  doc: { readonly hidden: boolean; addEventListener(type: "visibilitychange", fn: () => void): void };
  /** The window: its `pagehide`. */
  win: { addEventListener(type: "pagehide", fn: () => void): void };
  /** A fresh `<video>` (never put in the page by this module). */
  makeVideo(): HTMLVideoElement;
  /** A canvas of this size, for `snap`. */
  makeCanvas(width: number, height: number): HTMLCanvasElement;
  /** The next animation frame, where the video has no `requestVideoFrameCallback`. */
  nextFrame(cb: () => void): () => void;
  /** How long to wait for the first frame's size. */
  metadataTimeoutMs?: number;
  /** How faces are found, until `useFaces` says otherwise. */
  faces?: FaceLoader;
  /**
   * A still of the video's current frame, for `faces: { sameFrame: true }`. Called in the same task
   * as the find, so both see the same picture.
   */
  grab?(video: HTMLVideoElement): Promise<ImageBitmap>;
  /** What draws on this page (`LiveCamera.graphics`); asked once, the first time a session starts. */
  graphics?(): "gpu" | "software" | "unknown";
}

/** What a session asked of faces: the finder's options and whether frames wait for their faces. */
export interface SessionFaces extends FindOptions {
  sameFrame: boolean;
}

export const LIVE_MIN = 160;
export const LIVE_MAX = 1920;
const DEFAULT_SIZE = { width: 640, height: 480 };

const clampSize = (v: number | undefined, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(LIVE_MAX, Math.max(LIVE_MIN, v))) : fallback;

/** The constraints a `start` asks for: video only, never audio. Pure, for the tests. */
export function liveConstraints(opts: LiveCameraOptions = {}): MediaStreamConstraints {
  const facing = opts.facing === "environment" ? "environment" : "user";
  return {
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: clampSize(opts.width, DEFAULT_SIZE.width) },
      height: { ideal: clampSize(opts.height, DEFAULT_SIZE.height) },
    },
  };
}

/** What `live({ faces })` asked for, or `null` for no faces. */
export function faceOptions(opt: LiveCameraOptions["faces"]): SessionFaces | null {
  if (!opt) return null;
  const o = typeof opt === "object" ? opt : {};
  const max = typeof o.max === "number" && Number.isFinite(o.max) ? Math.round(Math.min(4, Math.max(1, o.max))) : 1;
  return { max, points: o.points === true, detail: o.detail === "high" ? "high" : "normal", sameFrame: o.sameFrame === true };
}

/** An error an app can tell apart by `code`; the message is for the log. */
export function liveCameraError(code: LiveCameraFailure, message: string): Error & { code: LiveCameraFailure } {
  return Object.assign(new Error(message), { code });
}

/** A `getUserMedia` refusal, by its DOMException name, in the five kinds an app handles. */
export function failureOf(err: unknown): Error & { code: LiveCameraFailure } {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  const why = err instanceof Error && err.message ? `: ${err.message}` : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
    return liveCameraError("denied", `Camera access was not allowed${why}`);
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError")
    return liveCameraError("missing", `No camera was found on this device${why}`);
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError")
    return liveCameraError("busy", `The camera is in use or could not start${why}`);
  return liveCameraError("failed", `The camera could not start${why}`);
}

interface VideoFrameMeta {
  mediaTime: number;
  width: number;
  height: number;
}
type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: VideoFrameMeta) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/** An exception in an app's callback must not stop the frames: rethrown on its own, it is reported. */
function report(e: unknown): void {
  queueMicrotask(() => {
    throw e;
  });
}

/** Resolves once the video knows its size, or rejects after `ms`. */
function sized(video: HTMLVideoElement, ms: number): Promise<void> {
  if (video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      if (video.videoWidth <= 0) return;
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", done);
      video.removeEventListener("resize", done);
      resolve();
    };
    const timer = setTimeout(() => {
      video.removeEventListener("loadedmetadata", done);
      video.removeEventListener("resize", done);
      reject(liveCameraError("failed", "The camera gave no picture"));
    }, ms);
    video.addEventListener("loadedmetadata", done);
    video.addEventListener("resize", done);
  });
}

class Session implements LiveCamera {
  private alive = true;
  private readonly frameFns = new Set<(video: HTMLVideoElement, info: LiveFrameInfo) => void>();
  private readonly stopFns = new Set<(why: LiveCameraStop) => void>();
  private cancelFrame: (() => void) | null = null;
  private lastTime = -1;
  // Faces, when asked for: the finder once loaded, the last faces found, and whether one is being found.
  private finder: FaceFinder | null = null;
  private faces: Face[] = [];
  /** The `time` of the frame `faces` were found in; absent until a find has answered. */
  private facesTime: number | undefined;
  private facesFailed: FacesFailure | undefined;
  private finding = false;

  constructor(
    readonly video: FrameVideo,
    readonly stream: MediaStream,
    readonly facing: "user" | "environment",
    private readonly deps: LiveCameraDeps,
    private readonly ended: (s: Session) => void,
    private readonly wantFaces: SessionFaces | null = null,
    loadFaces: FaceLoader | null = null,
    readonly graphics: "gpu" | "software" | "unknown" = "unknown",
  ) {
    for (const track of stream.getVideoTracks()) track.addEventListener("ended", () => this.halt("ended"));
    if (!wantFaces) return;
    if (!loadFaces) {
      this.facesFailed = "unsupported";
      return;
    }
    // Loaded once per page by the shell; the camera's frames flow (with no faces yet) meanwhile.
    loadFaces().then(
      (f) => {
        if (this.alive) this.finder = f;
      },
      (e) => {
        this.facesFailed = facesFailureOf(e);
      },
    );
  }

  get width(): number {
    return this.video.videoWidth;
  }
  get height(): number {
    return this.video.videoHeight;
  }
  get active(): boolean {
    return this.alive;
  }

  onFrame(cb: (video: HTMLVideoElement, info: LiveFrameInfo) => void): () => void {
    if (typeof cb !== "function") throw new TypeError("onFrame needs a function");
    if (!this.alive) return () => undefined;
    this.frameFns.add(cb);
    if (!this.cancelFrame) this.schedule();
    return () => {
      this.frameFns.delete(cb);
    };
  }

  onStop(cb: (why: LiveCameraStop) => void): () => void {
    if (typeof cb !== "function") throw new TypeError("onStop needs a function");
    this.stopFns.add(cb);
    return () => {
      this.stopFns.delete(cb);
    };
  }

  async snap(opts: { type?: "image/jpeg" | "image/png" | "image/webp"; quality?: number } = {}): Promise<Blob> {
    if (!this.alive) throw liveCameraError("failed", "The camera is off");
    const w = this.width;
    const h = this.height;
    if (!w || !h) throw liveCameraError("failed", "The camera has no picture yet");
    const canvas = this.deps.makeCanvas(w, h);
    const g = canvas.getContext("2d");
    if (!g) throw liveCameraError("failed", "Could not draw the camera's picture");
    g.drawImage(this.video, 0, 0, w, h);
    const type = opts.type ?? "image/jpeg";
    const quality = typeof opts.quality === "number" ? Math.min(1, Math.max(0, opts.quality)) : 0.92;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob) throw liveCameraError("failed", "Could not make a picture of the camera's frame");
    return blob;
  }

  stop(): void {
    this.halt("app");
  }

  /** Stop for a reason: once, whoever asks first. */
  halt(why: LiveCameraStop): void {
    if (!this.alive) return;
    this.alive = false;
    this.cancelFrame?.();
    this.cancelFrame = null;
    this.frameFns.clear();
    for (const track of this.stream.getTracks()) track.stop();
    try {
      this.video.pause();
    } catch {
      /* a video that never played has nothing to pause */
    }
    this.video.srcObject = null;
    this.ended(this);
    const fns = [...this.stopFns];
    this.stopFns.clear();
    for (const fn of fns) {
      try {
        fn(why);
      } catch (e) {
        report(e);
      }
    }
  }

  /** One frame loop for every listener, running only while someone listens. */
  private schedule(): void {
    if (!this.alive || this.frameFns.size === 0) {
      this.cancelFrame = null;
      return;
    }
    const v = this.video;
    if (typeof v.requestVideoFrameCallback === "function") {
      const handle = v.requestVideoFrameCallback((_now, meta) => {
        this.emit({ time: meta.mediaTime * 1000, width: meta.width || v.videoWidth, height: meta.height || v.videoHeight });
        this.schedule();
      });
      this.cancelFrame = () => v.cancelVideoFrameCallback?.(handle);
      return;
    }
    this.cancelFrame = this.deps.nextFrame(() => {
      // An animation frame is not a video frame: only a frame the video has moved on to is new.
      if (v.readyState >= 2 && v.currentTime !== this.lastTime) {
        this.lastTime = v.currentTime;
        this.emit({ time: v.currentTime * 1000, width: v.videoWidth, height: v.videoHeight });
      }
      this.schedule();
    });
  }

  /**
   * Find faces in this frame unless a find is still running — never more than one at a time, so a
   * slow device skips frames instead of queueing them, and drawing never waits: each frame carries
   * the latest faces found (a frame or two old while one is being found).
   */
  private findFaces(time: number): Promise<boolean> | null {
    const finder = this.finder;
    if (!finder || this.finding || !this.wantFaces) return null;
    this.finding = true;
    let pending: Promise<Face[]>;
    try {
      pending = finder.find(this.video, time, this.wantFaces);
    } catch (e) {
      pending = Promise.reject(e);
    }
    return pending.then(
      (found) => {
        this.finding = false;
        if (!this.alive) return false;
        this.faces = found;
        this.facesTime = time;
        return true;
      },
      (e) => {
        this.finding = false;
        this.finder = null;
        this.faces = [];
        this.facesTime = undefined;
        this.facesFailed = facesFailureOf(e);
        return false;
      },
    );
  }

  /**
   * `sameFrame`: a frame is handed on only once its own faces are found, with a still of it — the
   * video itself will have moved on by then. Frames that come while a find runs are not handed on.
   */
  private emitInStep(frame: LiveFrameInfo): void {
    if (this.finding) return;
    // The still first, then the find, in this same task: both are of the frame now on the video.
    let still: Promise<ImageBitmap | null>;
    try {
      still = this.deps.grab ? this.deps.grab(this.video).catch(() => null) : Promise.resolve(null);
    } catch {
      still = Promise.resolve(null);
    }
    const found = this.findFaces(frame.time);
    if (!found) return;
    void Promise.all([found, still]).then(([ok, bitmap]) => {
      if (ok && this.alive) {
        const info: LiveFrameInfo = { ...frame, faces: this.faces, facesTime: frame.time };
        if (bitmap) info.frame = bitmap;
        this.deliver(info);
      } else if (this.alive) {
        // The finder broke on this frame: say so on it, and carry on as an ordinary camera.
        this.deliver(this.withFaces(frame));
      }
      bitmap?.close();
    });
  }

  private withFaces(frame: LiveFrameInfo): LiveFrameInfo {
    const info: LiveFrameInfo = { ...frame, faces: this.faces };
    if (this.facesTime !== undefined) info.facesTime = this.facesTime;
    if (this.facesFailed) info.facesFailed = this.facesFailed;
    return info;
  }

  private emit(frame: LiveFrameInfo): void {
    if (!this.wantFaces) return this.deliver(frame);
    // Until the finder is ready (or once it has failed) frames flow as usual, with no faces.
    if (this.wantFaces.sameFrame && this.finder) return this.emitInStep(frame);
    void this.findFaces(frame.time);
    this.deliver(this.withFaces(frame));
  }

  private deliver(info: LiveFrameInfo): void {
    for (const fn of [...this.frameFns]) {
      if (!this.alive) return;
      try {
        fn(this.video, info);
      } catch (e) {
        report(e);
      }
    }
  }
}

export function createLiveCamera(deps: LiveCameraDeps): LiveCameraCap {
  let current: Session | null = null;
  let seq = 0;
  let loadFaces: FaceLoader | null = deps.faces ?? null;
  let graphics: "gpu" | "software" | "unknown" | undefined;
  const watchers = new Set<(on: LiveCamera | null) => void>();
  const tell = () => {
    for (const fn of [...watchers]) {
      try {
        fn(current);
      } catch (e) {
        report(e);
      }
    }
  };
  const ended = (s: Session) => {
    if (current !== s) return;
    current = null;
    tell();
  };
  const stopAll = (why: LiveCameraStop) => {
    // A start still waiting on the browser is superseded too: it must not light up after this.
    seq++;
    current?.halt(why);
  };

  deps.doc.addEventListener("visibilitychange", () => {
    if (deps.doc.hidden) stopAll("hidden");
  });
  deps.win.addEventListener("pagehide", () => stopAll("closed"));

  return {
    current: () => current,
    subscribe(fn) {
      watchers.add(fn);
      fn(current);
      return () => {
        watchers.delete(fn);
      };
    },
    stopAll,
    useFaces(loader) {
      loadFaces = loader;
    },
    async start(opts = {}) {
      if (deps.doc.hidden) throw liveCameraError("hidden", "The camera only starts while the app is on screen");
      const mine = ++seq;
      // Before asking for the new one: a phone opens one camera at a time.
      current?.halt("replaced");
      const constraints = liveConstraints(opts);
      let stream: MediaStream;
      try {
        stream = await deps.getUserMedia(constraints);
      } catch (e) {
        throw failureOf(e);
      }
      const drop = (err: Error) => {
        for (const track of stream.getTracks()) track.stop();
        return err;
      };
      const superseded = () =>
        deps.doc.hidden
          ? liveCameraError("hidden", "The app left the screen while the camera was starting")
          : liveCameraError("failed", "A newer start took over the camera");
      if (mine !== seq || deps.doc.hidden) throw drop(superseded());

      const video = deps.makeVideo() as FrameVideo;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.setAttribute("playsinline", "");
      video.srcObject = stream;
      try {
        await video.play();
        await sized(video, deps.metadataTimeoutMs ?? 5_000);
      } catch (e) {
        video.srcObject = null;
        throw drop(e instanceof Error && "code" in e ? e : liveCameraError("failed", `The camera's picture would not play: ${String(e)}`));
      }
      if (mine !== seq || deps.doc.hidden) {
        video.srcObject = null;
        throw drop(superseded());
      }
      const requested = constraints.video as { facingMode: { ideal: "user" | "environment" } };
      const said = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
      const facing = said === "environment" || said === "user" ? said : requested.facingMode.ideal;
      graphics ??= deps.graphics ? deps.graphics() : "unknown";
      const session = new Session(video, stream, facing, deps, ended, faceOptions(opts.faces), loadFaces, graphics);
      current = session;
      // A track that ended while we were starting (a camera unplugged mid-prompt) ends the session now.
      if (stream.getVideoTracks().some((t) => t.readyState === "ended")) session.halt("ended");
      else tell();
      return session;
    },
  };
}

let shared: LiveCameraCap | null | undefined;

/**
 * The page's one live camera, or `null` where the browser has no `getUserMedia` (an insecure origin,
 * a test without a DOM).
 */
export function sharedLiveCamera(): LiveCameraCap | null {
  if (shared !== undefined) return shared;
  const media = globalThis.navigator?.mediaDevices;
  if (typeof document === "undefined" || typeof window === "undefined" || typeof media?.getUserMedia !== "function") {
    shared = null;
    return shared;
  }
  shared = createLiveCamera({
    getUserMedia: (c) => media.getUserMedia(c),
    doc: document,
    win: window,
    makeVideo: () => document.createElement("video"),
    makeCanvas: (w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    },
    nextFrame: (cb) => {
      const id = requestAnimationFrame(() => cb());
      return () => cancelAnimationFrame(id);
    },
    grab: (video) => createImageBitmap(video),
    graphics: () => graphicsOf(() => document.createElement("canvas")),
  });
  return shared;
}
