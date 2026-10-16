import { describe, expect, it } from "vitest";
import type { Face, LiveFrameInfo } from "potyro";
import { CANONICAL, MESH, SHAPES, createFakeLiveCamera, faceFrom, faceOptions, graphicsOf, isSoftwareRenderer, projectFacePoint, sketchFace, type FaceFinder } from "../src/index.js";

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

  it("hands every point with its depth, on x's scale, and the head's matrix as 16 numbers", () => {
    const raw = rawFace();
    raw.points.set([0.5, 0.55, -0.05], MESH.nose * 3);
    const matrix = Float32Array.from({ length: 16 }, (_, i) => i + 0.5);
    const f = faceFrom({ ...raw, matrix }, 640, 480, true);
    expect(f.points![MESH.nose]).toEqual({ x: expect.closeTo(320), y: expect.closeTo(264), z: expect.closeTo(-0.05 * 640) });
    expect(f.points!.every((p) => typeof p.z === "number")).toBe(true);
    expect(f.matrix).toEqual(Array.from(matrix));
    expect(Array.isArray(f.matrix)).toBe(true); // a plain array, which clones and JSON-encodes
    // No matrix, or a broken one, is no matrix — never a half one.
    expect(faceFrom(raw, 640, 480).matrix).toBeUndefined();
    expect(faceFrom({ ...raw, matrix: [1, 2, 3] }, 640, 480).matrix).toBeUndefined();
    expect(faceFrom({ ...raw, matrix: Array.from({ length: 16 }, () => Number.NaN) }, 640, 480).matrix).toBeUndefined();
  });

  it("the documented projection takes the canonical nose tip through a sketch's matrix onto its nose", () => {
    for (const s of [
      { x: 320, y: 240, size: 200, roll: 0 },
      { x: 180, y: 300, size: 120, roll: 0.4, frame: { width: 1280, height: 720 } },
      { x: 500, y: 120, size: 260, roll: -0.3 },
    ]) {
      const f = sketchFace(s);
      const frame = s.frame ?? { width: 640, height: 480 };
      const at = projectFacePoint(f.matrix!, CANONICAL.noseTip, frame.width, frame.height);
      expect(at.x).toBeCloseTo(f.nose.x, 3);
      expect(at.y).toBeCloseTo(f.nose.y, 3);
      // And the eye corners land about where the sketch's eyes are (the sketch is flat; the model is not).
      const left = projectFacePoint(f.matrix!, CANONICAL.leftEyeOuter, frame.width, frame.height);
      const right = projectFacePoint(f.matrix!, CANONICAL.rightEyeOuter, frame.width, frame.height);
      expect(left.x).toBeGreaterThan(right.x); // the person's left on the picture's right
      expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeGreaterThan(0.45 * s.size);
      expect(Math.atan2(left.y - right.y, left.x - right.x)).toBeCloseTo(s.roll, 1);
    }
  });

  it("agrees with sketchFace on which side is which", () => {
    const s = sketchFace({ x: 320, y: 240, size: 200, roll: 0.2, expressions: { mouthOpen: 1 } });
    expect(s.eyes.left.center.x).toBeGreaterThan(s.eyes.right.center.x);
    expect(s.eyes.left.center.y).toBeGreaterThan(s.eyes.right.center.y);
    expect(s.mouth.bottom.y - s.mouth.top.y).toBeGreaterThan(sketchFace({ x: 320, y: 240, size: 200 }).mouth.bottom.y - sketchFace({ x: 320, y: 240, size: 200 }).mouth.top.y);
  });
});

describe("graphics", () => {
  const gl = (renderer: string | null, withInfo = true) => () => ({
    getContext: (kind: string) =>
      renderer === null || kind !== "webgl2"
        ? null
        : {
            RENDERER: 0x1f01,
            getExtension: (n: string) => (n === "WEBGL_debug_renderer_info" ? (withInfo ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null) : n === "WEBGL_lose_context" ? { loseContext: () => undefined } : null),
            getParameter: (p: number) => (p === 0x9246 || p === 0x1f01 ? renderer : null),
          },
  });

  it("tells a real graphics chip from a software stand-in", () => {
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("Microsoft Basic Render Driver")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (Qualcomm, Adreno (TM) 642L, OpenGL ES 3.2)")).toBe(false);
    expect(isSoftwareRenderer("Apple GPU")).toBe(false);
    expect(graphicsOf(gl("Mali-G78"))).toBe("gpu");
    expect(graphicsOf(gl("SwiftShader", false))).toBe("software");
    expect(graphicsOf(gl(null))).toBe("software"); // no WebGL at all: drawing is the CPU's
    expect(graphicsOf(gl(""))).toBe("unknown");
    expect(graphicsOf(() => { throw new Error("no canvas"); })).toBe("unknown");
  });

  it("a session says what draws, read once per page", async () => {
    const soft = createFakeLiveCamera({ graphics: "software" });
    expect((await soft.cap.start()).graphics).toBe("software");
    expect((await createFakeLiveCamera().cap.start()).graphics).toBe("unknown");
  });
});

