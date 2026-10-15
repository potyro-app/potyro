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
  /** All 478 points of the face mesh (MediaPipe's numbering), only with `faces: { points: true }`. */
  points?: FacePoint[];
}

/** `live({ faces })`: `true`, or how many faces (1–4, default 1) and whether to hand over every point. */
export interface FaceOptions {
  max?: number;
  points?: boolean;
}

/**
 * Why a frame carries no faces although they were asked for: `"unsupported"` — this device or Potyro
 * cannot find faces; `"failed"` — finding them broke (the model would not load). The camera keeps going.
 */
export type FacesFailure = "unsupported" | "failed";
