import { describe, expect, test } from "vitest";
import { parseEdits, parseEditsStrict, applyEdits, describeEditFailures } from "../src/edits.js";

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

  test("a block with two ======= lines is malformed and dropped, and parseEditsStrict names it", () => {
    const twoDividers = "<<<<<<< SEARCH\nc\n=======\nd\n=======\ne\n>>>>>>> REPLACE";
    const reply = [block("a", "b"), block("p", "q"), twoDividers].join("\n");
    expect(parseEdits(reply)).toEqual([
      { search: "a", replace: "b" },
      { search: "p", replace: "q" },
    ]);
    expect(parseEditsStrict(reply).malformed).toEqual([{ index: 2, reason: "has more than one ======= line" }]);
  });

  test("an unterminated block is reported by parseEditsStrict", () => {
    const reply = block("a", "b") + "\n<<<<<<< SEARCH\nstray\n=======\nnever closed";
    expect(parseEditsStrict(reply).malformed).toEqual([{ index: 1, reason: "was never closed with >>>>>>> REPLACE" }]);
  });
});

// Two entities with identical field lines, so "matches one place" is a real question.
const FILE = [
  'import { defineApp } from "potyro";',
  "",
  "export default defineApp({",
  '  id: "x",',
  "  entities: {",
  "    place: {",
  "      fields: {",
  '        name: { type: "text", required: true },',
  "      },",
  "    },",
  "    city: {",
  "      fields: {",
  '        name: { type: "text", required: true },',
  "      },",
  "    },",
  "  },",
  "  pages: [",
  '    { id: "all", view: { type: "list", entity: "place" } },',
  "  ],",
  "});",
].join("\n");

