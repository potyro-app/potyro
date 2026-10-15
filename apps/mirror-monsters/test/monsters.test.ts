import { describe, expect, it } from "vitest";
import type { Face, FacePoint } from "potyro";
import {
  MAX_SPARKS,
  PALETTE,
  PUPIL_ROOM,
  RESTING,
  cover,
  findFace,
  follow,
  isSkin,
  luma,
  motion,
  nearest,
  posterize,
  rng,
  snapPath,
  sparkle,
  MIRRORS,
  moreMirrors,
  placed,
  sample,
  segment,
  easeRig,
  rigFromBox,
  rigFromFace,
  stageMapper,
  wobble,
  type Box,
} from "../monsters.js";

/** An RGBA thumbnail filled with one colour, with an optional rectangle of another. */
function frame(w: number, h: number, bg: [number, number, number], rect?: { x: number; y: number; w: number; h: number; rgb: [number, number, number] }): Uint8Array {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const c = inside ? rect!.rgb : bg;
      d.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  return d;
}

const SKIN_LIGHT: [number, number, number] = [224, 172, 140];
const SKIN_DARK: [number, number, number] = [141, 85, 60];
const WALL: [number, number, number] = [60, 90, 140];

describe("isSkin", () => {
  it("takes light and dark skin, and leaves blue walls, green leaves, white and black", () => {
    expect(isSkin(...SKIN_LIGHT)).toBe(true);
    expect(isSkin(...SKIN_DARK)).toBe(true);
    expect(isSkin(...WALL)).toBe(false);
    expect(isSkin(60, 160, 70)).toBe(false);
    expect(isSkin(250, 250, 250)).toBe(false);
    expect(isSkin(10, 8, 8)).toBe(false);
  });
});

describe("findFace", () => {
  it("finds the skin blob's box, in fractions", () => {
    const d = frame(64, 48, WALL, { x: 20, y: 10, w: 16, h: 20, rgb: SKIN_LIGHT });
    const f = findFace(d, 64, 48)!;
    expect(f.x).toBeGreaterThanOrEqual(20 / 64 - 0.01);
    expect(f.x + f.w).toBeLessThanOrEqual(36 / 64 + 0.01);
    expect(f.y).toBeGreaterThanOrEqual(10 / 48 - 0.01);
    expect(f.y + f.h).toBeLessThanOrEqual(30 / 48 + 0.01);
    expect(f.w).toBeGreaterThan(0.15);
  });

  it("finds nothing in a frame without skin, or with only a speck of it", () => {
    expect(findFace(frame(64, 48, WALL), 64, 48)).toBeNull();
    expect(findFace(frame(64, 48, WALL, { x: 1, y: 1, w: 3, h: 3, rgb: SKIN_DARK }), 64, 48)).toBeNull();
  });
});

describe("follow", () => {
  it("eases toward the face found, and drifts back to rest without one", () => {
    const target: Box = { x: 0.1, y: 0.1, w: 0.3, h: 0.4 };
    let b = { ...RESTING };
    for (let i = 0; i < 60; i++) b = follow(b, target, 33);
    expect(b.x).toBeCloseTo(target.x, 2);
    expect(b.w).toBeCloseTo(target.w, 2);
    const one = follow(b, null, 33);
    expect(Math.abs(one.x - RESTING.x)).toBeLessThan(Math.abs(b.x - RESTING.x));
    expect(Math.abs(one.x - b.x)).toBeLessThan(0.02); // slowly: a face lost for a frame is not a jump
  });

  it("keeps the box face-shaped: never a sliver, never a pole", () => {
    let b = { ...RESTING };
    for (let i = 0; i < 200; i++) b = follow(b, { x: 0.5, y: 0, w: 0.02, h: 1 }, 33);
    expect(b.w).toBeGreaterThanOrEqual(0.139);
    expect(b.h / b.w).toBeLessThanOrEqual(1.61);
  });
});

describe("wobble", () => {
  it("lets the pupil fall to the bottom of the eye and stay inside it", () => {
    let p = { x: 0, y: 0, vx: 0, vy: 0 };
    for (let i = 0; i < 400; i++) p = wobble(p, { x: 0, y: 0 }, 16);
    expect(p.y).toBeGreaterThan(PUPIL_ROOM * 0.95);
    expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(PUPIL_ROOM + 1e-9);
  });

  it("swings the other way when the face jerks sideways", () => {
    let p = { x: 0, y: 0.5, vx: 0, vy: 0 };
    p = wobble(p, { x: 300, y: 0 }, 16);
    expect(p.vx).toBeLessThan(0);
  });

  it("never escapes the eye, however hard it is shaken", () => {
    let p = { x: 0, y: 0, vx: 0, vy: 0 };
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      p = wobble(p, { x: (r() - 0.5) * 2000, y: (r() - 0.5) * 2000 }, 16);
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(PUPIL_ROOM + 1e-9);
    }
  });
});