describe("faceOptions", () => {
  it("is off unless asked, one face by default, at most four", () => {
    expect(faceOptions(undefined)).toBeNull();
    expect(faceOptions(false)).toBeNull();
    expect(faceOptions(true)).toEqual({ max: 1, points: false, detail: "normal", sameFrame: false });
    expect(faceOptions({ max: 9, points: true })).toEqual({ max: 4, points: true, detail: "normal", sameFrame: false });
    expect(faceOptions({ max: 0 })).toEqual({ max: 1, points: false, detail: "normal", sameFrame: false });
    expect(faceOptions({ detail: "high", sameFrame: true })).toMatchObject({ detail: "high", sameFrame: true });
    // Anything else is the default, never an error: an app's typo leaves the camera working.
    expect(faceOptions({ detail: "ultra" as never, sameFrame: "yes" as never })).toMatchObject({ detail: "normal", sameFrame: false });
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

  it("says which frame the faces came from: facesTime is the time of the frame they were found in", async () => {
    const fake = createFakeLiveCamera();
    const asked: number[] = [];
    let answer: ((f: Face[]) => void) | null = null;
    fake.cap.useFaces(async () => ({
      find: (_v, time) => {
        asked.push(time);
        return new Promise<Face[]>((r) => (answer = r));
      },
    }));
    const cam = await fake.cap.start({ faces: true });
    const first = await frames(cam, () => fake.videos[0]!.frame(), 4);
    // Nothing found yet: no facesTime, rather than one that would say "these are fresh".
    expect(first.every((i) => i.facesTime === undefined)).toBe(true);
    answer!([face]);
    await tick();
    const later = await frames(cam, () => fake.videos[0]!.frame(), 1);
    expect(later[0]!.faces).toEqual([face]);
    expect(later[0]!.facesTime).toBe(asked[0]);
    expect(later[0]!.time).toBeGreaterThan(later[0]!.facesTime!); // a few frames stale, and the app can tell
    expect(later[0]!.facesTime).toBe(first[0]!.time); // the frame the find started on
  });

  it("sameFrame: a frame is handed on only with its own faces, and a still of that very frame", async () => {
    const fake = createFakeLiveCamera();
    let loaded!: () => void;
    const loading = new Promise<void>((r) => (loaded = r));
    fake.cap.useFaces(async () => {
      await loading;
      return { find: async () => [face] };
    });
    const cam = await fake.cap.start({ faces: { sameFrame: true } });
    const seen: LiveFrameInfo[] = [];
    const closedInside: boolean[] = [];
    cam.onFrame((_v, info) => {
      seen.push(info);
      if (info.frame) closedInside.push(fake.stills.at(-1)!.closed);
    });
    fake.videos[0]!.frame(); // before the finder has loaded: an ordinary frame, no faces, no still
    await tick();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ faces: [] });
    expect(seen[0]!.frame).toBeUndefined();
    expect(fake.stills).toHaveLength(0);
    loaded();
    await tick();
    for (let i = 0; i < 3; i++) {
      fake.videos[0]!.frame();
      await tick();
    }
    const inStep = seen.slice(1);
    expect(inStep.length).toBe(3);
    for (const info of inStep) {
      expect(info.faces).toEqual([face]);
      expect(info.facesTime).toBe(info.time);
      expect(info.frame).toBeDefined();
      expect((info.frame as unknown as { time: number }).time).toBeCloseTo(info.time, 6);
    }
    // The still is valid inside the callback and closed after it.
    expect(closedInside).toEqual([false, false, false]);
    expect(fake.stills.every((s) => s.closed)).toBe(true);
  });

  it("sameFrame: frames that come while a find runs are not handed on (no stale faces on a newer picture)", async () => {
    const fake = createFakeLiveCamera();
    let answer: ((f: Face[]) => void) | null = null;
    fake.cap.useFaces(async () => ({ find: () => new Promise<Face[]>((r) => (answer = r)) }));
    const cam = await fake.cap.start({ faces: { sameFrame: true } });
    await tick(); // the finder loads
    const seen = await frames(cam, () => fake.videos[0]!.frame(), 5);
    expect(seen).toHaveLength(0);
    answer!([face]);
    await tick();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.facesTime).toBe(seen[0]!.time);
    expect(seen[0]!.time).toBeCloseTo(1000 / 30, 6); // the FIRST frame, not the newest
  });

  it("a finder that breaks mid-session leaves 'failed' and no faces", async () => {
    const fake = createFakeLiveCamera();
    fake.cap.useFaces(async () => ({ find: () => Promise.reject(new Error("gpu lost")) }));
    const cam = await fake.cap.start({ faces: true });
    const seen = await frames(cam, () => fake.videos[0]!.frame(), 4);
    expect(seen.at(-1)).toMatchObject({ faces: [], facesFailed: "failed" });
  });
});
