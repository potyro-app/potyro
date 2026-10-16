// Faces for the live camera (docs/25 §Faces): what a frame's `faces` are made from.
//
// The finding itself is the shell's — it owns loading MediaPipe's Face Landmarker, in a worker, from
// files Potyro ships (packages/shell/src/faces/). This module is the seam and the arithmetic: the
// `FaceFinder` a live session asks for each frame, and `faceFrom`, which turns the landmarker's raw
// mesh (478 normalised points and its blendshape scores) into the small `Face` an app reads. Pure, so
// it is tested without a browser or a model.

import type { Face, FaceEye, FaceExpressions, FaceMeshPoint, FacePoint, FacesFailure } from "potyro";

/** Finds faces in a frame. One call at a time: a live session never asks again before it answers. */
export interface FaceFinder {
  find(video: HTMLVideoElement, time: number, opts: FindOptions): Promise<Face[]>;
}
export interface FindOptions {
  /** 1–4. */
  max: number;
  /** Hand over every mesh point (`Face.points`). */
  points: boolean;
  /** `"high"`: find in the whole picture, not one shrunk to 640 px on its long side. */
  detail: "normal" | "high";
}
/** Loads the finder, once per page; rejects with `code` `"unsupported"` where faces cannot be found. */
export type FaceLoader = () => Promise<FaceFinder>;

/** The failure code a loader's or finder's rejection means. */
export function facesFailureOf(e: unknown): FacesFailure {
  const code = e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : undefined;
  return code === "unsupported" ? "unsupported" : "failed";
}

// ---- the mesh's numbering (MediaPipe face mesh, 478 points with the irises) ----
// "Left" and "right" are the person's own: their right eye is on the LEFT of an unmirrored picture.

export const MESH = {
  rightEye: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
  leftEye: [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
  /** Outer corner, inner corner, upper lid's middle, lower lid's middle, iris centre. */
  rightEyeKeys: { outer: 33, inner: 133, upper: 159, lower: 145, pupil: 468 },
  leftEyeKeys: { outer: 263, inner: 362, upper: 386, lower: 374, pupil: 473 },
  lipsOuter: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146],
  lipsInner: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95],
  mouthKeys: { right: 61, left: 291, top: 0, bottom: 17, innerTop: 13, innerBottom: 14 },
  nose: 1,
  /** From the nose outwards. */
  rightBrow: [107, 66, 105, 63, 70],
  leftBrow: [336, 296, 334, 293, 300],
  forehead: 10,
  chin: 152,
} as const;

/** The blendshapes `faceFrom` reads, in the order a raw face carries their scores. */
export const SHAPES = [
  "jawOpen",
  "mouthClose",
  "mouthSmileLeft",
  "mouthSmileRight",
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "browInnerUp",
  "browOuterUpLeft",
  "browOuterUpRight",
  "browDownLeft",
  "browDownRight",
  "mouthPucker",
  "cheekPuff",
] as const;

/**
 * A face as the landmarker gives it: x, y, z per mesh point (normalised to the frame; z on x's
 * scale), `SHAPES`' scores, and its facial transformation matrix (16, column-major) when it gave one.
 */
export interface RawFace {
  points: ArrayLike<number>;
  shapes: ArrayLike<number>;
  matrix?: ArrayLike<number>;
}

// ---- the head in 3D: the facial transformation matrix ----

/** The vertical field of view MediaPipe's face geometry assumes for the camera (its default environment). */
export const FACE_FOV_DEGREES = 63;
/** Points of MediaPipe's canonical face (centimetres; +x the person's left, +y up, +z out of the face). */
export const CANONICAL = {
  noseTip: { x: 0, y: -1.126865, z: 7.475604 },
  rightEyeOuter: { x: -4.445859, y: 2.663991, z: 3.173422 },
  leftEyeOuter: { x: 4.445859, y: 2.663991, z: 3.173422 },
  chin: { x: 0, y: -9.403378, z: 4.264492 },
} as const;

/**
 * A point of the canonical face -> the picture's pixels (`width` x `height`), through `Face.matrix`:
 * the arithmetic docs/25 gives apps, here so the fakes and the tests use exactly it.
 */
export function projectFacePoint(m: ArrayLike<number>, p: { x: number; y: number; z: number }, width: number, height: number, fovDegrees = FACE_FOV_DEGREES): FacePoint {
  const t = Math.tan(((fovDegrees / 2) * Math.PI) / 180);
  const X = m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!;
  const Y = m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!;
  const Z = m[2]! * p.x + m[6]! * p.y + m[10]! * p.z + m[14]!;
  return { x: ((1 + X / (-Z * t * (width / height))) / 2) * width, y: ((1 - Y / (-Z * t)) / 2) * height };
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const dist = (a: FacePoint, b: FacePoint) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: FacePoint, b: FacePoint): FacePoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** A raw face → the `Face` an app reads, in the video's pixels (`w`×`h`). */
export function faceFrom(raw: RawFace, w: number, h: number, withPoints = false): Face {
  const face = faceShape(raw, w, h);
  if (withPoints) {
    const n = Math.floor(raw.points.length / 3);
    face.points = Array.from({ length: n }, (_, i): FaceMeshPoint => ({ x: raw.points[i * 3]! * w, y: raw.points[i * 3 + 1]! * h, z: raw.points[i * 3 + 2]! * w }));
  }
  if (raw.matrix && raw.matrix.length === 16 && Array.from(raw.matrix).every(Number.isFinite)) face.matrix = Array.from(raw.matrix);
  return face;
}

