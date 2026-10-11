// @vitest-environment happy-dom
//
// The highlighter's contract is narrow but load-bearing: one entry per source line, every character
// preserved, and never a thrown error — the Studio paints these runs behind a live textarea, so a
// dropped line or a lost space misaligns the caret from the code under it.

import { beforeEach, describe, expect, it } from "vitest";
import { highlightLines, resetHighlighter, type CodeRun } from "../src/highlight.js";

const text = (lines: CodeRun[][]): string => lines.map((l) => l.map((r) => r.text).join("")).join("\n");
const classesOn = (line: CodeRun[]): string[] => line.flatMap((r) => (r.cls ? [r.cls] : []));

beforeEach(resetHighlighter);

describe("highlightLines", () => {
  it("returns one entry per line and preserves the source exactly", async () => {
    const src = 'const a = 1;\n\nfunction f() {\n  return "x";\n}\n';
    const lines = await highlightLines(src);

    expect(lines).toHaveLength(src.split("\n").length);
    expect(text(lines)).toBe(src);
  });

  it("keeps leading whitespace, which the paint layer aligns on", async () => {
    const lines = await highlightLines('if (x) {\n    return "deep";\n}');
    expect(lines[1]!.map((r) => r.text).join("")).toBe('    return "deep";');
  });

  it("classifies keywords and strings", async () => {
    const lines = await highlightLines('const name = "potyro";');
    const classes = classesOn(lines[0]!).join(" ");
    expect(classes).toContain("keyword");
    expect(classes).toContain("string");
  });

  it("highlights TSX — a custom view is a React component in the same file", async () => {
    const lines = await highlightLines("const el = <div className=\"k\">{total} ml</div>;");
    const classes = classesOn(lines[0]!).join(" ");
    expect(classes).toMatch(/tag|attr-name|punctuation/);
    expect(text(lines)).toBe("const el = <div className=\"k\">{total} ml</div>;");
  });

  it("splits a token that spans lines, keeping its class on each part", async () => {
    // A block comment is one Prism token across three lines. Handing the Studio one run for three
    // lines would shift every line after it.
    const src = "/* one\n   two\n   three */\nconst a = 1;";
    const lines = await highlightLines(src);

    expect(lines).toHaveLength(4);
    expect(text(lines)).toBe(src);
    for (const i of [0, 1, 2]) expect(classesOn(lines[i]!).join(" ")).toContain("comment");
  });

  it("handles a template literal with an interpolation", async () => {
    const src = "const s = `a ${b} c`;";
    const lines = await highlightLines(src);
    expect(text(lines)).toBe(src);
    expect(classesOn(lines[0]!).join(" ")).toContain("template");
  });

  it("never emits markup — callers render spans, so source can never inject", async () => {
    // Source can arrive from an app someone else wrote. Runs are plain strings by construction;
    // this pins that, so nobody later "optimises" it into an HTML string.
    const src = 'const evil = "</textarea><script>alert(1)</script>";';
    const lines = await highlightLines(src);

    expect(text(lines)).toBe(src);
    for (const run of lines.flat()) expect(typeof run.text).toBe("string");
    // The dangerous characters survive as TEXT, unescaped — which is only safe because no caller
    // ever hands these to innerHTML.
    expect(text(lines)).toContain("<script>");
  });

  it("degrades to plain lines rather than throwing", async () => {
    // Empty source, trailing newlines, and lone newlines are the shapes an editor produces mid-typing.
    for (const src of ["", "\n", "\n\n\n", "   "]) {
      const lines = await highlightLines(src);
      expect(text(lines)).toBe(src);
      expect(lines).toHaveLength(src.split("\n").length);
    }
  });
});
