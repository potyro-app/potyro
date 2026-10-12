import { describe, expect, it } from "vitest";
import {
  colorAt,
  colorName,
  coverCrop,
  dusk,
  makeSpecks,
  mosaicCells,
  MOTION,
  particleBudget,
  particleCount,
  rng,
  sampleSize,
  snapshotPath,
  step,
  titleFor,
  unsettled,
  type Source,
} from "../garden.js";

/** A w×h picture of one colour. */
const flat = (w: number, h: number, rgb: [number, number, number]): Source => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { w, h, data };
};

/** Left half red, right half blue. */
const split = (): Source => {
  const w = 10;
  const h = 4;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(x < w / 2 ? [220, 30, 40, 255] : [30, 60, 220, 255], (y * w + x) * 4);
  return { w, h, data };
};

describe("fitting a photo to the stage", () => {
  it("crops a wide photo's sides for a tall stage, and a tall photo's top and bottom for a wide one", () => {
    expect(coverCrop(4000, 3000, 300, 600)).toEqual({ x: 1250, y: 0, w: 1500, h: 3000 });
    expect(coverCrop(3000, 4000, 800, 400)).toEqual({ x: 0, y: 1250, w: 3000, h: 1500 });
  });

  it("shrinks to a few hundred pixels in the stage's shape", () => {
    expect(sampleSize(900, 600)).toEqual({ w: 180, h: 120 });
    expect(sampleSize(300, 600, 100)).toEqual({ w: 50, h: 100 });
  });

  it("reads the colour under a point, clamped to the picture", () => {
    const s = split();
    expect(colorAt(s, 0.1, 0.5)).toEqual([220, 30, 40]);
    expect(colorAt(s, 0.9, 0.5)).toEqual([30, 60, 220]);
    expect(colorAt(s, 1.5, -1)).toEqual([30, 60, 220]);
  });
});

describe("how many specks a screen can afford", () => {
  it("caps a phone well below a desktop", () => {
    expect(particleBudget(390, 700, true).max).toBe(2800);
    expect(particleBudget(1200, 800, false).max).toBe(7000);
    expect(particleBudget(300, 300, false).max).toBe(1286);
  });

  it("follows the density slider between the floor and the cap, and never past them", () => {
    const { min, max } = particleBudget(390, 700, true);
    expect(particleCount(390, 700, 0, true)).toBe(min);
    expect(particleCount(390, 700, 100, true)).toBe(max);
    expect(particleCount(390, 700, 500, true)).toBe(max);
    expect(particleCount(390, 700, 50, true)).toBeGreaterThan(min);
    expect(particleCount(390, 700, 50, true)).toBeLessThan(max);
  });

  it("makes mosaic tiles finer as the density rises", () => {
    expect(mosaicCells(400, 600, 0).size).toBeCloseTo(400 / 14, 5);
    expect(mosaicCells(400, 600, 100).size).toBeCloseTo(400 / 46, 5);
    const { cols, rows, size } = mosaicCells(400, 600, 50);
    expect(cols * size).toBeGreaterThanOrEqual(400);
    expect(rows * size).toBeGreaterThanOrEqual(600);
  });
});

