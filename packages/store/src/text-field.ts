// A text several people type into at once: the pure parts (docs/04 "Writing together").
//
// ## The hazard
//
// `update(id, { body: whole })` is the counter's mistake one shape up. The text is ONE field, so two
// people typing at the same moment both write the whole thing and the newer save wins: one person's
// words are gone, however far apart in the text they were typing. `docs/17-concurrency-hazards.md`
// has it as the whole-value class.
//
// ## The shape
//
// A `text` field declared `collaborative: true` does not hold its words in the record's CoMap. It
// holds a REFERENCE to a text CoValue of its own (cojson's `RawCoPlainText`, a list CRDT of
// graphemes), and `Store.editText` applies each change there: an insert after this character, a
// delete of those. Two people's edits are two sets of list operations, which merge the way a list
// CRDT merges, and every grapheme remembers the account that typed it — which is what `textRuns`
// reads and the only way the authorship could be trusted (a field an app wrote could say anything).
//
// Everything reading a record still sees one string: the store resolves the reference on read, so
// views, exports and app code keep saying `record.body`.
//
// ## Units
//
// App code counts UTF-16 units, as `String.slice` and a textarea's selection do. cojson counts
// graphemes ("👩‍👩‍👧" is one). The mapping lives here, pure, so it can be tested without a node.

import type { Field } from "potyro";

/**
 * Marks a record value that points at a text CoValue: `{ "\u0003text": "<id>" }`.
 *
 * `\u0003` cannot start a key an app writes (set keys use `\u0002`, counters `\u0001`, on the same
 * reasoning), and a text field's value gate admits only strings, so nothing else ever has this shape.
 */
export const TEXT_REF = "\u0003text";

/** The text CoValue a stored value points at, or `null` when it is an ordinary value. */
export function textRefOf(v: unknown): string | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const id = (v as Record<string, unknown>)[TEXT_REF];
  return typeof id === "string" && Object.keys(v).length === 1 ? id : null;
}

export const textRef = (id: string): Record<string, string> => ({ [TEXT_REF]: id });

/** entity -> the keys of its collaborative text fields. */
export function textFieldsOf(schema: Record<string, Record<string, Field>>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [entity, fields] of Object.entries(schema)) {
    const names = new Set<string>();
    for (const [key, field] of Object.entries(fields)) if (field.type === "text" && field.collaborative) names.add(key);
    if (names.size) out.set(entity, names);
  }
  return out;
}

/**
 * Where each grapheme starts, in UTF-16 units, plus the total length last: `starts[i]` is grapheme
 * `i`'s first unit and `starts[n]` the length of the whole text.
 */
export function utf16Starts(graphemes: readonly string[]): number[] {
  const starts = new Array<number>(graphemes.length + 1);
  let at = 0;
  for (let i = 0; i < graphemes.length; i++) {
    starts[i] = at;
    at += graphemes[i]!.length;
  }
  starts[graphemes.length] = at;
  return starts;
}

/** The grapheme that holds unit `at` — the last one starting at or before it. `n` when `at` is past the end. */
export function graphemeAt(starts: readonly number[], at: number): number {
  const n = starts.length - 1;
  if (at >= starts[n]!) return n;
  if (at <= 0) return 0;
  // Binary search: the largest i with starts[i] <= at.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The first grapheme starting at or after unit `at`: an insert inside a cluster lands after it. */
export function graphemeFrom(starts: readonly number[], at: number): number {
  const n = starts.length - 1;
  if (at <= 0) return 0;
  if (at >= starts[n]!) return n;
  const g = graphemeAt(starts, at);
  return starts[g] === at ? g : g + 1;
}

/** An anchor that follows a character: its op in the text CoValue, or the end of the text. */
export const END_ANCHOR = "end";
export const opAnchor = (opId: string): string => `o:${opId}`;
/** The op an anchor names, or `null` for the end anchor and for anything else. */
export const anchorOp = (anchor: string): string | null => (anchor.startsWith("o:") ? anchor.slice(2) : null);
/**
 * A position anchor, from a store that keeps no ops (`i:<unit>`): the host's fallback, read here so
 * a text that was anchored before the app was shared still resolves — to where it was, which is the
 * best a position can do.
 */
export const positionAnchor = (at: number): string => `i:${at}`;
export const anchorPosition = (anchor: string): number | null => {
  if (!anchor.startsWith("i:")) return null;
  const n = Number(anchor.slice(2));
  return Number.isInteger(n) && n >= 0 ? n : null;
};