describe("trails", () => {
  it("finds the cells that moved", () => {
    const a = new Uint8Array([10, 10, 10, 10]);
    const b = new Uint8Array([10, 90, 12, 200]);
    expect(motion(a, b)).toEqual([1, 3]);
  });

  it("reads luminance from RGBA", () => {
    expect([...luma(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1)]).toEqual([255, 0]);
  });

  it("sparks where it moved, ages them out, and never passes the cap", () => {
    const r = rng(1);
    let s = sparkle([], [0, 5, 9], 4, 4, 16, 0, r);
    expect(s).toHaveLength(3);
    expect(s.every((k) => k.x >= 0 && k.x <= 1 && k.y >= 0 && k.y <= 1)).toBe(true);
    for (let i = 0; i < 200; i++) s = sparkle(s, [], 4, 4, 16, i * 16, r);
    expect(s).toHaveLength(0);
    const many = Array.from({ length: 5000 }, (_, i) => i % 16);
    s = sparkle([], many, 4, 4, 16, 0, r);
    s = sparkle(s, many, 4, 4, 16, 16, r);
    expect(s.length).toBeLessThanOrEqual(MAX_SPARKS);
  });
});

describe("pixel monster", () => {
  it("maps every pixel to the palette", () => {
    expect(PALETTE).toContainEqual(nearest(12, 200, 99));
    expect(nearest(255, 255, 250)).toEqual([250, 246, 236]);
    const d = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255]);
    posterize(d);
    expect(PALETTE).toContainEqual([d[0], d[1], d[2]]);
    expect(d[3]).toBe(255); // alpha left alone
  });
});

describe("cover", () => {
  it("crops a landscape camera to a portrait stage around its middle", () => {
    const c = cover(640, 480, 300, 600);
    expect(c.sh).toBeCloseTo(480);
    expect(c.sw).toBeCloseTo(240);
    expect(c.sx).toBeCloseTo(200);
    expect(c.sy).toBeCloseTo(0);
  });
});

describe("the kaleidoscope", () => {
  const TAU = Math.PI * 2;
  const norm = (v: number) => ((v % TAU) + TAU) % TAU;

  it("fills every segment: the n placed wedges cover the whole circle, none twice", () => {
    for (const n of MIRRORS) {
      const a = TAU / n;
      const covered = new Array<number>(n).fill(0);
      for (let k = 0; k < n; k++) {
        // The wedge's middle lands inside exactly one segment — k's own.
        const mid = norm(placed(k, n, a / 2));
        covered[Math.floor(mid / a)]!++;
        expect(Math.floor(mid / a), `n=${n} k=${k}`).toBe(k);
      }
      expect(covered).toEqual(new Array(n).fill(1));
    }
  });

  it("is seamless: neighbours show the same edge of the sample on the line they share", () => {
    for (const n of MIRRORS) {
      const a = TAU / n;
      for (let k = 0; k < n; k++) {
        const next = (k + 1) % n;
        // Which edge of the wedge (0 or a) each side puts on the shared line (k+1)·a.
        const mine = [0, a].find((th) => Math.abs(norm(placed(k, n, th)) - norm((k + 1) * a)) < 1e-9 || Math.abs(norm(placed(k, n, th)) - norm((k + 1) * a)) > TAU - 1e-9);
        const theirs = [0, a].find((th) => Math.abs(norm(placed(next, n, th)) - norm((k + 1) * a)) < 1e-9 || Math.abs(norm(placed(next, n, th)) - norm((k + 1) * a)) > TAU - 1e-9);
        expect(mine, `n=${n} k=${k}`).toBeDefined();
        expect(mine).toBe(theirs);
      }
    }
  });

  it("mirrors every other segment, and an even count closes the circle", () => {
    for (const n of MIRRORS) {
      expect(n % 2).toBe(0);
      expect(segment(0, n).flip).toBe(false);
      expect(segment(1, n).flip).toBe(true);
    }
    expect(moreMirrors(8)).toBe(10);
    expect(moreMirrors(12)).toBe(8);
  });

  it("samples around the face, drifting and turning, and never past the picture's edge", () => {
    const at = sample(0, { x: 0.3, y: 0.4 }, 640, 480, true);
    expect(at.cx).toBeCloseTo(Math.max(0.3 * 640, at.radius));
    expect(at.turn).toBe(0);
    for (let t = 0; t < 120_000; t += 997) {
      const s = sample(t, { x: 0.02, y: 0.98 }, 640, 480);
      expect(s.cx - s.radius).toBeGreaterThanOrEqual(0);
      expect(s.cy + s.radius).toBeLessThanOrEqual(480);
    }
    expect(sample(5_000, null, 640, 480).turn).not.toBe(sample(0, null, 640, 480).turn);
  });
});

/**
 * A face as Potyro's live camera gives one, from a few numbers (video pixels, unmirrored: the person's
 * right eye on the picture's left). The app imports `potyro` only, so it is built here.
 */
