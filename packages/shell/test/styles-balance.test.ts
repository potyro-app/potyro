import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A merge once dropped one "}" from styles.css. Nothing failed: CSS nesting quietly turned every rule
// after it into a descendant of the unclosed one, and new styles simply did not apply. This is the
// check that would have said so.

describe("styles.css", () => {
  it("closes every block it opens, and never closes one it did not open", () => {
    const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0;
    let line = 1;
    let firstTopLevelInside: number | null = null;
    for (const [i, ch] of [...css].entries()) {
      if (ch === "\n") {
        line += 1;
        // A rule starting at the left margin is meant to be top level.
        if (depth > 0 && firstTopLevelInside === null && /^[.#a-z:[*]/i.test(css.slice(i + 1, i + 2))) firstTopLevelInside = line;
      }
      if (ch === "{") depth += 1;
      if (ch === "}") depth -= 1;
      expect(depth, `a "}" with nothing open, line ${line}`).toBeGreaterThanOrEqual(0);
    }
    expect(depth, `unclosed block; the first rule swallowed by it is on line ${firstTopLevelInside}`).toBe(0);
  });
});
