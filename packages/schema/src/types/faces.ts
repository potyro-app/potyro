// Faces in the live camera's frames (docs/25 §Faces): `ctx.caps.camera.live({ faces: true })`.
//
// Outside the CORE of the model's reference (packages/generator/src/reference.ts, #341): the prompt
// carries one index line for `Face`; these declarations reach the model through `lookup("Face")`
// and beside a request that asks for faces, like every other capability's.
//
// Every point is in the VIDEO's pixels, not mirrored — the frame's own convention: a selfie view that
// mirrors the picture mirrors these points the same way. Left and right are the PERSON's: their left
// eye is on the right of an unmirrored picture.

/** A point in the video's pixels. */
export interface FacePoint {
  x: number;
  y: number;
}

/**
 * A point of the whole mesh (`Face.points`): `x`, `y` in the video's pixels, and `z` its depth on the
 * same scale as `x` (video pixels, approximate): 0 is about the middle of the head, NEGATIVE is
 * nearer the camera — the nose tip is the most negative. Good for which part is in front, and for
 * shading a warp; not a distance in centimetres (`Face.matrix` is that).
 */
export interface FaceMeshPoint extends FacePoint {
  z: number;
}

/** One eye: its middle, the pupil (the iris's centre), its outline, and its size. */
export interface FaceEye {
  center: FacePoint;
  pupil: FacePoint;
  /** The lids' outline, corner to corner along the top, then back along the bottom. */
  outline: FacePoint[];
  /** Corner to corner, in pixels. */
  width: number;
  /** How open it is: 0 shut, about 0.3 open (lid gap over width). */
  open: number;
}

/** Expressions, each 0..1 (MediaPipe's blendshapes, the ones a toy needs). */
export interface FaceExpressions {
  /** Lips apart (the jaw dropping, less the lips pressed). */
  mouthOpen: number;
  jawOpen: number;
  smile: number;
  /** Each eye's blink, by the person's own left and right. */
  blinkLeft: number;
  blinkRight: number;
  /** Brows raised (inner and outer). */
  browUp: number;
  /** Brows drawn down — a frown. */
  browDown: number;
  /** Lips pushed forward, as for a kiss. */
  pucker: number;
  /** Cheeks puffed. */
  puff: number;
}

/** A face found in a frame. */
export interface Face {
  /** Around every point of the face, in video pixels. */
  box: { x: number; y: number; w: number; h: number };
  /** The person's own left and right eye. */
  eyes: { left: FaceEye; right: FaceEye };
  mouth: {
    /** Corners: the person's left and right. */
    left: FacePoint;
    right: FacePoint;
    /** The middle of the upper lip's top and of the lower lip's bottom. */
    top: FacePoint;
    bottom: FacePoint;
    /** The lips' outer and inner outlines, closed loops. */
    outer: FacePoint[];
    inner: FacePoint[];
  };
  /** The tip of the nose. */
  nose: FacePoint;
  /** Each brow, from the nose outwards. */
  brows: { left: FacePoint[]; right: FacePoint[] };
  expressions: FaceExpressions;
  /**
   * How the head is turned, in radians: `roll` is the tilt of the eye line in the picture (positive
   * clockwise on screen, unmirrored), `yaw` turning to the person's left is positive, `pitch` nodding
   * down is positive.
   */
  turn: { roll: number; yaw: number; pitch: number };
  /** All 478 points of the face mesh (MediaPipe's numbering), with depth, only with `faces: { points: true }`. */
  points?: FaceMeshPoint[];
  /**
   * Where the head is, in 3D: MediaPipe's facial transformation matrix, 16 numbers, COLUMN-major
   * (`m[12..14]` is the move). It takes a point of the canonical face — centimetres, the head's middle
   * at 0, +x to the person's left, +y up, +z out of the face — to the camera's space (centimetres,
   * the camera at 0 looking down −z, +y up). To the picture, with the camera's 63° vertical view:
   * `const t = Math.tan((63 / 2) * Math.PI / 180), X = m[0]*x + m[4]*y + m[8]*z + m[12], Y = m[1]*x +
   * m[5]*y + m[9]*z + m[13], Z = m[2]*x + m[6]*y + m[10]*z + m[14]; px = (1 + X / (-Z * t * width /
   * height)) / 2 * width; py = (1 - Y / (-Z * t)) / 2 * height`. The nose tip is (0, -1.13, 7.48).
   * Absent when the finder gives none (a fake, an older Potyro).
   */
  matrix?: number[];
}

/** `live({ faces })`: `true`, or options. */
export interface FaceOptions {
  /** How many faces: 1–4, default 1. */
  max?: number;
  /** Hand over every mesh point (`Face.points`). */
  points?: boolean;
  /**
   * Every frame carries the faces found in THAT frame: `onFrame` is called only once a frame's faces
   * are found, with `info.frame`, a still of that very picture — draw it instead of the video. For a
   * warp that must not slide off the face. Costs the find's time in lag (~20–40 ms) and frames: the
   * rate is the finder's, not the camera's.
   */
  sameFrame?: boolean;
  /**
   * `"high"` finds faces in the camera's whole picture instead of one shrunk to 640 px on its long
   * side: small or far faces are found, and their points are finer. Slower on a big picture.
   */
  detail?: "normal" | "high";
}

/**
 * Why a frame carries no faces although they were asked for: `"unsupported"` — this device or Potyro
 * cannot find faces; `"failed"` — finding them broke (the model would not load). The camera keeps going.
 */
export type FacesFailure = "unsupported" | "failed";
