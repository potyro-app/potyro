import { describe, expect, it } from "vitest";
import { placeUnder } from "../src/popover.js";

// A panel anchored to a control: under it when it fits, above it when it does not, and above it
// hangs from its bottom edge so a list that shrinks while you search stays against the control.

const viewport = { width: 1280, height: 900 };
const rect = (top: number, left = 100, height = 40, width = 300): DOMRect =>
  ({ top, left, bottom: top + height, right: left + width, width, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

describe("placeUnder", () => {
  it("goes under the control when the panel fits there", () => {
    expect(placeUnder(rect(100), { width: 300, height: 300 }, viewport)).toEqual({ top: 146, left: 100 });
  });

  it("flips above near the bottom, anchored by its bottom edge", () => {
    const p = placeUnder(rect(700), { width: 300, height: 400 }, viewport);
    expect(p.top).toBeUndefined();
    // 6px above the control's top, measured from the bottom of the window.
    expect(p.bottom).toBe(900 - 700 + 6);
  });

  it("stays below when below has more room, even if the panel does not fit either way", () => {
    expect(placeUnder(rect(300), { width: 300, height: 800 }, viewport).top).toBe(346);
  });

  it("never runs off the right edge", () => {
    expect(placeUnder(rect(100, 1100), { width: 300, height: 100 }, viewport).left).toBe(1280 - 8 - 300);
  });
});
