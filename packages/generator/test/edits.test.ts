import { describe, expect, test } from "vitest";
import { parseEdits } from "../src/edits.js";

// The reply shape a modify turn asks for. A block is three marker lines around two bodies; the
// parser must read them wherever they sit — inside a ```ts fence, outside one, several in a row —
// and take the bodies VERBATIM, because SEARCH is matched character for character.

const block = (search: string, replace: string) =>
  ["<<<<<<< SEARCH", search, "=======", replace, ">>>>>>> REPLACE"].join("\n");

describe("parseEdits", () => {
  test("reads one block inside a ts fence", () => {
    const reply = "Adding the field.\n```ts\n" + block("  a: 1,", "  a: 1,\n  b: 2,") + "\n```\n";
    expect(parseEdits(reply)).toEqual([{ search: "  a: 1,", replace: "  a: 1,\n  b: 2," }]);
  });

  test("reads several blocks, in order, fenced or not", () => {
    const reply = block("x", "y") + "\n\n```\n" + block("p", "q") + "\n```";
    expect(parseEdits(reply)).toEqual([
      { search: "x", replace: "y" },
      { search: "p", replace: "q" },
    ]);
  });

  test("keeps indentation and blank lines inside the bodies exactly", () => {
    const search = "    fields: {\n\n      name: { type: \"text\" },";
    const reply = block(search, "    fields: {\n      name: { type: \"text\" },\n      rating: { type: \"number\" },");
    expect(parseEdits(reply)[0]!.search).toBe(search);
  });

  test("an empty REPLACE body is a deletion, not a parse failure", () => {
    expect(parseEdits(block("gone", ""))).toEqual([{ search: "gone", replace: "" }]);
  });

  test("tolerates CRLF and trailing spaces on marker lines", () => {
    const reply = "<<<<<<< SEARCH  \r\nold\r\n=======\r\nnew\r\n>>>>>>> REPLACE\r\n";
    expect(parseEdits(reply)).toEqual([{ search: "old", replace: "new" }]);
  });

  test("a reply with no blocks yields nothing", () => {
    expect(parseEdits("Here is the whole file:\n```ts\nexport default defineApp({});\n```")).toEqual([]);
  });

  test("an unterminated block is dropped rather than half-read", () => {
    const reply = block("a", "b") + "\n<<<<<<< SEARCH\nstray\n=======\nnever closed";
    expect(parseEdits(reply)).toEqual([{ search: "a", replace: "b" }]);
  });
});
