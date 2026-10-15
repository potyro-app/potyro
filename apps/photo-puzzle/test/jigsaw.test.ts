import { describe, expect, it } from "vitest";
import {
  bests,
  clock,
  coverCrop,
  cut,
  home,
  isBest,
  isEdgePiece,
  layout,
  LEVEL_IDS,
  LEVELS,
  outline,
  pieceCount,
  rng,
  scatter,
  seedOf,
  sides,
  snapDistance,
  snaps,
  type Seg,
} from "../jigsaw.js";

/** An outline's points (ends and control points), moved to absolute board units. */
const points = (segs: Seg[], dx: number, dy: number): Array<[number, number]> =>
  segs.flatMap((s) => ("c1" in s ? [s.c1, s.c2, s.to] : [s.to])).map(([x, y]) => [x + dx, y + dy] as [number, number]);
const key = ([x, y]: [number, number]) => `${x.toFixed(6)},${y.toFixed(6)}`;

/** One side's knob (its four curve segments, without the last straight run), as sorted board points. */
function knobOf(c: ReturnType<typeof cut>, r: number, col: number, side: "top" | "right" | "bottom" | "left", dx: number, dy: number): string[] {
  const order = ["top", "right", "bottom", "left"] as const;
  const s = sides(c, r, col);
  const segs = outline(c, r, col);
  let at = 0;
  for (const o of order) {
    const n = s.dirs[o] === 0 ? 1 : 5;
    if (o === side) return points(segs.slice(at, at + Math.max(1, n - 1)), dx, dy).map(key).sort();
    at += n;
  }
  return [];
}

describe("the cut", () => {
  it("is the same for the same seed, and different for another", () => {
    expect(cut(LEVELS.hard, 42)).toEqual(cut(LEVELS.hard, 42));
    expect(cut(LEVELS.hard, 42)).not.toEqual(cut(LEVELS.hard, 43));
    expect(seedOf("abc/easy")).toBe(seedOf("abc/easy"));
    expect(seedOf("abc/easy")).not.toBe(seedOf("abc/hard"));
  });

  it("has flat borders and a knob or a hole on every inner edge", () => {
    for (const id of LEVEL_IDS) {
      const c = cut(LEVELS[id], 9);
      const { rows, cols } = LEVELS[id];
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          const s = sides(c, r, col);
          expect(s.dirs.top === 0).toBe(r === 0);
          expect(s.dirs.left === 0).toBe(col === 0);
          expect(s.dirs.bottom === 0).toBe(r === rows - 1);
          expect(s.dirs.right === 0).toBe(col === cols - 1);
          expect(isEdgePiece(c, r, col)).toBe(r === 0 || col === 0 || r === rows - 1 || col === cols - 1);
        }
      }
    }
  });

  it("makes neighbours fit: a knob out of one is a hole in the other, the same curve exactly", () => {
    // Solvability: every shared edge is traced identically by both pieces, so the whole picture
    // closes with no gap and no overlap — the puzzle can always be put back together.
    for (const id of LEVEL_IDS) {
      const c = cut(LEVELS[id], 1234);
      const { rows, cols } = LEVELS[id];
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          const s = sides(c, r, col);
          if (r < rows - 1) expect(s.dirs.bottom).toBe(-sides(c, r + 1, col).dirs.top);
          if (col < cols - 1) expect(s.dirs.right).toBe(-sides(c, r, col + 1).dirs.left);
          // Each outline: 4 sides; a knobbed side is 5 segments, a flat one 1.
          const segs = outline(c, r, col);
          const knobbed = [s.dirs.top, s.dirs.right, s.dirs.bottom, s.dirs.left].filter((d) => d !== 0).length;
          expect(segs).toHaveLength(knobbed * 5 + (4 - knobbed));
          // It ends where it starts: the top-left corner.
          expect(segs[segs.length - 1]!.to).toEqual([0, 0]);
        }
      }
      // Shared edges, in board units: the knob of one piece is the hole of the other, point for point.
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          if (r < rows - 1) expect(knobOf(c, r, col, "bottom", col, r)).toEqual(knobOf(c, r + 1, col, "top", col, r + 1));
          if (col < cols - 1) expect(knobOf(c, r, col, "right", col, r)).toEqual(knobOf(c, r, col + 1, "left", col + 1, r));
        }
      }
    }
  });

  it("keeps every knob inside the bleed it is cut with", () => {
    const c = cut(LEVELS.hard, 77);
    for (let r = 0; r < 8; r++) for (let col = 0; col < 6; col++) for (const [x, y] of points(outline(c, r, col), 0, 0)) {
      expect(x).toBeGreaterThan(-0.34);
      expect(x).toBeLessThan(1.34);
      expect(y).toBeGreaterThan(-0.34);
      expect(y).toBeLessThan(1.34);
    }
  });
});

