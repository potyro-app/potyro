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

/** Why one SEARCH/REPLACE block in a reply could not be read as a well-formed edit. */
export interface MalformedBlock {
  /** Position of the block counting every block opened (well-formed or not) from 0. */
  index: number;
  reason: string;
}

/**
 * Every complete SEARCH/REPLACE block in a reply, in order, plus every block that was NOT
 * well-formed and why. Bodies are verbatim: the search text is matched against the file, so a
 * parser that "tidied" it would break the match it exists to make.
 *
 * Two ways a block goes wrong, both reported rather than silently guessed at: a second `=======`
 * line while still reading the replacement (the model split REPLACE in two), and a new
 * `<<<<<<< SEARCH` opening before the previous block closed — including one still open when the
 * reply ends. Either way the block is dropped from `edits`, never half-applied: a half-read edit
 * written into a file is worse than no edit.
 */
export function parseEditsStrict(reply: string): { edits: SearchReplace[]; malformed: MalformedBlock[] } {
  const lines = reply.replace(/\r\n?/g, "\n").split("\n");
  const edits: SearchReplace[] = [];
  const malformed: MalformedBlock[] = [];
  let state: "outside" | "search" | "replace" = "outside";
  let search: string[] = [];
  let replace: string[] = [];
  let blockIndex = -1;
  let nextIndex = 0;
  let reported = false; // whether the currently open block already has a malformed entry

  // Returns "search" so callers assign it directly (`state = openBlock()`): an assignment at the
  // call site narrows normally, where a bare call to a closure that assigns `state` internally does
  // not — TS invalidates narrowing of a `let` written inside any function it can't see through.
  const openBlock = (): "search" => {
    search = [];
    replace = [];
    blockIndex = nextIndex;
    nextIndex += 1;
    reported = false;
    return "search";
  };
  const reportUnclosed = () => {
    if (!reported) malformed.push({ index: blockIndex, reason: "was never closed with >>>>>>> REPLACE" });
    reported = true;
  };

  for (const line of lines) {
    if (state === "outside") {
      if (SEARCH_MARK.test(line)) state = openBlock();
      continue;
    }
    if (state === "search") {
      if (DIVIDER_MARK.test(line)) state = "replace";
      else if (SEARCH_MARK.test(line)) {
        reportUnclosed(); // a block opened before this one closed
        state = openBlock();
      } else search.push(line);
      continue;
    }
    // state === "replace"
    if (REPLACE_MARK.test(line)) {
      if (!reported) edits.push({ search: search.join("\n"), replace: replace.join("\n") });
      state = "outside";
    } else if (DIVIDER_MARK.test(line)) {
      if (!reported) malformed.push({ index: blockIndex, reason: "has more than one ======= line" });
      reported = true; // keep reading to the eventual REPLACE mark, but never as a real edit
    } else if (SEARCH_MARK.test(line)) {
      reportUnclosed(); // a block opened before this one closed
      state = openBlock();
    } else {
      replace.push(line);
    }
  }
  if (state !== "outside") reportUnclosed();
  return { edits, malformed };
}

/**
 * Every complete SEARCH/REPLACE block in a reply, in order. See `parseEditsStrict` for how a
 * malformed block is detected and reported; this is the shape most callers want.
 */
export function parseEdits(reply: string): SearchReplace[] {
  return parseEditsStrict(reply).edits;
}

export type EditFailureReason = "not-found" | "ambiguous" | "empty-search" | "malformed";

export interface EditFailure {
  /** Zero-based position of the edit in the reply. `describeEditFailures` shows it one-based. */
  index: number;
  reason: EditFailureReason;
  search: string;
  /** How many places matched — 0 for not-found, >1 for ambiguous. */
  count: number;
  /** Set for `reason: "malformed"`: the `MalformedBlock.reason` text, e.g. "has more than one ======= line". */
  detail?: string;
}

export type ApplyResult = { ok: true; source: string; applied: number } | { ok: false; failures: EditFailure[] };

const indentOf = (line: string): string => /^[ \t]*/.exec(line)![0];

