// Edits counted in one text, applied to another (docs/04 "Writing together").
//
// A client computes "insert at 12" against the text it shows. By the time the edit reaches the
// store, someone else's keystrokes may have landed in front of position 12, and the insert would
// go into the wrong word. So an edit may name its `base` — the text its positions count in — and the
// host moves each position onto the text as it is now: what is before the other person's change
// stays, what is after it shifts, what was inside it lands after it. Each edit is then applied, in
// order, and the next one is mapped against the text it left behind.
import type { TextEdit } from "potyro";

/** The one region in which `from` and `to` differ: `[at, at + removed)` of `from` became `inserted`. */
function region(from: string, to: string): { at: number; removed: number; inserted: number } {
  const min = Math.min(from.length, to.length);
  let p = 0;
  while (p < min && from[p] === to[p]) p++;
  let s = 0;
  while (s < min - p && from[from.length - 1 - s] === to[to.length - 1 - s]) s++;
  return { at: p, removed: from.length - p - s, inserted: to.length - p - s };
}

/**
 * Where position `x` of `from` is in `to`. A position belongs to the character after it: at the
 * very start of the other person's change it moves past that change, so a deletion of "the first
 * letter" still deletes that letter and never their words. `end` is an exclusive end, which at the
 * start of their change stays before it.
 */
function mapPosition(x: number, r: { at: number; removed: number; inserted: number }, end = false): number {
  if (end ? x <= r.at : x < r.at) return x;
  if (x >= r.at + r.removed) return x + (r.inserted - r.removed);
  return r.at + r.inserted;
}

/** `text` with one edit applied, in plain string terms. */
export function applyEdit(text: string, e: TextEdit): string {
  if ("insert" in e) {
    const at = Math.min(e.at, text.length);
    return text.slice(0, at) + e.insert + text.slice(at);
  }
  const from = Math.min(e.from, text.length);
  return text.slice(0, from) + text.slice(Math.min(Math.max(e.to, from), text.length));
}

/**
 * `edits`, counted in `base`, as they must be counted in `current`. Edits that end up empty (a
 * deletion of words someone else already deleted) are left out. With `base` equal to `current`
 * the edits come back as they were.
 */
export function mapEditsOnto(base: string, current: string, edits: readonly TextEdit[]): TextEdit[] {
  if (base === current) return [...edits];
  let seen = base; // the text the client believes in, edit by edit
  let actual = current; // the text as it is, the mapped edits applied in step
  const out: TextEdit[] = [];
  for (const e of edits) {
    const r = region(seen, actual);
    if ("insert" in e) {
      const at = Math.min(mapPosition(e.at, r), actual.length);
      if (e.insert) {
        out.push({ at, insert: e.insert });
        actual = applyEdit(actual, { at, insert: e.insert });
      }
    } else {
      const from = Math.min(mapPosition(e.from, r), actual.length);
      const to = Math.min(Math.max(mapPosition(e.to, r, true), from), actual.length);
      if (to > from) {
        out.push({ from, to });
        actual = applyEdit(actual, { from, to });
      }
    }
    seen = applyEdit(seen, e);
  }
  return out;
}
