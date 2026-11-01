// The "Day done" picture's keyboard (#484): black keys where a piano has them.
import { describe, expect, it } from "vitest";
import { keyboard } from "../card.js";

describe("keyboard", () => {
  it("spreads the white keys evenly across the width", () => {
    const { white } = keyboard(1050, 15);
    expect(white).toHaveLength(15);
    expect(white[0]).toEqual({ x: 0, w: 70 });
    expect(white[14]!.x + white[14]!.w).toBe(1050);
  });

  it("puts black keys in groups of two and three: C# D#, F# G# A#", () => {
    const { black } = keyboard(700, 7);
    // Between C–D, D–E, F–G, G–A, A–B; none between E–F or B–C.
    expect(black.map((k) => Math.round(k.x + k.w / 2))).toEqual([100, 200, 400, 500, 600]);
    expect(black.every((k) => k.w === 60)).toBe(true);
  });

  it("has ten black keys over two octaves and a C, none after the last white key", () => {
    expect(keyboard(1080, 15).black).toHaveLength(10);
  });
});
