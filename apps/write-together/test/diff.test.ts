import { describe, expect, it } from "vitest";
import { applyEditsToRuns, diffEdits, freeColor, hashColor, initials, mapIndex, merge3, resolveColors, segments } from "../diff.js";

describe("what changed between two texts", () => {
  it("finds a typed character, a deletion and a replacement", () => {
    expect(diffEdits("hello", "hello!")).toEqual([{ at: 5, insert: "!" }]);
    expect(diffEdits("hello", "helo")).toEqual([{ from: 3, to: 4 }]);
    expect(diffEdits("the cat", "the dog")).toEqual([{ from: 4, to: 7 }, { at: 4, insert: "dog" }]);
    expect(diffEdits("", "a")).toEqual([{ at: 0, insert: "a" }]);
    expect(diffEdits("a", "")).toEqual([{ from: 0, to: 1 }]);
    expect(diffEdits("same", "same")).toEqual([]);
  });

  it("replaces an emoji whole rather than half of it", () => {
    // 😀 is 😀 and 😁 is 😁: they share the high surrogate.
    expect(diffEdits("a😀b", "a😁b")).toEqual([{ from: 1, to: 3 }, { at: 1, insert: "😁" }]);
  });

  it("prefers the earliest place when the change is ambiguous", () => {
    expect(diffEdits("aaa", "aaaa")).toEqual([{ at: 3, insert: "a" }]);
  });
});

describe("where the caret goes when the text changes under it", () => {
  it("stays before a change, shifts after it, lands after one it was inside", () => {
    expect(mapIndex("hello world", "hello big world", 3)).toBe(3);
    expect(mapIndex("hello world", "hello big world", 8)).toBe(12);
    expect(mapIndex("hello world", "hello cruel world", 6)).toBe(6);
    expect(mapIndex("hello world", "hello", 9)).toBe(5);
    expect(mapIndex("abc", "abc", 7)).toBe(3);
  });
});

describe("the runs under the keys", () => {
  const ana = { text: "Hello ", by: "ana" };
  const bo = { text: "world", by: "bo" };

  it("inserts the typist's own run, splitting another's", () => {
    expect(applyEditsToRuns([ana, bo], [{ at: 8, insert: "XY" }], "me")).toEqual([ana, { text: "wo", by: "bo" }, { text: "XY", by: "me" }, { text: "rld", by: "bo" }]);
    expect(applyEditsToRuns([ana, bo], [{ at: 11, insert: "!" }], "bo")).toEqual([ana, { text: "world!", by: "bo" }]);
    expect(applyEditsToRuns([], [{ at: 0, insert: "hi" }], "me")).toEqual([{ text: "hi", by: "me" }]);
  });

  it("deletes across runs and merges what is left", () => {
    expect(applyEditsToRuns([ana, bo], [{ from: 4, to: 8 }], "me")).toEqual([{ text: "Hell", by: "ana" }, { text: "rld", by: "bo" }]);
    expect(applyEditsToRuns([ana, { text: "x", by: "bo" }, { text: "tail", by: "ana" }], [{ from: 6, to: 7 }], "me")).toEqual([{ text: "Hello tail", by: "ana" }]);
  });
});

describe("the backdrop's segments", () => {
  it("cuts at every run and comment boundary, and knows which comments cover each piece", () => {
    const text = "Hello world";
    const runs = [
      { text: "Hello ", by: "ana" },
      { text: "world", by: "bo" },
    ];
    const out = segments(text, runs, [{ id: "c1", from: 2, to: 8 }]);
    expect(out).toEqual([
      { text: "He", by: "ana", comments: [] },
      { text: "llo ", by: "ana", comments: ["c1"] },
      { text: "wo", by: "bo", comments: ["c1"] },
      { text: "rld", by: "bo", comments: [] },
    ]);
  });

  it("draws the text uncoloured when the runs do not spell it", () => {
    expect(segments("abc", [{ text: "ab", by: "ana" }], [])).toEqual([{ text: "abc", by: null, comments: [] }]);
  });

  it("marks a point comment on the piece that starts there", () => {
    const out = segments("ab cd", [{ text: "ab cd", by: "ana" }], [{ id: "p", from: 3, to: 3 }]);
    expect(out.map((s) => [s.text, s.comments])).toEqual([
      ["ab ", []],
      ["cd", ["p"]],
    ]);
  });
});

describe("colours and names", () => {
  it("hands out the first free colour, then the least taken", () => {
    expect(freeColor([])).toBe(0);
    expect(freeColor([0, 1])).toBe(2);
    expect(freeColor([0, 1, 2, 3, 4, 5, 6, 7, 0])).toBe(1);
  });
  it("gives an unknown account a stable colour and a person initials", () => {
    expect(hashColor("co_zAna")).toBe(hashColor("co_zAna"));
    expect(initials("Ana Lima")).toBe("AL");
    expect(initials("bo")).toBe("B");
    expect(initials("  ")).toBe("?");
  });
});

describe("one text changed two ways at once", () => {
  it("keeps both changes when they are apart", () => {
    expect(merge3("Hello world", "Hello big world", "Hello world!")).toBe("Hello big world!");
    expect(merge3("Hello world", "Hello world!", "Hello big world")).toBe("Hello big world!");
    expect(merge3("abc", "abc", "xbc")).toBe("xbc");
    expect(merge3("abc", "abd", "abc")).toBe("abd");
    expect(merge3("the cat sat", "the sat", "the cat sat here")).toBe("the sat here");
  });
  it("puts ours after theirs when they overlap", () => {
    expect(merge3("the cat sat", "the dog sat", "the cow sat")).toBe("the cowdog sat");
    expect(merge3("abc", "aXbc", "aYbc")).toBe("aYXbc");
  });
});

describe("writers' colours", () => {
  it("are the ones on the records, unless an earlier writer wears it already", () => {
    const colors = resolveColors([
      { person: "bo", color: 0, createdAt: "2026-11-06T10:00:01Z" },
      { person: "ana", color: 0, createdAt: "2026-11-06T10:00:00Z" },
      { person: "cy", color: 3, createdAt: "2026-11-06T10:00:02Z" },
      { person: "di", color: 1, createdAt: "2026-11-06T10:00:03Z" },
    ]);
    expect([...colors.entries()]).toEqual([
      ["ana", 0],
      ["bo", 1],
      ["cy", 3],
      ["di", 2],
    ]);
  });
});
