import { describe, expect, it } from "vitest";
import type { Face, LiveFrameInfo } from "potyro";
import { MESH, SHAPES, createFakeLiveCamera, faceFrom, faceOptions, sketchFace, type FaceFinder } from "../src/index.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A raw mesh with the key points of a level face, mouth `gap` apart, in normalised coordinates. */
function rawFace(opts: { gap?: number; tilt?: number; shapes?: Partial<Record<(typeof SHAPES)[number], number>> } = {}) {
  const points = new Float32Array(478 * 3).fill(0.5);
  const set = (i: number, x: number, y: number, z = 0) => points.set([x, y, z], i * 3);
  const tilt = opts.tilt ?? 0;
  // The person's right eye on the picture's LEFT, unmirrored.
  set(MESH.rightEyeKeys.outer, 0.3, 0.4 - tilt);
  set(MESH.rightEyeKeys.inner, 0.4, 0.4 - tilt / 2);
  set(MESH.rightEyeKeys.upper, 0.35, 0.39);
  set(MESH.rightEyeKeys.lower, 0.35, 0.41);
  set(MESH.rightEyeKeys.pupil, 0.36, 0.4);
  set(MESH.leftEyeKeys.outer, 0.7, 0.4 + tilt);
  set(MESH.leftEyeKeys.inner, 0.6, 0.4 + tilt / 2);
  set(MESH.leftEyeKeys.upper, 0.65, 0.39);
  set(MESH.leftEyeKeys.lower, 0.65, 0.41);
  set(MESH.leftEyeKeys.pupil, 0.64, 0.4);
  const gap = opts.gap ?? 0;
  set(MESH.mouthKeys.right, 0.4, 0.7);
  set(MESH.mouthKeys.left, 0.6, 0.7);
  set(MESH.mouthKeys.innerTop, 0.5, 0.7 - gap / 2);
  set(MESH.mouthKeys.innerBottom, 0.5, 0.7 + gap / 2);
  set(MESH.nose, 0.5, 0.55);
  set(MESH.forehead, 0.5, 0.15);
  set(MESH.chin, 0.5, 0.9);
  const shapes = SHAPES.map((n) => opts.shapes?.[n] ?? 0);
  return { points, shapes };
}

describe("faceFrom", () => {
  it("puts the eyes, pupils, mouth and nose in the video's pixels, the person's left on the picture's right", () => {
    const f = faceFrom(rawFace(), 640, 480);
    expect(f.eyes.right.center.x).toBeCloseTo(0.35 * 640);
    expect(f.eyes.left.center.x).toBeCloseTo(0.65 * 640);
    expect(f.eyes.left.center.y).toBeCloseTo(0.4 * 480);
    expect(f.eyes.right.pupil).toEqual({ x: expect.closeTo(0.36 * 640), y: expect.closeTo(0.4 * 480) });
    expect(f.eyes.left.width).toBeCloseTo(0.1 * 640);
    expect(f.eyes.left.outline).toHaveLength(16);
    expect(f.mouth.left.x).toBeGreaterThan(f.mouth.right.x);
    expect(f.mouth.outer).toHaveLength(20);
    expect(f.nose).toEqual({ x: expect.closeTo(320), y: expect.closeTo(0.55 * 480) });
    expect(f.box.w).toBeGreaterThan(0);
    expect(f.turn.roll).toBeCloseTo(0);
    expect(f.points).toBeUndefined();
    expect(faceFrom(rawFace(), 640, 480, true).points).toHaveLength(478);
  });

  it("reads the mouth open from the lips' gap as well as the jaw, and the rest from the blendshapes", () => {
    expect(faceFrom(rawFace({ gap: 0 }), 640, 480).expressions.mouthOpen).toBe(0);
    expect(faceFrom(rawFace({ gap: 0.1 }), 640, 480).expressions.mouthOpen).toBeGreaterThan(0.5);
    const f = faceFrom(rawFace({ shapes: { jawOpen: 0.8, eyeBlinkLeft: 0.9, mouthSmileLeft: 0.6, mouthSmileRight: 0.4, browInnerUp: 0.7 } }), 640, 480);
    expect(f.expressions).toMatchObject({ jawOpen: 0.8, mouthOpen: 0.8, blinkLeft: 0.9, blinkRight: 0, smile: 0.5, browUp: 0.7 });
  });

  it("tilts: the person's left eye lower on the picture is a clockwise roll", () => {
    expect(faceFrom(rawFace({ tilt: 0.05 }), 640, 480).turn.roll).toBeGreaterThan(0.1);
    expect(faceFrom(rawFace({ tilt: -0.05 }), 640, 480).turn.roll).toBeLessThan(-0.1);
  });

  it("agrees with sketchFace on which side is which", () => {
    const s = sketchFace({ x: 320, y: 240, size: 200, roll: 0.2, expressions: { mouthOpen: 1 } });
    expect(s.eyes.left.center.x).toBeGreaterThan(s.eyes.right.center.x);
    expect(s.eyes.left.center.y).toBeGreaterThan(s.eyes.right.center.y);
    expect(s.mouth.bottom.y - s.mouth.top.y).toBeGreaterThan(sketchFace({ x: 320, y: 240, size: 200 }).mouth.bottom.y - sketchFace({ x: 320, y: 240, size: 200 }).mouth.top.y);
  });
});