/**
 * Whether `search` sits at `lines[at..]` with one consistent indent MAPPING throughout, not just a
 * shared prefix. Build `search indent -> file indent` from every non-blank line and require it to
 * be: (1) consistent — a search indent seen twice must map to the same file indent both times,
 * which is what rejects two search lines at one depth whose file lines actually differ; (2)
 * injective — two different search indents must never collapse onto the same file indent, which is
 * what rejects a body the model flattened onto its anchor's own level while the file still nests it
 * deeper (every search indent in the flattened block is identical, so this is really rule 1 firing
 * on the block's own repeated indent against the file's several distinct ones); (3) order-preserving
 * — a shorter search indent must map to a shorter file indent, which is what rejects a body
 * flattened to column zero under a real anchor, and any window where nesting comes out inverted. A
 * uniform shift that merely changes the unit — one tab per level in the model's copy against two
 * spaces per level in the file, say — satisfies all three and still matches: the map is consistent,
 * injective, and depth-ordered even though no single arithmetic delta explains it.
 */
function uniformShift(lines: string[], at: number, search: string[]): { from: string; to: string } | null {
  const map = new Map<string, string>();
  for (let k = 0; k < search.length; k += 1) {
    if (search[k]!.trim() === "") continue;
    const s = indentOf(search[k]!);
    const f = indentOf(lines[at + k]!);
    const known = map.get(s);
    if (known === undefined) map.set(s, f);
    else if (known !== f) return null; // consistent: same search indent, different file indents
  }
  const entries = [...map.entries()];
  const seenFileIndents = new Set(entries.map(([, f]) => f));
  if (seenFileIndents.size !== entries.length) return null; // injective: two indents, one file depth
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [s1, f1] = entries[i]!;
      const [s2, f2] = entries[j]!;
      const shorter = s1.length < s2.length ? [f1, f2] : s2.length < s1.length ? [f2, f1] : null;
      if (shorter && !(shorter[0]!.length < shorter[1]!.length)) return null; // order-preserving
    }
  }
  const base = search.findIndex((l) => l.trim() !== "");
  if (base === -1) return null;
  return { from: indentOf(search[base]!), to: indentOf(lines[at + base]!) };
}

/**
 * Re-indent `replacement` onto the file at the position where `search` matched. A replacement line
 * at the same indentation as one of the search lines takes that search line's real file indentation
 * exactly — this is correct whatever characters the model's copy used, tabs included, because it
 * never does arithmetic on them. A line at a depth the search window never showed (new lines the
 * model added) falls back to the uniform `from`/`to` shift; failing that — it does not even start
 * with the window's own base indentation — falls back further to the file's base indentation with
 * the line's own leading whitespace stripped, the best guess left once nothing else lines up.
 */
