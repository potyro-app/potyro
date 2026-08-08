// The diff is what makes an AI edit reviewable — "what changed?" is answered here or nowhere.

import { describe, expect, it } from "vitest";
import { diffLines, diffStat, toHunks } from "../src/diff.js";

const render = (before: string, after: string): string[] =>
  diffLines(before, after).map((l) => `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`);

describe("diffLines", () => {
  it("reports no changes for identical sources", () => {
    const src = "a\nb\nc\n";
    expect(diffStat(diffLines(src, src))).toEqual({ added: 0, removed: 0 });
    expect(toHunks(diffLines(src, src))).toEqual([]);
  });

  it("finds a line inserted in the middle, keeping the surrounding lines as context", () => {
    expect(render("a\nb\nc", "a\nx\nb\nc")).toEqual([" a", "+x", " b", " c"]);
    expect(diffStat(diffLines("a\nb\nc", "a\nx\nb\nc"))).toEqual({ added: 1, removed: 0 });
  });

  it("finds a deleted line", () => {
    expect(render("a\nb\nc", "a\nc")).toEqual([" a", "-b", " c"]);
  });

  it("reports a changed line as a delete plus an add", () => {
    expect(render("a\nb\nc", "a\nB\nc")).toEqual([" a", "-b", "+B", " c"]);
    expect(diffStat(diffLines("a\nb\nc", "a\nB\nc"))).toEqual({ added: 1, removed: 1 });
  });

  it("handles an empty side", () => {
    expect(diffStat(diffLines("", "a\nb"))).toEqual({ added: 2, removed: 0 });
    expect(diffStat(diffLines("a\nb", ""))).toEqual({ added: 0, removed: 2 });
  });

  it("does not treat a trailing newline as an extra line", () => {
    expect(diffStat(diffLines("a\nb", "a\nb\n"))).toEqual({ added: 0, removed: 0 });
  });

  it("numbers lines against the source each side came from", () => {
    const lines = diffLines("a\nb\nc", "a\nx\nc");
    const del = lines.find((l) => l.kind === "del");
    const add = lines.find((l) => l.kind === "add");
    expect(del).toMatchObject({ text: "b", a: 2 });
    expect(add).toMatchObject({ text: "x", b: 2 });
    expect(del?.b).toBeUndefined();
    expect(add?.a).toBeUndefined();
  });

  it("aligns a realistic edit: one field added to an app module", () => {
    const before = [
      "export default defineApp({",
      '  id: "books",',
      "  entities: {",
      "    book: {",
      "      fields: {",
      '        title: { type: "text" },',
      "      },",
      "    },",
      "  },",
      "});",
    ].join("\n");
    const after = before.replace('        title: { type: "text" },', '        title: { type: "text" },\n        rating: { type: "number" },');
    const lines = diffLines(before, after);
    expect(diffStat(lines)).toEqual({ added: 1, removed: 0 });
    expect(lines.find((l) => l.kind === "add")?.text).toBe('        rating: { type: "number" },');
  });
});

describe("toHunks", () => {
  it("collapses long unchanged stretches, keeping context around each change", () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 20", "line 20 CHANGED");
    const hunks = toHunks(diffLines(before, after));
    expect(hunks).toHaveLength(1);
    // 3 lines of context each side + the delete + the add.
    expect(hunks[0].lines).toHaveLength(8);
    expect(hunks[0].skippedBefore).toBe(17);
  });

  it("keeps separate changes in separate hunks", () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 5", "five").replace("line 30", "thirty");
    expect(toHunks(diffLines(before, after))).toHaveLength(2);
  });
});
