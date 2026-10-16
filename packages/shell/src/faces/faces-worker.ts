// The face finder's worker (docs/25 §Faces): MediaPipe's Face Landmarker, off the page's thread, so
// finding a face never holds up drawing one.
//
// Everything it loads is Potyro's own, from the shell's origin (`/potyro-faces/…`, faces-assets.ts):
// the Wasm runtime and the model. Nothing is fetched from a CDN, so it works offline once the service
// worker has seen the files (they are cached on first use, never precached for everyone).
//
// Messages: `{ type: "init", base, model, max, shapes }` → `{ type: "ready", delegate }` or `{ type: "error",
// code, message }`; `{ type: "find", id, frame, time, max }` (an ImageBitmap, transferred) → `{ type:
// "found", id, faces: [{ points, shapes, matrix? }] }`, the arrays transferred back.

import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from "@mediapipe/tasks-vision";

type In =
  | { type: "init"; base: string; model: string; max: number; shapes: string[] }
  | { type: "find"; id: number; frame: ImageBitmap; time: number; max: number };

const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<In>) => void) | null;
};

// MediaPipe's runtime talks: glog lines ("I1015 …", "W1015 …"), "Graph successfully started running",
// TensorFlow Lite's "INFO: Created … delegate" — on console.log, .warn and even .error, in every
// session. None of it is for the person or the app, and a failure reaches the page as a message
// (`error`) anyway. Only its own errors ("E…" lines and anything else) are kept, as warnings.
const CHATTER = /^(?:[IW]\d{4} |INFO: |Graph successfully|Initialized TensorFlow|Created TensorFlow)/;
for (const level of ["log", "info", "debug", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (level === "log" || level === "info" || level === "debug" || CHATTER.test(first)) return;
    (level === "error" ? console.warn : original)(...args);
  };
}

let landmarker: FaceLandmarker | null = null;
let numFaces = 1;
let delegate: "GPU" | "CPU" = "GPU";
/** Whether the GPU is still on trial (`retune`). */
let tuning = false;
/** The GPU's first finds, timed: a GPU that is really software (a VM, a blocklisted driver) is slower than the CPU. */
const gpuTimes: number[] = [];
const TUNE_FRAMES = 4;
const SLOW_GPU_MS = 45;
let lastTime = -1;
/** The landmarker's graph being rebuilt on the CPU: a find waits for it rather than run mid-rebuild. */
let rebuilding: Promise<void> | null = null;
/** The blendshapes the page reads, in its order (`SHAPES` in @potyro/capabilities). */
let wanted: string[] = [];

/**
 * Whether this worker's WebGL is the GPU or a software stand-in (SwiftShader, llvmpipe — a VM, a
 * headless browser, a driver the browser blocklists). A software "GPU" is many times slower than the
 * CPU path, and while it grinds it holds up the page's own drawing, which shares it.
 */
function gpuIsReal(): boolean {
  try {
    if (typeof OffscreenCanvas === "undefined") return false;
    const gl = new OffscreenCanvas(1, 1).getContext("webgl2");
    if (!gl) return false;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return !/swiftshader|llvmpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
  }
}