describe("the table", () => {
  const screens = [
    [343, 600],
    [375, 640],
    [1100, 760],
    [900, 900],
  ] as const;

  it("lays the board out whole, with square pieces, on a phone and on a wide screen", () => {
    for (const [w, h] of screens) {
      for (const id of LEVEL_IDS) {
        const { board, piece } = layout(LEVELS[id], w, h);
        expect(piece).toBeGreaterThan(20);
        expect(board.w).toBe(piece * LEVELS[id].cols);
        expect(board.h).toBe(piece * LEVELS[id].rows);
        expect(board.x).toBeGreaterThanOrEqual(0);
        expect(board.x + board.w).toBeLessThanOrEqual(w);
        expect(board.y + board.h).toBeLessThanOrEqual(h);
      }
    }
  });

  it("tips the pieces out on the table, never already home", () => {
    for (const [w, h] of screens) {
      for (const id of LEVEL_IDS) {
        const level = LEVELS[id];
        const { board, piece, table } = layout(level, w, h);
        const spots = scatter(pieceCount(level), board, piece, table, rng(5));
        expect(spots).toHaveLength(pieceCount(level));
        spots.forEach((s, i) => {
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.y).toBeGreaterThanOrEqual(0);
          expect(s.x + piece).toBeLessThanOrEqual(w);
          expect(s.y + piece).toBeLessThanOrEqual(h);
          const at = home(board, piece, Math.floor(i / level.cols), i % level.cols);
          expect(snaps(s, at, piece), `${w}x${h} ${id} piece ${i}`).toBe(false);
        });
      }
    }
  });

  it("snaps a piece dropped within a third of a piece of its place, and not further", () => {
    expect(snapDistance(60)).toBeCloseTo(20.4);
    expect(snaps({ x: 110, y: 210 }, { x: 100, y: 200 }, 60)).toBe(true);
    expect(snaps({ x: 125, y: 200 }, { x: 100, y: 200 }, 60)).toBe(false);
  });
});

describe("score", () => {
  it("writes a time the way a stopwatch does", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(67.9)).toBe("1:07");
    expect(clock(750)).toBe("12:30");
    expect(clock(3723)).toBe("1:02:03");
  });

  it("keeps the fastest solve per level, per puzzle or overall, ignoring nonsense", () => {
    const s = [
      { puzzle: "a", level: "easy" as const, seconds: 80 },
      { puzzle: "a", level: "easy" as const, seconds: 61 },
      { puzzle: "b", level: "easy" as const, seconds: 40 },
      { puzzle: "a", level: "hard" as const, seconds: 600 },
      { puzzle: "a", level: "medium" as const, seconds: 0 },
      { puzzle: "a", level: "huge" as never, seconds: 5 },
    ];
    expect(bests(s, "a")).toEqual({ easy: s[1], hard: s[3] });
    expect(bests(s).easy).toBe(s[2]);
    expect(isBest(60, s[1])).toBe(true);
    expect(isBest(61, s[1])).toBe(false);
    expect(isBest(999, undefined)).toBe(true);
  });

  it("crops a photo to the level's shape from its middle", () => {
    expect(coverCrop(4000, 3000, 3, 4)).toEqual({ x: 875, y: 0, w: 2250, h: 3000 });
    expect(coverCrop(1080, 1920, 4, 5)).toEqual({ x: 0, y: 285, w: 1080, h: 1350 });
  });
});
