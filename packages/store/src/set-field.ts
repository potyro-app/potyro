// Set-valued fields that merge element by element (KA-38).
//
// ## The hazard
//
// `patch({ tags: [...row.tags, "urgent"] })` is how every app adds to a tag list, and it is a read
// on one device and a write on another. The array is ONE field, so per-key merge has nothing to
// work with: both peers write a whole array, the newer one wins, and the other person's tag is gone
// along with it. `docs/17-concurrency-hazards.md` calls this the whole-array class; it is the same
// mistake as the counter, one shape up.
//
// ## The shape
//
// The array stops being the value and becomes the BASE. Each element the app adds or removes after
// that is its own key — `tags\u0002urgent` -> 1 or 0 — so two people adding different tags write
// different keys and both survive, which is the property this store is built on. What anyone reads
// is the base, minus what was removed, plus what was added.
//
// Deliberately the same trick as `increment`: no new CoValue type, and a field already holding a
// plain array is simply the base, so nothing has to be migrated to start merging correctly.
//
// ## What this does and does not promise
//
// Two peers touching DIFFERENT elements at once: both survive. Two peers adding the SAME element:
// idempotent, one key, one value. Two peers adding and removing the same element at the same
// moment: last write wins, because a per-element key can only hold one answer.
//
// That last case is not add-wins, and calling this an OR-Set would be a lie. A true OR-Set tags
// every add uniquely and removes only the adds it has actually seen — which needs the caller to say
// which adds it observed. `patch` hands over a finished array and no causal information at all, so
// that data does not exist here. What is bought is real: the failure shrinks from "one person's
// whole edit disappears" to "one element, edited in opposite directions in the same instant".

import type { Field } from "karta";

/**
 * Separates a field name from one element of its set.
 *
 * `\u0002` cannot appear in a field name — the counter keys next door use `\u0001` on the same
 * reasoning — so a set key can never collide with a real field. An ELEMENT may contain it: the
 * split takes the first occurrence, so the element comes back whole.
 */
export const SET_SEP = "\u0002";

/**
 * Fields whose value is a set of scalars, and which therefore merge element-wise.
 *
 * Three declared types, one shape: `tags`, and `relation`/`member` when they are `many`. Each is an
 * unordered collection of strings where "add mine, keep yours" is what everybody means. `enum`,
 * `boolean`, `datetime` and a single `relation` stay last-write-wins, which is correct for them —
 * there is only one answer, and the newest one is it.
 *
 * `list` is NOT here. Its elements are rows rather than scalars and it may be ordered, so it needs
 * the ordering work (KA-38's next bullet), not this.
 */
export function isSetField(f: Field): boolean {
  if (f.type === "tags") return true;
  return (f.type === "relation" || f.type === "member") && f.many === true;
}

/** entity -> the field keys of that entity that are sets. */
export function setFieldsOf(schema: Record<string, Record<string, Field>>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [entity, fields] of Object.entries(schema)) {
    const names = new Set<string>();
    for (const [key, field] of Object.entries(fields)) if (isSetField(field)) names.add(key);
    if (names.size) out.set(entity, names);
  }
  return out;
}

export function setKey(field: string, element: string): string {
  return `${field}${SET_SEP}${element}`;
}

/** `null` when the key is an ordinary field. */
export function parseSetKey(key: string): { field: string; element: string } | null {
  const at = key.indexOf(SET_SEP);
  if (at <= 0) return null;
  return { field: key.slice(0, at), element: key.slice(at + SET_SEP.length) };
}

/**
 * Base array + per-element deltas -> the array everyone reads.
 *
 * Base order is kept so a field nobody has touched concurrently reads back exactly as it was
 * written. Added elements follow, sorted — insertion order is not recoverable across peers, and two
 * devices must not disagree about the order of a set they both hold.
 */
export function foldSet(base: unknown, deltas: ReadonlyMap<string, boolean>): string[] {
  const from = Array.isArray(base) ? base.filter((v): v is string => typeof v === "string") : [];
  const seen = new Set(from);
  const out = from.filter((el) => deltas.get(el) !== false);
  const added = [...deltas].filter(([el, on]) => on && !seen.has(el)).map(([el]) => el);
  return [...out, ...added.sort()];
}

/**
 * Fold every set field in one record snapshot, and hide the per-element keys.
 *
 * Reading needs NO schema — a set field is recognisable from the keys themselves. That matters more
 * than it looks: a peer running an older copy of the app, or one that never called `describe`, still
 * reads the merged value rather than a stale base and a pile of keys it does not understand.
 *
 * A field with no delta keys is left exactly as it is, so this is a no-op for every ordinary record.
 */
export function foldSetFields(raw: Record<string, unknown>): Record<string, unknown> {
  let deltas: Map<string, Map<string, boolean>> | null = null;
  for (const key of Object.keys(raw)) {
    const parsed = parseSetKey(key);
    if (!parsed) continue;
    deltas ??= new Map();
    let forField = deltas.get(parsed.field);
    if (!forField) deltas.set(parsed.field, (forField = new Map()));
    forField.set(parsed.element, Boolean(raw[key]));
  }
  if (!deltas) return raw;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (!parseSetKey(k)) out[k] = v;
  for (const [field, forField] of deltas) out[field] = foldSet(raw[field], forField);
  return out;
}

/**
 * What changed between the array that was read and the array being written.
 *
 * The whole point of the exercise: an app that appends one tag produces ONE write, touching one
 * key, leaving every other element — including elements this device has never seen — alone. Writing
 * the array back would re-assert all of them and clobber a concurrent add.
 */
export function setWrites(current: readonly string[], next: readonly string[]): Array<[element: string, present: boolean]> {
  const before = new Set(current);
  const after = new Set(next);
  const writes: Array<[string, boolean]> = [];
  for (const el of after) if (!before.has(el)) writes.push([el, true]);
  for (const el of before) if (!after.has(el)) writes.push([el, false]);
  return writes;
}

/** Element-wise merge only works on scalars; anything else falls back to writing the whole field. */
export function isScalarSet(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((el) => typeof el === "string");
}