function faceShape(raw: RawFace, w: number, h: number): Face {
  const n = Math.floor(raw.points.length / 3);
  const p = (i: number): FacePoint => (i < n ? { x: raw.points[i * 3]! * w, y: raw.points[i * 3 + 1]! * h } : { x: 0, y: 0 });
  const z = (i: number) => (i < n ? raw.points[i * 3 + 2]! * w : 0);
  const s = (name: (typeof SHAPES)[number]) => clamp01(raw.shapes[SHAPES.indexOf(name)] ?? 0);

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < Math.min(n, 468); i++) {
    const q = p(i);
    if (q.x < x0) x0 = q.x;
    if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y;
    if (q.y > y1) y1 = q.y;
  }

  const eye = (outline: readonly number[], k: { outer: number; inner: number; upper: number; lower: number; pupil: number }): FaceEye => {
    const width = dist(p(k.outer), p(k.inner));
    return {
      center: mid(p(k.outer), p(k.inner)),
      pupil: n > k.pupil ? p(k.pupil) : mid(p(k.outer), p(k.inner)),
      outline: outline.map(p),
      width,
      open: width > 0 ? dist(p(k.upper), p(k.lower)) / width : 0,
    };
  };
  const right = eye(MESH.rightEye, MESH.rightEyeKeys);
  const left = eye(MESH.leftEye, MESH.leftEyeKeys);

  const m = MESH.mouthKeys;
  const mouthWidth = dist(p(m.left), p(m.right));
  const gap = mouthWidth > 0 ? dist(p(m.innerTop), p(m.innerBottom)) / mouthWidth : 0;
  const expressions: FaceExpressions = {
    // The jaw can drop with the lips still together; the lips' own gap says whether the mouth is open.
    mouthOpen: clamp01(Math.max(s("jawOpen") - s("mouthClose"), (gap - 0.04) * 2.4)),
    jawOpen: s("jawOpen"),
    smile: (s("mouthSmileLeft") + s("mouthSmileRight")) / 2,
    blinkLeft: s("eyeBlinkLeft"),
    blinkRight: s("eyeBlinkRight"),
    browUp: Math.max(s("browInnerUp"), (s("browOuterUpLeft") + s("browOuterUpRight")) / 2),
    browDown: (s("browDownLeft") + s("browDownRight")) / 2,
    pucker: s("mouthPucker"),
    puff: s("cheekPuff"),
  };

  // The tilt of the eye line on screen; the turn and the nod from the mesh's depth.
  const ro = p(MESH.rightEyeKeys.outer);
  const lo = p(MESH.leftEyeKeys.outer);
  const roll = Math.atan2(lo.y - ro.y, lo.x - ro.x);
  const across = Math.hypot(lo.x - ro.x, lo.y - ro.y);
  const yaw = Math.atan2(z(MESH.leftEyeKeys.outer) - z(MESH.rightEyeKeys.outer), across);
  const fh = p(MESH.forehead);
  const ch = p(MESH.chin);
  const pitch = Math.atan2(z(MESH.chin) - z(MESH.forehead), Math.hypot(ch.x - fh.x, ch.y - fh.y));

  const face: Face = {
    box: { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) },
    eyes: { left, right },
    mouth: { left: p(m.left), right: p(m.right), top: p(m.top), bottom: p(m.bottom), outer: MESH.lipsOuter.map(p), inner: MESH.lipsInner.map(p) },
    nose: p(MESH.nose),
    brows: { left: MESH.leftBrow.map(p), right: MESH.rightBrow.map(p) },
    expressions,
    turn: { roll, yaw, pitch },
  };
  return face;
}

/** What `sketchFace` draws a face from: where (video pixels), how big, and how it looks. */
export interface FaceSketch {
  /** The middle of the face. */
  x: number;
  y: number;
  /** Its width; the height is 1.3 times it. */
  size: number;
  roll?: number;
  expressions?: Partial<FaceExpressions>;
  /** The picture's size, for `matrix` (640x480 when absent). */
  frame?: { width: number; height: number };
}

/**
 * The matrix of a head whose canonical nose tip lands on `nose` in a `width` x `height` picture,
 * `eyeSpan` pixels between the outer eye corners, turned `roll` on screen (clockwise positive).
 */
