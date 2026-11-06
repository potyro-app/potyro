import { describe, expect, it } from "vitest";
import { anchorOp, anchorPosition, graphemeAt, graphemeFrom, opAnchor, positionAnchor, textFieldsOf, textRef, textRefOf, utf16Starts } from "../src/text-field.js";

// The pure parts of a collaborative text field: app code counts UTF-16 units, cojson counts
// graphemes, and the mapping between them must not split a family in half.

describe("UTF-16 units to graphemes", () => {
  const graphemes = ["a", "👩‍👩‍👧", "b"]; // 1 + 8 + 1 units
  const starts = utf16Starts(graphemes);

  it("knows where each grapheme starts and how long the whole is", () => {
    expect(starts).toEqual([0, 1, 9, 10]);
  });

  it("finds the grapheme holding a unit, and the end past it", () => {
    expect(graphemeAt(starts, 0)).toBe(0);
    expect(graphemeAt(starts, 1)).toBe(1);
    expect(graphemeAt(starts, 5)).toBe(1); // inside the family
    expect(graphemeAt(starts, 9)).toBe(2);
    expect(graphemeAt(starts, 10)).toBe(3); // the end
    expect(graphemeAt(starts, 99)).toBe(3);
    expect(graphemeAt(starts, -1)).toBe(0);
  });

  it("puts an insert inside a cluster after it, never in its middle", () => {
    expect(graphemeFrom(starts, 1)).toBe(1); // at the family's start: before it
    expect(graphemeFrom(starts, 5)).toBe(2); // inside it: after it
    expect(graphemeFrom(starts, 10)).toBe(3);
    expect(graphemeFrom(starts, 0)).toBe(0);
  });

  it("handles an empty text", () => {
    const empty = utf16Starts([]);
    expect(empty).toEqual([0]);
    expect(graphemeAt(empty, 0)).toBe(0);
    expect(graphemeFrom(empty, 3)).toBe(0);
  });
});

describe("the reference a record holds", () => {
  it("is recognised only in its exact shape", () => {
    expect(textRefOf(textRef("co_z1"))).toBe("co_z1");
    expect(textRefOf("co_z1")).toBeNull();
    expect(textRefOf({ "\u0003text": "co_z1", more: 1 })).toBeNull();
    expect(textRefOf({ text: "co_z1" })).toBeNull();
    expect(textRefOf(null)).toBeNull();
    expect(textRefOf(["\u0003text"])).toBeNull();
  });

  it("names the collaborative text fields of a schema", () => {
    const fields = textFieldsOf({
      doc: { title: { type: "text" }, body: { type: "text", multiline: true, collaborative: true } },
      note: { text: { type: "richtext" } },
    });
    expect([...fields.entries()].map(([e, f]) => [e, [...f]])).toEqual([["doc", ["body"]]]);
  });
});

describe("anchors", () => {
  it("round-trip an op, and a position from a store without ops", () => {
    expect(anchorOp(opAnchor("s:1:2"))).toBe("s:1:2");
    expect(anchorOp("end")).toBeNull();
    expect(anchorPosition(positionAnchor(7))).toBe(7);
    expect(anchorPosition("i:-1")).toBeNull();
    expect(anchorPosition("o:s:1:2")).toBeNull();
  });
});