describe("the specks", () => {
  it("take their colour from the picture where they belong", () => {
    const s = makeSpecks("flow", split(), 200, 100, 50, false, rng(7));
    for (let i = 0; i < s.n; i++) {
      const left = s.hx[i]! < 100;
      expect(s.fill[i]).toBe(left ? "rgb(220,30,40)" : "rgb(30,60,220)");
    }
  });

  it("are one per tile in a mosaic, and on an even grid as points", () => {
    const m = makeSpecks("mosaic", split(), 400, 600, 0, false, rng(1));
    const { cols, rows } = mosaicCells(400, 600, 0);
    expect(m.n).toBe(cols * rows);
    const p = makeSpecks("points", split(), 400, 600, 50, false, rng(1));
    expect(Math.abs(p.n - particleCount(400, 600, 50, false)) / p.n).toBeLessThan(0.15);
  });

  it("never exceed the phone cap, whatever the style", () => {
    for (const style of ["flow", "points"] as const) expect(makeSpecks(style, split(), 390, 740, 100, true, rng(3)).n).toBeLessThanOrEqual(2800 * 1.05);
  });

  it("gather home once the pull is on, with no current", () => {
    const s = makeSpecks("mosaic", split(), 200, 200, 30, false, rng(2));
    const still = { x: 0, y: 0, strength: 0, radius: 50 };
    for (let f = 0; f < 200; f++) step(s, MOTION.mosaic, 1, () => 0, still);
    for (let i = 0; i < s.n; i++) expect(unsettled(s, i)).toBeLessThan(0.02);
  });

  it("scatter away from a touch, and only near it", () => {
    const s = makeSpecks("mosaic", split(), 200, 200, 30, false, rng(2));
    for (let i = 0; i < s.n; i++) {
      s.x[i] = s.hx[i]!;
      s.y[i] = s.hy[i]!;
    }
    const touch = { x: 100, y: 100, strength: 1, radius: 40 };
    step(s, MOTION.mosaic, 1, () => 0, touch);
    for (let i = 0; i < s.n; i++) {
      const d = Math.hypot(s.hx[i]! - 100, s.hy[i]! - 100);
      const moved = Math.hypot(s.x[i]! - s.hx[i]!, s.y[i]! - s.hy[i]!);
      if (d > 40) expect(moved).toBe(0);
      else if (d > 2 && d < 30) {
        expect(moved).toBeGreaterThan(0);
        // pushed outward: further from the touch than before
        expect(Math.hypot(s.x[i]! - 100, s.y[i]! - 100)).toBeGreaterThan(d);
      }
    }
  });

  it("are carried by the current in flow", () => {
    const s = makeSpecks("flow", split(), 200, 200, 10, false, rng(4));
    const before = Array.from(s.x);
    step(s, MOTION.flow, 0, () => 0, { x: 0, y: 0, strength: 0, radius: 1 }); // angle 0: everything drifts right
    for (let i = 0; i < s.n; i++) expect(s.x[i]!).toBeGreaterThan(before[i]!);
  });
});

describe("a name for what you kept", () => {
  it("names the picture's colour", () => {
    expect(colorName(flat(4, 4, [222, 58, 120]))).toBe("Rose");
    expect(colorName(flat(4, 4, [60, 130, 70]))).toBe("Fern");
    expect(colorName(flat(4, 4, [40, 70, 200]))).toBe("Dusk");
    expect(colorName(flat(4, 4, [230, 150, 40]))).toBe("Amber");
    expect(colorName(flat(4, 4, [20, 20, 22]))).toBe("Ink");
    expect(colorName(flat(4, 4, [240, 240, 238]))).toBe("Pearl");
    expect(colorName(flat(4, 4, [128, 128, 128]))).toBe("Stone");
  });

  it("gives each style its noun and numbers a repeat", () => {
    const rose = flat(2, 2, [222, 58, 120]);
    expect(titleFor(rose, "flow")).toBe("Rose Drift");
    expect(titleFor(rose, "points")).toBe("Rose Bloom");
    expect(titleFor(rose, "mosaic", ["Rose Tessera"])).toBe("Rose Tessera II");
    expect(titleFor(rose, "mosaic", ["Rose Tessera", "Rose Tessera II"])).toBe("Rose Tessera III");
  });

  it("files a snapshot under garden/, sortable by when it was kept", () => {
    expect(snapshotPath("Rose Drift II", new Date(2026, 9, 12, 15, 4, 9))).toBe("garden/2026-10-12-150409-rose-drift-ii.png");
    expect(snapshotPath("¿?", new Date(2026, 0, 2, 3, 4, 5))).toBe("garden/2026-01-02-030405-garden.png");
  });

  it("paints a dusk to show before there is a photo", () => {
    const d = dusk(30, 40);
    expect(d.data.length).toBe(30 * 40 * 4);
    expect(colorAt(d, 0.5, 0.02)[2]).toBeGreaterThan(colorAt(d, 0.5, 0.02)[0]); // blue at the top
    expect(colorName(d)).not.toBe("Ink");
  });
});
