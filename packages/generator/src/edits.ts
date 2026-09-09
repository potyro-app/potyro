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

export type EditFailureReason = "not-found" | "ambiguous" | "empty-search";

export interface EditFailure {
  /** Zero-based position of the edit in the reply. `describeEditFailures` shows it one-based. */
  index: number;
  reason: EditFailureReason;
  search: string;
  /** How many places matched — 0 for not-found, >1 for ambiguous. */
  count: number;
}

export type ApplyResult = { ok: true; source: string; applied: number } | { ok: false; failures: EditFailure[] };

const indentOf = (line: string): string => /^[ \t]*/.exec(line)![0];

/** Shift every non-blank line of `text` from `from` indentation to `to`. */
function reindent(text: string, from: string, to: string): string {
  if (from === to) return text;
  return text
    .split("\n")
    .map((l) => {
      if (l.trim() === "") return l;
      return l.startsWith(from) ? to + l.slice(from.length) : l;
    })
    .join("\n");
}

/**
 * Where `search` sits in `lines`, comparing line by line through `norm`. Every match is returned so
 * the caller can tell "exactly one" from "several".
 */
function findWindows(lines: string[], search: string[], norm: (l: string) => string): number[] {
  const hits: number[] = [];
  const want = search.map(norm);
  outer: for (let i = 0; i + want.length <= lines.length; i += 1) {
    for (let k = 0; k < want.length; k += 1) if (norm(lines[i + k]!) !== want[k]) continue outer;
    hits.push(i);
  }
  return hits;
}

/** A body's lines, without the empty entry a trailing newline leaves behind. "" becomes []. */
function bodyLines(text: string): string[] {
  const lines = text.split("\n");
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Apply one edit to `source`. Whole lines only, in three tiers, each tried only when the previous
 * found nothing:
 *   1. exact;
 *   2. ignoring trailing whitespace;
 *   3. ignoring indentation — the file's indentation wins, and every replacement line is shifted by
 *      the same difference so the block lands at the file's depth with its structure intact.
 * A tier that finds several places is ambiguous, and stops there: leniency must never pick one of
 * two places on the model's behalf. Fragments of a line never match: substituting inside a line
 * would put the replacement's other lines at the wrong depth, silently.
 */
function applyOne(source: string, edit: SearchReplace): { source: string } | { reason: EditFailureReason; count: number } {
  const search = bodyLines(edit.search);
  if (search.every((l) => l.trim() === "")) return { reason: "empty-search", count: 0 };
  const replacement = bodyLines(edit.replace);
  const lines = source.split("\n");

  const tiers: Array<{ norm: (l: string) => string; shift: boolean }> = [
    { norm: (l) => l, shift: false },
    { norm: (l) => l.trimEnd(), shift: false },
    { norm: (l) => l.trim(), shift: true },
  ];
  for (const tier of tiers) {
    const hits = findWindows(lines, search, tier.norm);
    if (hits.length > 1) return { reason: "ambiguous", count: hits.length };
    if (hits.length === 1) {
      const at = hits[0]!;
      const body = tier.shift ? bodyLines(reindent(replacement.join("\n"), indentOf(search[0]!), indentOf(lines[at]!))) : replacement;
      return { source: [...lines.slice(0, at), ...body, ...lines.slice(at + search.length)].join("\n") };
    }
  }
  return { reason: "not-found", count: 0 };
}

/**
 * Apply every edit, in order, each to the result of the one before. All-or-nothing: a reply with
 * one edit that does not match is a reply the model got wrong, and applying the rest would leave
 * the file in a state nobody asked for.
 */
export function applyEdits(source: string, edits: SearchReplace[]): ApplyResult {
  let current = source;
  const failures: EditFailure[] = [];
  edits.forEach((edit, index) => {
    const r = applyOne(current, edit);
    if ("source" in r) current = r.source;
    else failures.push({ index, reason: r.reason, search: edit.search, count: r.count });
  });
  if (failures.length) return { ok: false, failures };
  return { ok: true, source: current, applied: edits.length };
}

/** What to tell the model so its next reply applies. Numbered from 1, the way a person counts. */
export function describeEditFailures(failures: EditFailure[]): string {
  return failures
    .map((f) => {
      const n = f.index + 1;
      if (f.reason === "empty-search") return `Edit ${n} has an empty SEARCH. Every edit must SEARCH for lines that exist in the file.`;
      if (f.reason === "ambiguous") {
        return `Edit ${n}'s SEARCH text appears in ${f.count} places. Include more of the surrounding lines so it matches exactly one place.`;
      }
      return (
        `Edit ${n}'s SEARCH text was not found in the file. Copy the lines exactly as they appear in the app above — ` +
        `character for character, same indentation, comments included — do not retype them from memory or tidy them up.`
      );
    })
    .join("\n");
}
