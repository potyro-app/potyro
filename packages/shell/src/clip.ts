// A 15-second clip of an app, for people to post where they post videos (docs/24 §8).
//
// Two ways, whichever this browser has, and a plain "it cannot" where it has neither:
//   - canvas: an app that draws on a <canvas> is recorded straight from it (`captureStream`). No
//     prompt — it is this page's own pixels.
//   - tab: anything else asks to record this tab (`getDisplayMedia`, Chrome and Edge on a computer),
//     cropped to the app where the browser can (Region Capture).
// Nothing is uploaded: the clip becomes a file the person saves.

export const CLIP_SECONDS = 15;

export type ClipWay = "canvas" | "tab" | "none";

export interface ClipEnv {
  hasMediaRecorder: boolean;
  /** The app draws on a canvas this browser can record. */
  canvas: boolean;
  hasDisplayMedia: boolean;
}

/** How this browser can record an app — or that it cannot. */
export function clipWay(env: ClipEnv): ClipWay {
  if (!env.hasMediaRecorder) return "none";
  if (env.canvas) return "canvas";
  if (env.hasDisplayMedia) return "tab";
  return "none";
}

/** MP4 where the browser can write it (every network takes it), else WebM. */
export function pickMime(isTypeSupported: (type: string) => boolean): { mime: string; ext: "mp4" | "webm" } | null {
  for (const mime of ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
    if (isTypeSupported(mime)) return { mime, ext: mime.startsWith("video/mp4") ? "mp4" : "webm" };
  }
  return null;
}

/** The app's biggest canvas, when it has one big enough to be what the app is. */
function appCanvas(root: Element | null): HTMLCanvasElement | null {
  if (!root) return null;
  const canvases = [...root.querySelectorAll("canvas")].filter((c) => typeof c.captureStream === "function" && c.width * c.height >= 120 * 120);
  return canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
}

/** What this browser can do for this app, now. */
export function clipEnvFor(root: Element | null): ClipEnv {
  return {
    hasMediaRecorder: typeof globalThis.MediaRecorder === "function",
    canvas: Boolean(appCanvas(root)),
    hasDisplayMedia: typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function",
  };
}

export interface Recording {
  /** Stop early; the clip so far is kept. */
  stop(): void;
  /** The clip, once it has stopped. */
  done: Promise<{ blob: Blob; ext: "mp4" | "webm" }>;
}

interface CropCapable {
  cropTo?(target: unknown): Promise<void>;
}

/** Start recording. Throws (in the browser's words) when the person declines, or recording cannot start. */
export async function startClip(root: Element | null, opts: { seconds?: number; onTick?: (left: number) => void } = {}): Promise<Recording> {
  const way = clipWay(clipEnvFor(root));
  if (way === "none") throw new Error("cannot record here");
  const picked = pickMime((t) => MediaRecorder.isTypeSupported(t));
  if (!picked) throw new Error("no video format");
  let stream: MediaStream;
  if (way === "canvas") {
    stream = appCanvas(root)!.captureStream(30);
  } else {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
      // Chrome: offer this tab first, and let it be chosen.
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    } as DisplayMediaStreamOptions);
    // Only the app, not the browser around it, where the browser can crop to an element.
    const CropTarget = (globalThis as unknown as { CropTarget?: { fromElement(el: Element): Promise<unknown> } }).CropTarget;
    const track = stream.getVideoTracks()[0] as (MediaStreamTrack & CropCapable) | undefined;
    if (CropTarget && root && track?.cropTo) await track.cropTo(await CropTarget.fromElement(root)).catch(() => {});
  }
  const recorder = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const seconds = opts.seconds ?? CLIP_SECONDS;
  let left = seconds;
  opts.onTick?.(left);
  const tick = setInterval(() => {
    left -= 1;
    opts.onTick?.(Math.max(0, left));
    if (left <= 0) stop();
  }, 1000);
  const done = new Promise<{ blob: Blob; ext: "mp4" | "webm" }>((resolve, reject) => {
    recorder.onstop = () => {
      for (const t of stream.getTracks()) t.stop();
      const blob = new Blob(chunks, { type: picked.mime.split(";")[0] });
      if (blob.size) resolve({ blob, ext: picked.ext });
      else reject(new Error("nothing was recorded"));
    };
    recorder.onerror = () => reject(new Error("the recording failed"));
  });
  function stop(): void {
    clearInterval(tick);
    if (recorder.state !== "inactive") recorder.stop();
  }
  // The person stopping the tab share from the browser's own bar ends the clip too.
  stream.getVideoTracks()[0]?.addEventListener("ended", stop);
  recorder.start(250);
  return { stop, done };
}
