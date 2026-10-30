import { describe, expect, it } from "vitest";
import { stripFrontmatter } from "../src/corpus-files.js";

describe("stripFrontmatter", () => {
  it("removes a leading frontmatter block and the blank line after it", () => {
    const text = "---\ntitle: X\nstatus: current\n---\n\n# X\n\nBody.\n";
    expect(stripFrontmatter(text)).toBe("# X\n\nBody.\n");
  });

  it("leaves a text with no frontmatter alone", () => {
    expect(stripFrontmatter("# X\n\n---\n\nA rule, not frontmatter.\n")).toBe(
      "# X\n\n---\n\nA rule, not frontmatter.\n",
    );
  });

  it("leaves an unterminated block alone rather than eating the file", () => {
    expect(stripFrontmatter("---\ntitle: X\n# never closed\n")).toBe("---\ntitle: X\n# never closed\n");
  });

  it("accepts CRLF line endings", () => {
    expect(stripFrontmatter("---\r\ntitle: X\r\n---\r\n\r\n# X\r\n")).toBe("# X\r\n");
  });
});
