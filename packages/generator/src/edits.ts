// The edit format a modify turn asks for, and how the host applies it.
//
// WHY THIS EXISTS. "Modify the app" used to ask for the complete updated file. Measured on DeepSeek
// V4 Flash (2026-09-09, 20 samples): one reply renamed a page while reproducing the file, and two
// came back with damage in lines the change never touched — `entity:` retyped as `entityDemo:`,
// every `:` doubled, a stray word after a `for`. Retyping two hundred lines to change three is the
// defect; this format removes the retyping. The model sends only the lines it changes, as blocks:
//
//   <<<<<<< SEARCH
//   <lines copied from the file, exactly>
//   =======
//   <what they become>
//   >>>>>>> REPLACE
//
// and the host does the substitution. Lines the model does not mention cannot be damaged.
//
// This module is pure string work with no imports, so it is safe in the browser bundle.

export interface SearchReplace {
  /** Consecutive lines as they appear in the file. Matched exactly first, then more leniently. */
  search: string;
  /** What those lines become. Empty means delete them. */
  replace: string;
}

const SEARCH_MARK = /^<{5,9} SEARCH\s*$/;
const DIVIDER_MARK = /^={5,9}\s*$/;
const REPLACE_MARK = /^>{5,9} REPLACE\s*$/;

/**
 * Every complete SEARCH/REPLACE block in a reply, in order. Bodies are verbatim: the search text is
 * matched against the file, so a parser that "tidied" it would break the match it exists to make.
 * An unterminated block is dropped — a half-read edit applied to a file is worse than no edit.
 */
export function parseEdits(reply: string): SearchReplace[] {
  const lines = reply.replace(/\r\n?/g, "\n").split("\n");
  const out: SearchReplace[] = [];
  let state: "outside" | "search" | "replace" = "outside";
  let search: string[] = [];
  let replace: string[] = [];
  for (const line of lines) {
    if (state === "outside") {
      if (SEARCH_MARK.test(line)) {
        state = "search";
        search = [];
        replace = [];
      }
      continue;
    }
    if (state === "search") {
      if (DIVIDER_MARK.test(line)) state = "replace";
      else if (SEARCH_MARK.test(line)) search = []; // a restarted block: keep the later one
      else search.push(line);
      continue;
    }
    if (REPLACE_MARK.test(line)) {
      out.push({ search: search.join("\n"), replace: replace.join("\n") });
      state = "outside";
    } else if (SEARCH_MARK.test(line)) {
      // A new block opened before this one closed: the open one was never terminated. Drop it.
      state = "search";
      search = [];
      replace = [];
    } else {
      replace.push(line);
    }
  }
  return out;
}