function reindentToFile(replacement: string[], search: string[], lines: string[], at: number, from: string, to: string): string[] {
  const byIndent = new Map<string, string>();
  search.forEach((line, k) => {
    if (line.trim() === "") return;
    const indent = indentOf(line);
    // First-wins here would be a collision if two search lines at the same indent mapped to
    // different file indents, but `uniformShift` already rejected any window where that could
    // happen — its consistency check requires a given search indent to map to exactly one file
    // indent throughout the window. The map can't disagree with itself.
    if (!byIndent.has(indent)) byIndent.set(indent, indentOf(lines[at + k]!));
  });
  return replacement.map((line) => {
    if (line.trim() === "") return line;
    const own = indentOf(line);
    const known = byIndent.get(own);
    if (known !== undefined) return known + line.slice(own.length);
    if (own.startsWith(from)) return to + line.slice(from.length);
    return to + line.trimStart();
  });
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
 *      the same difference so the block lands at the file's depth with its structure intact. A
 *      window only counts here when the whole block shares one shift (`uniformShift`); a window
 *      where only some lines shifted is not a genuine indentation-only difference.
 * A tier that finds several (uniform, for tier 3) places is ambiguous, and stops there: leniency
 * must never pick one of two places on the model's behalf. Fragments of a line never match:
 * substituting inside a line would put the replacement's other lines at the wrong depth, silently.
 */
function applyOne(source: string, edit: SearchReplace): { source: string } | { reason: EditFailureReason; count: number } {
  const search = bodyLines(edit.search);
  if (search.every((l) => l.trim() === "")) return { reason: "empty-search", count: 0 };
  const replacement = bodyLines(edit.replace);
  const lines = source.split("\n");

  const looseTiers: Array<(l: string) => string> = [(l) => l, (l) => l.trimEnd()];
  for (const norm of looseTiers) {
    const hits = findWindows(lines, search, norm);
    if (hits.length > 1) return { reason: "ambiguous", count: hits.length };
    if (hits.length === 1) {
      const at = hits[0]!;
      return { source: [...lines.slice(0, at), ...replacement, ...lines.slice(at + search.length)].join("\n") };
    }
  }

  const shifted = findWindows(lines, search, (l) => l.trim())
    .map((at) => ({ at, shift: uniformShift(lines, at, search) }))
    .filter((hit): hit is { at: number; shift: { from: string; to: string } } => hit.shift !== null);
  if (shifted.length > 1) return { reason: "ambiguous", count: shifted.length };
  if (shifted.length === 1) {
    const { at, shift } = shifted[0]!;
    const body = reindentToFile(replacement, search, lines, at, shift.from, shift.to);
    return { source: [...lines.slice(0, at), ...body, ...lines.slice(at + search.length)].join("\n") };
  }
  return { reason: "not-found", count: 0 };
}

/**
 * Apply every edit, in order, each to the result of the one before, stopping at the first one that
 * does not match. Edits chain, so once one fails every later edit is being checked against a file
 * state that will never exist — evaluating them anyway produces failures that are noise at best
 * (they report matching text as "not found" because an earlier edit never actually landed) and
 * misleading at worst. Reporting just the first failure tells the model exactly which edit to fix.
 */
export function applyEdits(source: string, edits: SearchReplace[]): ApplyResult {
  let current = source;
  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index]!;
    const r = applyOne(current, edit);
    if ("source" in r) {
      current = r.source;
      continue;
    }
    return { ok: false, failures: [{ index, reason: r.reason, search: edit.search, count: r.count }] };
  }
  return { ok: true, source: current, applied: edits.length };
}

/** What to tell the model so its next reply applies. Numbered from 1, the way a person counts. */
export function describeEditFailures(failures: EditFailure[]): string {
  return failures
    .map((f) => {
      const n = f.index + 1;
      if (f.reason === "malformed") {
        return (
          `Edit ${n} is malformed: it ${f.detail}. Each edit is exactly one <<<<<<< SEARCH line, the lines to find, ` +
          "one ======= line, the replacement lines, and one >>>>>>> REPLACE line."
        );
      }
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

/** The format, as the model is told it. One worked example; models copy shapes better than rules. */
export const EDIT_FORMAT = [
  "<<<<<<< SEARCH",
  "<consecutive lines copied from the app above, exactly as they are there>",
  "=======",
  "<what those lines become>",
  ">>>>>>> REPLACE",
  "",
  "For example, to add a `rating` field to the `place` entity:",
  "<<<<<<< SEARCH",
  "    place: {",
  "      fields: {",
  '        name: { type: "text", required: true },',
  "=======",
  "    place: {",
  "      fields: {",
  '        name: { type: "text", required: true },',
  '        rating: { type: "number" },',
  ">>>>>>> REPLACE",
  "",
  "- SEARCH must be an exact copy of consecutive lines from the app above: same characters, same",
  "  indentation, comments included. Do not retype it from memory and do not tidy it up.",
  "- Make SEARCH match exactly one place: start it at a line that names what you are editing (the entity",
  "  or page it belongs to) and include the lines down to the one you change.",
  "- To add something, SEARCH the line it goes after and REPLACE with that line followed by the new lines.",
  "  REPLACE stands in for the whole SEARCH block: any SEARCH line you do not repeat in REPLACE is deleted.",
  "  To remove something, leave REPLACE empty.",
  "- One block per place you change; several blocks are fine. They are applied in order.",
  "- Do not send the whole file. Every line you do not mention stays exactly as it is.",
].join("\n");