export function sketchMatrix(nose: FacePoint, eyeSpan: number, roll: number, width: number, height: number): number[] {
  const t = Math.tan(((FACE_FOV_DEGREES / 2) * Math.PI) / 180);
  const span = CANONICAL.leftEyeOuter.x - CANONICAL.rightEyeOuter.x;
  // Pixels per centimetre at depth D are height / (2 D t): the depth that makes the eyes eyeSpan apart.
  const D = (height * span) / (2 * t * Math.max(1e-6, eyeSpan));
  // Clockwise on screen (y down) is clockwise in the camera's y-up space too: a turn of -roll about z.
  const c = Math.cos(-roll);
  const s = Math.sin(-roll);
  const n = CANONICAL.noseTip;
  const rn = { x: c * n.x - s * n.y, y: s * n.x + c * n.y, z: n.z };
  const X = ((nose.x / width) * 2 - 1) * D * t * (width / height);
  const Y = (1 - (nose.y / height) * 2) * D * t;
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, X - rn.x, Y - rn.y, -D - rn.z, 1];
}

/**
 * A believable `Face` from a few numbers — for fakes and tests, where no model runs. Laid out like a
 * real one, unmirrored: the person's right eye on the picture's left.
 */
export function sketchFace(f: FaceSketch): Face {
  const ex: FaceExpressions = { mouthOpen: 0, jawOpen: 0, smile: 0, blinkLeft: 0, blinkRight: 0, browUp: 0, browDown: 0, pucker: 0, puff: 0, ...f.expressions };
  const roll = f.roll ?? 0;
  const cos = Math.cos(roll);
  const sin = Math.sin(roll);
  /** A point at (u, v) face widths from the middle, turned by the roll. */
  const at = (u: number, v: number): FacePoint => ({ x: f.x + (u * cos - v * sin) * f.size, y: f.y + (u * sin + v * cos) * f.size });
  const ring = (cu: number, cv: number, ru: number, rv: number, k: number): FacePoint[] =>
    Array.from({ length: k }, (_, i) => {
      const a = Math.PI + (i / k) * Math.PI * 2;
      return at(cu + Math.cos(a) * ru, cv + Math.sin(a) * rv);
    });
  const eye = (side: -1 | 1, blink: number): FaceEye => {
    const cu = side * 0.2;
    const open = 0.3 * (1 - blink);
    return { center: at(cu, -0.1), pupil: at(cu, -0.1), outline: ring(cu, -0.1, 0.09, open * 0.09, 16), width: 0.18 * f.size, open };
  };
  const gap = 0.02 + ex.mouthOpen * 0.18;
  const frame = f.frame ?? { width: 640, height: 480 };
  return {
    box: { x: f.x - f.size / 2, y: f.y - f.size * 0.65, w: f.size, h: f.size * 1.3 },
    // The person's right eye is on the picture's left (u < 0).
    eyes: { right: eye(-1, ex.blinkRight), left: eye(1, ex.blinkLeft) },
    mouth: {
      right: at(-0.18, 0.32),
      left: at(0.18, 0.32),
      top: at(0, 0.32 - gap / 2 - 0.04),
      bottom: at(0, 0.32 + gap / 2 + 0.04),
      outer: ring(0, 0.32, 0.18, gap / 2 + 0.04, 20),
      inner: ring(0, 0.32, 0.15, gap / 2, 20),
    },
    nose: at(0, 0.12),
    brows: { right: [at(-0.08, -0.24), at(-0.16, -0.26), at(-0.26, -0.24)], left: [at(0.08, -0.24), at(0.16, -0.26), at(0.26, -0.24)] },
    expressions: ex,
    turn: { roll, yaw: 0, pitch: 0 },
    // The outer eye corners are 0.58 face widths apart (each eye at +-0.2, 0.18 wide).
    matrix: sketchMatrix(at(0, 0.12), 0.58 * f.size, roll, frame.width, frame.height),
  };
}

/**
 * Whether a WebGL renderer's name is a software stand-in for a GPU (SwiftShader, llvmpipe, Microsoft's
 * Basic Render Driver): VMs, headless browsers, drivers the browser blocklists.
 */
export function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
}

/** What draws on this page, read once from a throwaway WebGL context (`LiveCamera.graphics`). */
export function graphicsOf(make: () => { getContext(kind: "webgl2" | "webgl"): unknown } | null): "gpu" | "software" | "unknown" {
  try {
    const canvas = make();
    const gl = (canvas?.getContext("webgl2") ?? canvas?.getContext("webgl")) as WebGLRenderingContext | null | undefined;
    if (!gl) return "software";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (!renderer) return "unknown";
    return isSoftwareRenderer(renderer) ? "software" : "gpu";
  } catch {
    return "unknown";
  }
}

/** A finder that answers with whatever `script` says now — for fakes, tests and the dev shell. */
export function scriptedFinder(script: () => Face[]): FaceFinder {
  return {
    find: async (_video, _time, opts) => script().slice(0, opts.max),
  };
}
