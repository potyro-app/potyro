import { describe, expect, it } from "vitest";
import { applyEdit, mapEditsOnto } from "../src/text-transform.js";

describe("edits counted in one text, applied to another", () => {
  it("come back unchanged when nothing moved", () => {
    expect(mapEditsOnto("abc", "abc", [{ at: 1, insert: "x" }, { from: 0, to: 1 }])).toEqual([{ at: 1, insert: "x" }, { from: 0, to: 1 }]);
  });

  it("shift past someone else's insert in front, and stay put before one behind", () => {
    // Ana saw "Hello from Ana." and typed at its end; Bo's "Note: " landed in front meanwhile.
    expect(mapEditsOnto("Hello from Ana.", "Note: Hello from Ana.", [{ at: 15, insert: " And Bo." }])).toEqual([{ at: 21, insert: " And Bo." }]);
    expect(mapEditsOnto("Hello from Ana.", "Hello from Ana. And Bo.", [{ at: 0, insert: "Note: " }])).toEqual([{ at: 0, insert: "Note: " }]);
  });

  it("maps a run of keystrokes one after the other", () => {
    const base = "Hello";
    const current = "XXHello"; // two letters arrived in front
    const edits = [{ at: 5, insert: "!" }, { at: 6, insert: "?" }, { from: 0, to: 1 }];
    const mapped = mapEditsOnto(base, current, edits);
    expect(mapped).toEqual([{ at: 7, insert: "!" }, { at: 8, insert: "?" }, { from: 2, to: 3 }]);
    expect(mapped.reduce(applyEdit, current)).toBe("XXello!?");
  });

  it("lands an insert inside someone else's replaced words after them, and drops a deletion of words already gone", () => {
    expect(mapEditsOnto("the cat sat", "the dog sat", [{ at: 5, insert: "X" }])).toEqual([{ at: 7, insert: "X" }]);
    expect(mapEditsOnto("the cat sat", "the sat", [{ from: 4, to: 7 }])).toEqual([]);
    expect(mapEditsOnto("abc", "ac", [{ from: 0, to: 3 }])).toEqual([{ from: 0, to: 2 }]);
  });
});
