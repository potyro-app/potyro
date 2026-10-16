import { describe, expect, it } from "vitest";
import { addClear, addPiece, emptySketch, lastOp, pointsOf, undo, visible } from "../sketch.js";
import { ALPHABET, CODE_LENGTH, newCode, parseCode, roomIdFor, showCode } from "../code.js";
import { seeded } from "../words.js";

describe("the drawing of a turn", () => {
  it("pieces land in their place, whatever order they arrive in, and a repeat does not double", () => {
    let sk = emptySketch();
    sk = addPiece(sk, { s: 1, q: 1, c: 0, w: 0, pts: [3, 3, 4, 4] });
    sk = addPiece(sk, { s: 1, q: 0, c: 0, w: 0, pts: [1, 1, 2, 2] });
    sk = addPiece(sk, { s: 1, q: 1, c: 0, w: 0, pts: [3, 3, 4, 4] });
    sk = addPiece(sk, { s: 1, q: 2, c: 0, w: 0, pts: [5, 5], end: true });
    const [s] = visible(sk);
    expect(pointsOf(s!)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(s!.done).toBe(true);
  });

  it("strokes keep the drawer's order even when one arrives late", () => {
    let sk = emptySketch();
    sk = addPiece(sk, { s: 3, q: 0, c: 0, w: 0, pts: [3, 3] });
    sk = addPiece(sk, { s: 1, q: 0, c: 0, w: 0, pts: [1, 1] });
    sk = addPiece(sk, { s: 2, q: 0, c: 0, w: 0, pts: [2, 2] });
    expect(visible(sk).map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it("a clear hides what came before; undoing the clear brings it back", () => {
    let sk = addPiece(emptySketch(), { s: 1, q: 0, c: 0, w: 0, pts: [1, 1], end: true });
    sk = addClear(sk, 2);
    expect(visible(sk)).toEqual([]);
    sk = addPiece(sk, { s: 3, q: 0, c: 0, w: 0, pts: [3, 3], end: true });
    expect(visible(sk).map((s) => s.id)).toEqual([3]);
    expect(lastOp(sk)).toBe(3);
    sk = undo(sk, 3);
    sk = undo(sk, 2);
    expect(visible(sk).map((s) => s.id)).toEqual([1]);
  });

  it("a late piece of an undone stroke does not bring it back", () => {
    let sk = addPiece(emptySketch(), { s: 1, q: 0, c: 0, w: 0, pts: [1, 1] });
    sk = undo(sk, 1);
    sk = addPiece(sk, { s: 1, q: 1, c: 0, w: 0, pts: [2, 2], end: true });
    expect(visible(sk)).toEqual([]);
  });
});

describe("the game's code", () => {
  it("is twelve characters with no look-alikes, shown in threes of four", () => {
    const code = newCode(seeded(5));
    expect(code).toHaveLength(CODE_LENGTH);
    for (const ch of code) expect(ALPHABET).toContain(ch);
    expect(ALPHABET).not.toMatch(/[01IOL]/);
    expect(showCode("KQ7MXR4P2DHC")).toBe("KQ7M-XR4P-2DHC");
  });

  it("reads back however it was typed", () => {
    expect(parseCode("kq7m-xr4p-2dhc")).toBe("KQ7MXR4P2DHC");
    expect(parseCode(" KQ7M XR4P 2DHC ")).toBe("KQ7MXR4P2DHC");
    expect(parseCode("KQ7M-XR4P")).toBeNull();
    expect(parseCode("KQ7M-XR4P-2DH0")).toBeNull(); // 0 is not in the alphabet
  });

  it("opens a room id the relay accepts (22–64 base64url characters)", () => {
    expect(roomIdFor("KQ7MXR4P2DHC")).toMatch(/^[A-Za-z0-9_-]{22,64}$/);
  });
});