function sketchFace(f: { x: number; y: number; size: number; roll?: number; expressions?: Partial<Face["expressions"]> }): Face {
  const ex: Face["expressions"] = { mouthOpen: 0, jawOpen: 0, smile: 0, blinkLeft: 0, blinkRight: 0, browUp: 0, browDown: 0, pucker: 0, puff: 0, ...f.expressions };
  const roll = f.roll ?? 0;
  const at = (u: number, v: number): FacePoint => ({
    x: f.x + (u * Math.cos(roll) - v * Math.sin(roll)) * f.size,
    y: f.y + (u * Math.sin(roll) + v * Math.cos(roll)) * f.size,
  });
  const eye = (u: number, blink: number) => ({ center: at(u, -0.1), pupil: at(u, -0.1), outline: [], width: 0.18 * f.size, open: 0.3 * (1 - blink) });
  return {
    box: { x: f.x - f.size / 2, y: f.y - f.size * 0.65, w: f.size, h: f.size * 1.3 },
    eyes: { right: eye(-0.2, ex.blinkRight), left: eye(0.2, ex.blinkLeft) },
    mouth: { right: at(-0.18, 0.32), left: at(0.18, 0.32), top: at(0, 0.28), bottom: at(0, 0.36), outer: [], inner: [] },
    nose: at(0, 0.12),
    brows: { left: [], right: [] },
    expressions: ex,
    turn: { roll, yaw: 0, pitch: 0 },
  };
}

describe("the monster on a face", () => {
  // A 640×480 camera on a 400×600 stage, the selfie view mirrored.
  const map = stageMapper(640, 480, 400, 600, true);

  it("maps the picture to the stage through the cover crop and the mirror", () => {
    // The middle stays the middle; the picture's left lands on the stage's right when mirrored.
    expect(map({ x: 320, y: 240 })).toEqual({ x: expect.closeTo(200), y: expect.closeTo(300) });
    expect(map({ x: 300, y: 240 }).x).toBeGreaterThan(200);
    expect(stageMapper(640, 480, 400, 600, false)({ x: 300, y: 240 }).x).toBeLessThan(200);
  });

  it("puts the monster's eyes on the person's eyes and its mouth on their mouth", () => {
    const f = sketchFace({ x: 320, y: 240, size: 200 });
    const rig = rigFromFace(f, map);
    const eyes = [map(f.eyes.left.center), map(f.eyes.right.center)].sort((a, b) => a.x - b.x);
    expect(rig.eyes[0].at).toEqual(eyes[0]);
    expect(rig.eyes[1].at).toEqual(eyes[1]);
    expect(rig.eyes[0].at.x).toBeLessThan(rig.eyes[1].at.x);
    const ml = map(f.mouth.left);
    const mr = map(f.mouth.right);
    expect(rig.mouth.at.x).toBeCloseTo((ml.x + mr.x) / 2);
    expect(rig.brow.y).toBeLessThan(rig.eyes[0].at.y);
    expect(rig.angle).toBeCloseTo(0);
    expect(rig.eyes[0].shut).toBe(0);
    expect(rig.mouth.open).toBe(0);
  });

  it("opens its mouth with theirs, blinks with them, and tilts with the head — mirrored on screen", () => {
    const rig = rigFromFace(sketchFace({ x: 320, y: 240, size: 200, roll: 0.3, expressions: { mouthOpen: 0.8, blinkLeft: 1, blinkRight: 1 } }), map);
    expect(rig.mouth.open).toBeGreaterThan(0.9);
    expect(rig.eyes.every((e) => e.shut > 0.9)).toBe(true);
    // A clockwise tilt in the picture is anticlockwise in a mirror.
    expect(rig.angle).toBeCloseTo(-0.3, 1);
    expect(rigFromFace(sketchFace({ x: 320, y: 240, size: 200, roll: 0.3 }), stageMapper(640, 480, 400, 600, false)).angle).toBeCloseTo(0.3, 1);
  });

  it("falls back to the blob, level and open-eyed, and eases between the two", () => {
    const box = rigFromBox({ x: 100, y: 100, w: 200, h: 260 });
    expect(box.eyes[0].at.x).toBeLessThan(box.eyes[1].at.x);
    expect(box.angle).toBe(0);
    const face = rigFromFace(sketchFace({ x: 320, y: 240, size: 200 }), map);
    const half = easeRig(box, face, 30);
    expect(half.eyes[0].at.x).toBeGreaterThan(Math.min(box.eyes[0].at.x, face.eyes[0].at.x) - 1e-9);
    expect(half.eyes[0].at.x).toBeLessThan(Math.max(box.eyes[0].at.x, face.eyes[0].at.x) + 1e-9);
    expect(easeRig(null, face, 30)).toBe(face);
  });
});

describe("names", () => {
  it("files a snap by mode and moment, so two never collide", () => {
    const at = new Date(2026, 9, 15, 9, 5, 7, 42);
    expect(snapPath("twin", at)).toBe("snaps/twin-20261015-090507-042.png");
    expect(snapPath("twin", new Date(at.getTime() + 1))).not.toBe(snapPath("twin", at));
  });
});