async function init(msg: Extract<In, { type: "init" }>): Promise<void> {
  // A module worker (dev and build alike): the runtime's module build, loaded with import().
  if (!(await FilesetResolver.isSimdSupported(true))) {
    scope.postMessage({ type: "error", code: "unsupported", message: "This device's WebAssembly has no SIMD" });
    return;
  }
  const name = "vision_wasm_module_internal";
  const fileset = { wasmLoaderPath: `${msg.base}${name}.js`, wasmBinaryPath: `${msg.base}${name}.wasm` };
  const res = await fetch(msg.model);
  if (!res.ok) throw new Error(`The face model would not load (${res.status})`);
  const model = new Uint8Array(await res.arrayBuffer());
  numFaces = msg.max;
  wanted = msg.shapes;
  const make = (d: "GPU" | "CPU") =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: model, delegate: d },
      runningMode: "VIDEO",
      numFaces,
      outputFaceBlendshapes: true,
      // Where the head is in 3D (`Face.matrix`): a small solve on the mesh beside the find.
      outputFacialTransformationMatrixes: true,
    });
  try {
    if (!gpuIsReal()) throw new Error("no hardware GPU in this worker");
    landmarker = await make("GPU");
    delegate = "GPU";
    tuning = true;
  } catch {
    // No WebGL2 in a worker here, a software one, or a GPU the runtime refuses: the CPU is always there.
    delegate = "CPU";
    landmarker = await make("CPU");
  }
  scope.postMessage({ type: "ready", delegate });
}

/** After the GPU's first finds: if it is slower than a CPU would be, move to the CPU for good. */
async function retune(ms: number): Promise<void> {
  if (delegate !== "GPU" || !tuning) return;
  gpuTimes.push(ms);
  if (gpuTimes.length < TUNE_FRAMES) return;
  const sorted = [...gpuTimes.slice(1)].sort((a, b) => a - b); // the first find warms up
  const median = sorted[Math.floor(sorted.length / 2)]!;
  tuning = false; // decided, either way
  if (median <= SLOW_GPU_MS || !landmarker) return;
  // The same landmarker, its graph rebuilt on the CPU (a second instance beside the GPU's would not start).
  rebuilding = landmarker.setOptions({ baseOptions: { delegate: "CPU" } }).finally(() => (rebuilding = null));
  await rebuilding;
  delegate = "CPU";
}

function pack(result: FaceLandmarkerResult): { points: Float32Array; shapes: Float32Array; matrix?: Float32Array }[] {
  return result.faceLandmarks.map((marks, i) => {
    const points = new Float32Array(marks.length * 3);
    marks.forEach((m, j) => points.set([m.x, m.y, m.z], j * 3));
    const shapes = new Float32Array(wanted.length);
    for (const c of result.faceBlendshapes[i]?.categories ?? []) {
      const k = wanted.indexOf(c.categoryName);
      if (k >= 0) shapes[k] = c.score;
    }
    // 4×4, column-major as MediaPipe packs it (`MatrixData`'s default layout).
    const m = result.facialTransformationMatrixes?.[i];
    return m && m.rows === 4 && m.columns === 4 && m.data.length === 16 ? { points, shapes, matrix: Float32Array.from(m.data) } : { points, shapes };
  });
}

async function find(msg: Extract<In, { type: "find" }>): Promise<void> {
  const frame = msg.frame;
  try {
    if (rebuilding) await rebuilding.catch(() => undefined);
    if (!landmarker) throw new Error("The face finder is not ready");
    if (msg.max !== numFaces) {
      numFaces = msg.max;
      await landmarker.setOptions({ numFaces });
    }
    // The landmarker tracks across frames and needs its timestamps to keep rising.
    const time = Math.max(lastTime + 1, Math.round(msg.time));
    lastTime = time;
    const began = performance.now();
    const faces = pack(landmarker.detectForVideo(frame, time));
    scope.postMessage({ type: "found", id: msg.id, faces, delegate }, faces.flatMap((f) => [f.points.buffer, f.shapes.buffer, ...(f.matrix ? [f.matrix.buffer] : [])]));
    // A GPU that cannot be moved keeps finding faces where it is.
    if (tuning) void retune(performance.now() - began).catch(() => undefined);
  } catch (e) {
    scope.postMessage({ type: "found", id: msg.id, error: e instanceof Error ? e.message : String(e) });
  } finally {
    frame.close();
  }
}

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "init")
    init(msg).catch((err: unknown) => scope.postMessage({ type: "error", code: "failed", message: err instanceof Error ? err.message : String(err) }));
  else if (msg.type === "find") void find(msg);
};
