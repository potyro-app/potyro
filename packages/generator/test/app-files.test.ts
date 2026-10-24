import { describe, expect, it } from "vitest";
import { ENTRY_FILE, FILE_MARK, appFilesNote, canJoinAppFiles, isJoinedApp, joinAppFiles, splitAppFiles } from "../src/app-files.js";
import { buildModifyOpener } from "../src/prompt.js";
import { applyEdits } from "../src/edits.js";

// An app of several files, shown to the model as one text (#448): joined and split back without a
// byte changing, refused when an edit broke a marker or invented a file, and the opener says so only
// for such an app.
const ENTRY = 'import { EMPTY } from "./words.ts";\nexport default EMPTY;\n';
const MODULES = { "words.ts": 'export const EMPTY = "nothing";\n', "card.ts": "export const size = 12;\n" };

describe("an app of several files as one text", () => {
  it("joins with the entry first and splits back to the same files", () => {
    const text = joinAppFiles(ENTRY, MODULES);
    expect(isJoinedApp(text)).toBe(true);
    expect(text.split("\n").filter((l) => l.startsWith(FILE_MARK))).toEqual([`${FILE_MARK}${ENTRY_FILE}`, `${FILE_MARK}card.ts`, `${FILE_MARK}words.ts`]);
    expect(splitAppFiles(text, Object.keys(MODULES))).toEqual({ ok: true, entry: ENTRY, modules: MODULES });
  });

  it("a SEARCH/REPLACE edit lands in the module that holds the lines", () => {
    const text = joinAppFiles(ENTRY, MODULES);
    const edited = applyEdits(text, [{ search: "export const size = 12;", replace: "export const size = 16;" }]);
    expect(edited.ok).toBe(true);
    const split = splitAppFiles((edited as { source: string }).source, Object.keys(MODULES));
    expect(split).toEqual({ ok: true, entry: ENTRY, modules: { ...MODULES, "card.ts": "export const size = 16;\n" } });
  });

  it("refuses a text whose marker lines were broken, or that adds a file", () => {
    const text = joinAppFiles(ENTRY, MODULES);
    const lost = splitAppFiles(text.replace(`${FILE_MARK}card.ts\n`, ""), Object.keys(MODULES));
    expect(lost).toMatchObject({ ok: false, problem: expect.stringContaining("card.ts") });
    const added = splitAppFiles(`${text}${FILE_MARK}new.ts\nexport const x = 1;\n`, Object.keys(MODULES));
    expect(added).toMatchObject({ ok: false, problem: expect.stringContaining("cannot be added") });
    expect(splitAppFiles(ENTRY, Object.keys(MODULES))).toMatchObject({ ok: false });
  });

  it("files with a line of their own that reads as a marker are not joined: the split could not tell them apart", () => {
    expect(canJoinAppFiles(ENTRY, MODULES)).toBe(true);
    expect(canJoinAppFiles(ENTRY, { ...MODULES, "doc.ts": `// how it is shown:\n${FILE_MARK}<name>\nexport const x = 1;\n` })).toBe(false);
    expect(canJoinAppFiles(`${FILE_MARK}nope\n${ENTRY}`, MODULES)).toBe(false);
  });

  it("the opener names the files for a joined app, and is unchanged for an app of one file", () => {
    expect(buildModifyOpener(ENTRY)).toBe(buildModifyOpener());
    const opener = buildModifyOpener(joinAppFiles(ENTRY, MODULES));
    expect(opener).toContain(appFilesNote(["card.ts", "words.ts"]));
  });
});
