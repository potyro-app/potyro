// The element-wise merge rules, on their own (KA-38).
//
// `concurrency-hazards.test.ts` proves the behaviour across two real cojson nodes, which is the test
// that matters. These pin the edges that are awkward to reach from there: ordering that two devices
// must agree on, elements that contain the separator, and the guard that keeps a non-scalar array
// out of a mechanism that turns elements into keys.

import { describe, expect, it } from "vitest";
import { foldSet, foldSetFields, isScalarSet, isSetField, parseSetKey, setFieldsOf, setKey, setWrites } from "../src/set-field.js";

describe("which fields merge element-wise", () => {
  it("takes tags, and relation/member only when they are many", () => {
    expect(isSetField({ type: "tags" } as never)).toBe(true);
    expect(isSetField({ type: "relation", to: "x", many: true } as never)).toBe(true);
    expect(isSetField({ type: "member", many: true } as never)).toBe(true);

    // A single relation has ONE answer, and the newest one is right. Merging it element-wise would
    // let two devices keep both, which is not what "one assignee" means.
    expect(isSetField({ type: "relation", to: "x" } as never)).toBe(false);
    expect(isSetField({ type: "member" } as never)).toBe(false);
    // Rows, possibly ordered — that is the ordering work, not this.
    expect(isSetField({ type: "list", of: {} } as never)).toBe(false);
    expect(isSetField({ type: "text" } as never)).toBe(false);
  });

  it("indexes only the entities that have one", () => {
    const fields = setFieldsOf({
      item: { title: { type: "text" }, tags: { type: "tags" } },
      note: { body: { type: "text" } },
    } as never);
    expect([...fields.keys()]).toEqual(["item"]);
    expect([...fields.get("item")!]).toEqual(["tags"]);
  });
});

describe("keys", () => {
  it("round-trips an element that contains the separator", () => {
    // Field names cannot contain it; values are whatever a person typed. Splitting on the FIRST
    // occurrence is what keeps the element whole.
    const weird = "a\u0002b";
    const key = setKey("tags", weird);
    expect(parseSetKey(key)).toEqual({ field: "tags", element: weird });
  });

  it("leaves an ordinary field alone", () => {
    expect(parseSetKey("tags")).toBeNull();
    expect(parseSetKey("\u0002lonely"), "a separator at the start leaves no field name").toBeNull();
  });
});

describe("folding a base and its deltas", () => {
  it("keeps base order, then appends what was added, sorted", () => {
    // Sorted because insertion order is not recoverable across peers, and two devices holding the
    // same set must not render it in two different orders.
    const deltas = new Map([["zebra", true], ["apple", true]]);
    expect(foldSet(["food", "cheap"], deltas)).toEqual(["food", "cheap", "apple", "zebra"]);
  });

  it("drops what was removed, wherever it sat", () => {
    expect(foldSet(["a", "b", "c"], new Map([["b", false]]))).toEqual(["a", "c"]);
  });

  it("re-adding something removed brings it back", () => {
    expect(foldSet(["a"], new Map([["a", false]]))).toEqual([]);
    expect(foldSet(["a"], new Map([["a", true]]))).toEqual(["a"]);
  });

  it("survives a base that is not an array", () => {
    expect(foldSet(null, new Map([["a", true]]))).toEqual(["a"]);
    expect(foldSet(undefined, new Map())).toEqual([]);
  });

  it("leaves a record with no element keys untouched", () => {
    // The overwhelmingly common case: this must not rewrite ordinary records on the way out.
    const raw = { id: "1", tags: ["food"] };
    expect(foldSetFields(raw)).toBe(raw);
  });

  it("hides the element keys and shows the merged array", () => {
    const folded = foldSetFields({ id: "1", tags: ["food"], [setKey("tags", "urgent")]: 1, [setKey("tags", "food")]: 0 });
    expect(folded).toEqual({ id: "1", tags: ["urgent"] });
  });
});

describe("what a whole-array write actually changed", () => {
  it("appending one tag writes one key", () => {
    // The entire point. Re-asserting the untouched elements is what clobbers a concurrent add.
    expect(setWrites(["a", "b"], ["a", "b", "c"])).toEqual([["c", true]]);
  });

  it("reports removals as absent", () => {
    expect(setWrites(["a", "b"], ["a"])).toEqual([["b", false]]);
  });

  it("says nothing when nothing changed", () => {
    expect(setWrites(["a", "b"], ["b", "a"])).toEqual([]);
  });

  it("clearing marks every element absent", () => {
    expect(setWrites(["a", "b"], [])).toEqual([["a", false], ["b", false]]);
  });
});

describe("the scalar guard", () => {
  it("refuses anything whose elements cannot be keys", () => {
    expect(isScalarSet(["a", "b"])).toBe(true);
    expect(isScalarSet([])).toBe(true);
    expect(isScalarSet([{ step: "mix" }])).toBe(false);
    expect(isScalarSet(["a", 2])).toBe(false);
    expect(isScalarSet(null)).toBe(false);
    expect(isScalarSet("a")).toBe(false);
  });
});
