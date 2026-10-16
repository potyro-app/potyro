// The face finder the shell gives the live camera (docs/25 §Faces). Loaded the first time an app asks
// for faces — never before, so nobody who does not use faces downloads the model — and once per page.
// The finding runs in a worker (faces-worker.ts); this side hands it each frame as an ImageBitmap,
// and turns the raw mesh it sends back into `Face`s (`faceFrom`, @potyro/capabilities).
//
// In the dev server only, `localStorage["potyro:faces"] = "script"` swaps the model for faces read from
// `localStorage["potyro:faces-script"]` — a JSON list of `FaceSketch`es in FRACTIONS of the frame —
// so the browser tests can say exactly where a face is without a model.

import { SHAPES, faceFrom, scriptedFinder, sketchFace, type FaceFinder, type FaceLoader, type FaceSketch, type RawFace } from "@potyro/capabilities";
import type { Face } from "potyro";
import { FACES_DIR, FACES_MODEL } from "./faces-assets.js";

/** How long the runtime and the model may take to arrive and start, before faces are given up. */
const INIT_TIMEOUT_MS = 90_000;
/**
 * The long side a frame is shrunk to before it crosses to the worker: the landmarker reads the face
 * at 256 px, so 640 is plenty for a face that fills a good part of the picture. `detail: "high"`
 * sends the camera's whole picture (up to its 1920), for a small or far face.
 */
const FRAME_MAX = 640;
const FRAME_MAX_HIGH = 1920;

const unsupported = (why: string) => Object.assign(new Error(why), { code: "unsupported" });
const failed = (why: string) => Object.assign(new Error(why), { code: "failed" });

let loading: Promise<FaceFinder> | null = null;

/** The page's one face finder, loading it the first time. A failed load is tried again next time. */
export const loadFaces: FaceLoader = () => {
  if (!loading) {
    loading = (devScript() ?? startWorker()).catch((e: unknown) => {
      loading = null;
      throw e;
    });
  }
  return loading;
};

function devScript(): Promise<FaceFinder> | null {
  if (!import.meta.env.DEV) return null;
  let mode: string | null = null;
  try {
    mode = localStorage.getItem("potyro:faces");
  } catch {
    return null;
  }
  if (mode === "fail") return Promise.reject(failed("Faces are set to fail (dev)"));
  if (mode !== "script") return null;
  let size = { w: 640, h: 480 };
  const read = (): Face[] => {
    try {
      const sketches = JSON.parse(localStorage.getItem("potyro:faces-script") ?? "[]") as FaceSketch[];
      return sketches.map((s) => sketchFace({ ...s, x: s.x * size.w, y: s.y * size.h, size: s.size * size.w, frame: { width: size.w, height: size.h } }));
    } catch {
      return [];
    }
  };
  const inner = scriptedFinder(read);
  return Promise.resolve({
    find: (video, time, opts) => {
      size = { w: video.videoWidth || 640, h: video.videoHeight || 480 };
      return inner.find(video, time, opts);
    },
  });
}

function startWorker(): Promise<FaceFinder> {
  if (typeof Worker === "undefined" || typeof createImageBitmap !== "function" || typeof WebAssembly === "undefined")
    return Promise.reject(unsupported("This browser cannot run the face finder"));
  const base = `${import.meta.env.BASE_URL}${FACES_DIR}`;
  const worker = new Worker(new URL("./faces-worker.ts", import.meta.url), { type: "module" });
  let nextId = 1;
  let dead: Error | null = null;
  const waiting = new Map<number, { resolve: (raw: RawFace[]) => void; reject: (e: Error) => void }>();

  return new Promise<FaceFinder>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(failed("The face finder took too long to start"));
    }, INIT_TIMEOUT_MS);
    const finder: FaceFinder = {
      async find(video, time, opts) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (dead) throw dead;
        if (!vw || !vh) return [];
        const k = Math.min(1, (opts.detail === "high" ? FRAME_MAX_HIGH : FRAME_MAX) / Math.max(vw, vh));
        const frame = await createImageBitmap(video, { resizeWidth: Math.round(vw * k), resizeHeight: Math.round(vh * k), resizeQuality: "low" });
        const id = nextId++;
        const raw = await new Promise<RawFace[]>((ok, no) => {
          waiting.set(id, { resolve: ok, reject: no });
          worker.postMessage({ type: "find", id, frame, time, max: opts.max }, [frame]);
        });
        // Normalised to the frame, so the shrinking does not matter: back to the video's own pixels.
        return raw.map((r) => faceFrom(r, vw, vh, opts.points));
      },
    };
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as
        | { type: "ready" }
        | { type: "error"; code: string; message: string }
        | { type: "found"; id: number; faces?: RawFace[]; error?: string };
      if (m.type === "ready") {
        clearTimeout(timer);
        resolve(finder);
      } else if (m.type === "error") {
        clearTimeout(timer);
        worker.terminate();
        reject(m.code === "unsupported" ? unsupported(m.message) : failed(m.message));
      } else if (m.type === "found") {
        const w = waiting.get(m.id);
        waiting.delete(m.id);
        if (!w) return;
        if (m.faces) w.resolve(m.faces);
        else w.reject(failed(m.error ?? "The face finder failed"));
      }
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      e.preventDefault();
      const why = failed(`The face finder stopped: ${e.message || "worker error"}`);
      dead = why;
      for (const w of waiting.values()) w.reject(why);
      waiting.clear();
      reject(why);
    };
    worker.postMessage({ type: "init", base, model: `${base}${FACES_MODEL}`, max: 1, shapes: [...SHAPES] });
  });
}