describe("faceOptions", () => {
  it("is off unless asked, one face by default, at most four", () => {
    expect(faceOptions(undefined)).toBeNull();
    expect(faceOptions(false)).toBeNull();
    expect(faceOptions(true)).toEqual({ max: 1, points: false });
    expect(faceOptions({ max: 9, points: true })).toEqual({ max: 4, points: true });
    expect(faceOptions({ max: 0 })).toEqual({ max: 1, points: false });
  });
});

describe("a live session with faces", () => {
  const face = sketchFace({ x: 300, y: 220, size: 180 });

  async function frames(cam: { onFrame(cb: (v: HTMLVideoElement, i: LiveFrameInfo) => void): () => void }, push: () => void, n: number): Promise<LiveFrameInfo[]> {
    const seen: LiveFrameInfo[] = [];
    cam.onFrame((_v, info) => seen.push(info));
    for (let i = 0; i < n; i++) {
      push();
      await tick();
    }
    return seen;
  }

  it("carries the faces found in each frame's info, once the finder has loaded", async () => {
    const fake = createFakeLiveCamera({ faces: [face] });
    const cam = await fake.cap.start({ faces: true });
    const seen = await frames(cam, () => fake.videos[0]!.frame(), 4);
    expect(seen[0]!.faces).toEqual([]); // the first frame comes before the first answer
    expect(seen.at(-1)!.faces).toEqual([face]);
    expect(seen.at(-1)!.facesFailed).toBeUndefined();
    expect(fake.faceCalls.loads).toBe(1);
    fake.setFaces([]);
    const later = await frames(cam, () => fake.videos[0]!.frame(), 3);
    expect(later.at(-1)!.faces).toEqual([]);
  });

  it("does not look for faces unless asked", async () => {
    const fake = createFakeLiveCamera({ faces: [face] });
    const cam = await fake.cap.start();
    const seen = await frames(cam, () => fake.videos[0]!.frame(), 3);
    expect(seen.every((i) => !("faces" in i))).toBe(true);
    expect(fake.faceCalls).toEqual({ loads: 0, finds: 0 });
  });

  it("says why there are none: no finder is 'unsupported', a model that will not load is 'failed' — and the frames keep coming", async () => {
    const none = createFakeLiveCamera();
    const a = await none.cap.start({ faces: true });
    const seenA = await frames(a, () => none.videos[0]!.frame(), 2);
    expect(seenA.map((i) => i.facesFailed)).toEqual(["unsupported", "unsupported"]);
    expect(seenA.every((i) => Array.isArray(i.faces) && i.faces.length === 0)).toBe(true);

    const broken = createFakeLiveCamera({ facesFail: "failed" });
    const b = await broken.cap.start({ faces: true });
    const seenB = await frames(b, () => broken.videos[0]!.frame(), 3);
    expect(seenB.length).toBe(3);
    expect(seenB.at(-1)!.facesFailed).toBe("failed");
  });

  it("asks once per frame at most, and skips frames while a find is still running", async () => {
    const fake = createFakeLiveCamera();
    let finds = 0;
    let answer: ((f: Face[]) => void) | null = null;
    const slow: FaceFinder = {
      find: () => {
        finds++;
        return new Promise<Face[]>((r) => (answer = r));
      },
    };
    fake.cap.useFaces(async () => slow);
    const cam = await fake.cap.start({ faces: { max: 2 } });
    const seen = await frames(cam, () => fake.videos[0]!.frame(), 5);
    expect(seen).toHaveLength(5); // drawing never waits for faces
    expect(finds).toBe(1);
    answer!([face]);
    await tick();
    const more = await frames(cam, () => fake.videos[0]!.frame(), 2);
    expect(more[0]!.faces).toEqual([face]);
    expect(finds).toBe(2);
  });

  it("a finder that breaks mid-session leaves 'failed' and no faces", async () => {
    const fake = createFakeLiveCamera();
    fake.cap.useFaces(async () => ({ find: () => Promise.reject(new Error("gpu lost")) }));
    const cam = await fake.cap.start({ faces: true });
    const seen = await frames(cam, () => fake.videos[0]!.frame(), 4);
    expect(seen.at(-1)).toMatchObject({ faces: [], facesFailed: "failed" });
  });
});