describe("applyEdits", () => {
  test("replaces an exact match once, leaving every other line byte-identical", () => {
    const r = applyEdits(FILE, [
      {
        search: '    place: {\n      fields: {\n        name: { type: "text", required: true },\n      },',
        replace: '    place: {\n      fields: {\n        name: { type: "text", required: true },\n        rating: { type: "number" },\n      },',
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.applied).toBe(1);
    expect(r.source).toContain('        rating: { type: "number" },');
    // Everything else is untouched: remove the added line and the file is back exactly.
    expect(r.source.replace('        rating: { type: "number" },\n', "")).toBe(FILE);
  });

  test("applies edits in order, each seeing the previous one's result", () => {
    const r = applyEdits(FILE, [
      { search: '  id: "x",', replace: '  id: "y",' },
      { search: '  id: "y",', replace: '  id: "z",' },
    ]);
    expect(r.ok && r.source).toContain('  id: "z",');
  });

  test("an empty REPLACE deletes the matched lines", () => {
    const r = applyEdits(FILE, [{ search: '    { id: "all", view: { type: "list", entity: "place" } },\n', replace: "" }]);
    expect(r.ok && r.source).not.toContain('id: "all"');
  });

  // #136: `deepseek-v4-flash` writes `key:: value` when it copies a line. Measured on 2026-09-11 in the
  // edits eval (2 of 12 cases, both runs) and on a 300-line app (every attempt). `::` followed by a
  // space never occurs in a .app.ts, so reading it as `:` costs nothing — and the tolerance covers
  // REPLACE too, because the same tic lands in the replacement and would write `city:: {` into the file.
  test("reads a doubled colon before a space as a single one, in SEARCH and in REPLACE", () => {
    const r = applyEdits(FILE, [{ search: '  id:: "x",', replace: '  id:: "y",\n  name:: "Y",' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toContain('  id: "y",\n  name: "Y",');
    expect(r.source).not.toContain("::");
  });

  test("leaves a doubled colon that is not followed by a space alone (an IPv6 literal, say)", () => {
    const r = applyEdits(FILE, [{ search: '  id: "x",', replace: '  id: "::1",' }]);
    expect(r.ok && r.source).toContain('  id: "::1",');
  });

  test("matches when only trailing whitespace differs", () => {
    const r = applyEdits(FILE, [{ search: '  id: "x",   ', replace: '  id: "q",' }]);
    expect(r.ok && r.source).toContain('  id: "q",');
  });

  // The failure that shows up in practice: the model shifts the whole block it copied by a level.
  // The file's indentation wins, and the replacement is shifted by the same amount so it lands in
  // place — every line, so the block's internal structure survives.
  test("matches when indentation is uniformly off, and re-indents the replacement to the file", () => {
    const r = applyEdits(FILE, [
      {
        search: '  city: {\n    fields: {\n      name: { type: "text", required: true },',
        replace: '  city: {\n    fields: {\n      name: { type: "text", required: true },\n      notes: { type: "text" },',
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toContain('    city: {\n      fields: {\n        name: { type: "text", required: true },\n        notes: { type: "text" },\n      },');
  });

  // A SEARCH that is a fragment of a line, not whole lines, must not match: substituting inside a
  // line puts the replacement's other lines at the wrong depth, silently.
  test("matches whole lines only", () => {
    const r = applyEdits(FILE, [{ search: 'id: "x"', replace: 'id: "y"' }]);
    expect(r).toEqual({ ok: false, failures: [{ index: 0, reason: "not-found", search: 'id: "x"', count: 0 }] });
  });

  test("fails, naming the edit, when SEARCH is not in the file", () => {
    const r = applyEdits(FILE, [
      { search: '  id: "x",', replace: '  id: "y",' },
      { search: "this line does not exist", replace: "whatever" },
    ]);
    expect(r).toEqual({
      ok: false,
      failures: [{ index: 1, reason: "not-found", search: "this line does not exist", count: 0 }],
    });
  });

  test("fails when SEARCH matches more than one place", () => {
    const r = applyEdits(FILE, [{ search: '        name: { type: "text", required: true },', replace: "        name: { type: \"text\" }," }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failures[0]).toEqual({ index: 0, reason: "ambiguous", search: '        name: { type: "text", required: true },', count: 2 });
  });

  test("fails on an empty SEARCH — an edit must anchor somewhere", () => {
    const r = applyEdits(FILE, [{ search: "", replace: "// hello" }]);
    expect(r).toEqual({ ok: false, failures: [{ index: 0, reason: "empty-search", search: "", count: 0 }] });
  });

  test("is all-or-nothing: one failure discards the edits that did apply", () => {
    const r = applyEdits(FILE, [
      { search: '  id: "x",', replace: '  id: "y",' },
      { search: "nope", replace: "" },
    ]);
    expect(r.ok).toBe(false);
  });

  // Finding 1: the old tier-3 shift was anchored on the first SEARCH line only. When that line's
  // indentation already happens to match the file (the model got the entity's own line right but
  // flattened everything under it), `from === to` and the shift became a no-op — the replacement
  // landed at the model's (wrong) indentation while the edit still reported `ok: true`. The window
  // must count as a match only when the whole block shifts by the same amount.
  test("does not match when the first line lines up but the body was flattened", () => {
    const r = applyEdits(FILE, [
      {
        search: '    city: {\nfields: {\nname: { type: "text", required: true },',
        replace: '    city: {\nfields: {\nname: { type: "text", required: true },\nnotes: { type: "text" },',
      },
    ]);
    expect(r).toEqual({
      ok: false,
      failures: [
        {
          index: 0,
          reason: "not-found",
          search: '    city: {\nfields: {\nname: { type: "text", required: true },',
          count: 0,
        },
      ],
    });
  });

  // A block re-emitted flattened to one level — every line at column 0, or every line at the
  // anchor's own indent — is not a genuine uniform shift: only the first line's depth happens to
  // line up (or none do), and everything under it lost its nesting. Neither is a match.
  test("a block flattened to one level is not a match, whatever level that is", () => {
    const flatAtZero = applyEdits(FILE, [
      {
        search: 'city: {\nfields: {\nname: { type: "text", required: true },\n},\n},',
        replace: 'city: {\nfields: {\nname: { type: "text", required: true },\nnotes: { type: "text" },\n},\n},',
      },
    ]);
    expect(flatAtZero).toEqual({
      ok: false,
      failures: [
        {
          index: 0,
          reason: "not-found",
          search: 'city: {\nfields: {\nname: { type: "text", required: true },\n},\n},',
          count: 0,
        },
      ],
    });

    const flatAtAnchor = applyEdits(FILE, [
      {
        search: '    city: {\n    fields: {\n    name: { type: "text", required: true },\n    },\n    },',
        replace: '    city: {\n    fields: {\n    name: { type: "text", required: true },\n    notes: { type: "text" },\n    },\n    },',
      },
    ]);
    expect(flatAtAnchor).toEqual({
      ok: false,
      failures: [
        {
          index: 0,
          reason: "not-found",
          search: '    city: {\n    fields: {\n    name: { type: "text", required: true },\n    },\n    },',
          count: 0,
        },
      ],
    });
  });

  // Two search lines at the same indent must map to the same file indent. Here `fields` and `name`
  // are both written at 6 spaces, but the file has them at 6 and 8 — one search depth splitting
  // into two real depths, so the mapping disagrees with itself and this is not a match.
  test("two search lines at one depth whose file lines differ is not a match", () => {
    const r = applyEdits(FILE, [
      {
        search: '    city: {\n      fields: {\n      name: { type: "text", required: true },',
        replace: '    city: {\n      fields: {\n      name: { type: "text", required: true },\n      notes: { type: "text" },',
      },
    ]);
    expect(r).toEqual({
      ok: false,
      failures: [
        {
          index: 0,
          reason: "not-found",
          search: '    city: {\n      fields: {\n      name: { type: "text", required: true },',
          count: 0,
        },
      ],
    });
  });

  test("re-indents by the uniform shift taken from the first non-blank line", () => {
    const WITH_BLANK = FILE.replace("    city: {", "\n    city: {");
    const r = applyEdits(WITH_BLANK, [
      {
        search: '\n  city: {\n    fields: {\n      name: { type: "text", required: true },',
        replace: '\n  city: {\n    fields: {\n      name: { type: "text", required: true },\n      notes: { type: "text" },',
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toContain(
      '    city: {\n      fields: {\n        name: { type: "text", required: true },\n        notes: { type: "text" },',
    );
  });

  // Finding 2: edits chain, each applied to the result of the one before, so once one fails every
  // later edit is checked against a file state that will never exist — reporting those as failures
  // too is just noise (and can wrongly tell the model a correct edit "was not found").
  test("reports only the first failure when edits chain", () => {
    const r = applyEdits(FILE, [
      { search: '  id: "nope",', replace: '  id: "y",' },
      { search: '  id: "y",', replace: '  id: "z",' },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]!.index).toBe(0);
  });

  test("tab-indented search against a space-indented file re-indents cleanly", () => {
    const r = applyEdits(FILE, [
      {
        search: '\tcity: {\n\t\tfields: {\n\t\t\tname: { type: "text", required: true },',
        replace: '\tcity: {\n\t\tfields: {\n\t\t\tname: { type: "text", required: true },\n\t\t\tnotes: { type: "text" },',
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toContain(
      '    city: {\n      fields: {\n        name: { type: "text", required: true },\n        notes: { type: "text" },',
    );
    expect(r.source).not.toContain("\t");
  });
});

describe("describeEditFailures", () => {
  test("tells the model which edit failed and what to do about it, by number starting at 1", () => {
    const text = describeEditFailures([
      { index: 1, reason: "not-found", search: "abc", count: 0 },
      { index: 2, reason: "ambiguous", search: "},", count: 4 },
      { index: 0, reason: "empty-search", search: "", count: 0 },
      { index: 2, reason: "malformed", search: "", count: 0, detail: "has more than one ======= line" },
    ]);
    expect(text).toMatch(/edit 2.*not found/i);
    expect(text).toMatch(/exactly as .*appear/i);
    expect(text).toMatch(/edit 3.*4 places/i);
    expect(text).toMatch(/edit 1.*empty/i);
    expect(text).toMatch(/edit 3 is malformed.*more than one =======/i);
  });
});

// #75: two quiet failures of the applier, found in review.
describe("applyEdits — what used to pass silently", () => {
  test("an edit whose only change is a trailing blank line is reported, not applied as ok", () => {
    const source = "const a = 1;\nconst b = 2;\n";
    const r = applyEdits(source, [{ search: "const a = 1;", replace: "const a = 1;\n\n" }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failures[0]!.reason).toBe("no-change");
    expect(describeEditFailures(r.failures)).toMatch(/Edit 1 changes nothing/);
    // A real change next to a blank line still applies.
    expect(applyEdits(source, [{ search: "const a = 1;", replace: "const a = 1;\n\nconst c = 3;" }]).ok).toBe(true);
    // And an echo that repeats the SEARCH exactly is left alone, as before.
    expect(applyEdits(source, [{ search: "const a = 1;", replace: "const a = 1;" }]).ok).toBe(true);
  });

  test("a line deeper than the window showed is re-indented in the file's unit, not the model's", () => {
    const file = ["export default {", "  a: {", "    b: {", "      c: 1,", "    },", "  },", "};"].join("\n");
    const r = applyEdits(file, [
      {
        search: "\ta: {\n\t\tb: {",
        replace: "\ta: {\n\t\tb: {\n\t\t\td: {\n\t\t\t\te: 2,\n\t\t\t},",
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toContain("  a: {\n    b: {\n      d: {\n        e: 2,\n      },");
    expect(r.source).not.toContain("\t");
  });
});
