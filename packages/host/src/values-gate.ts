// Values that do not fit their field go no further (KA-21, #62).
//
// Both ways app code reaches the store — the direct `ctx` (make-ctx.ts) and the isolate bridge
// (isolate-host.ts) — refuse through `assertValuesFit`, the same way both stamp authorship through
// authorship.ts, so neither can drift into trusting the app. Reading goes through `fittingValue`
// in resolve.ts, which every record passes on its way to app code and views.
//
// Why refuse at all, when the app's own code wrote it? Because in a shared app the other copies
// would have to survive it too, and the next reader cannot tell a bug from a tampered change.

import { FieldValueError, fieldValueProblem, humanizeKey, recordValueProblem, sanitiseListRows, type AppDefinition, type Field } from "potyro";
import type { Store } from "@potyro/store";

/**
 * The account ids a `member` value may name (KA-19). Absent = nobody to check against (a solo app,
 * or a space not loaded yet), and then only the shape is checked.
 */
export type PeopleIds = ReadonlySet<string> | undefined;

function memberIdsIn(field: Field, value: unknown): string[] {
  if (field.type !== "member" || value == null) return [];
  const one = (v: unknown): string | undefined => (typeof v === "string" ? v : (v as { id?: unknown } | null)?.id as string | undefined);
  return (Array.isArray(value) ? value : [value]).map(one).filter((id): id is string => typeof id === "string");
}

/** Why a `member` value names someone outside `people`, or `null`. */
function memberProblem(field: Field, value: unknown, people: PeopleIds, label: string): string | null {
  if (!people || field.type !== "member") return null;
  return memberIdsIn(field, value).every((id) => people.has(id)) ? null : `${label} must be ${field.many ? "people" : "someone"} in this app.`;
}

/** Throw a `FieldValueError` naming the first value in `data` that does not fit `entity`'s fields. */
export function assertValuesFit(definition: AppDefinition, entity: string, data: Record<string, unknown>, people?: PeopleIds): void {
  const fields = definition.entities[entity]?.fields;
  if (!fields) return;
  const problem = recordValueProblem(fields, data, "write");
  if (problem) throw new FieldValueError(problem);
  for (const [key, value] of Object.entries(data)) {
    const field = fields[key];
    const member = field && memberProblem(field, value, people, field.label ?? humanizeKey(key));
    if (member) throw new FieldValueError(member);
  }
}

/**
 * A patch's version of `assertValuesFit`: values it leaves as they were are held only to the READ
 * rule, values it changes to the full write rule.
 *
 * The edit form sends every field back, not just the one you touched. A record whose enum option
 * has since been renamed would otherwise become impossible to save for a change to something else.
 */
export function assertPatchFits(
  definition: AppDefinition,
  entity: string,
  patch: Record<string, unknown>,
  current: Record<string, unknown> | null,
  people?: { now?: PeopleIds; ever?: PeopleIds },
): void {
  const fields = definition.entities[entity]?.fields;
  if (!fields) return;
  for (const [key, value] of Object.entries(patch)) {
    const field = fields[key];
    if (!field) continue;
    const unchanged = current != null && sameStored(current[key], value);
    const label = field.label ?? humanizeKey(key);
    // Unchanged: someone who has since LEFT may still be named — a ledger entry they paid for stays
    // saveable. Changed: only someone in the app now.
    const problem =
      fieldValueProblem(field, value, unchanged ? "read" : "write", label) ??
      memberProblem(field, value, unchanged ? people?.ever : people?.now, label);
    if (problem) throw new FieldValueError(problem);
  }
}

function sameStored(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** `increment` only counts: the field it names must hold a number. */
export function assertCountable(definition: AppDefinition, entity: string, field: string): void {
  const declared = definition.entities[entity]?.fields[field];
  if (declared && declared.type !== "number" && declared.type !== "duration") {
    throw new FieldValueError(`${declared.label ?? humanizeKey(field)} is not a number, so it cannot be counted.`);
  }
}

/**
 * The value to show for a stored field: the stored one when it fits, otherwise the newest value in
 * the record's history that did — or nothing, on a store that keeps no history.
 *
 * Silent by design. A value someone's copy should never have written is not news to the people
 * reading the record; the change simply does not take.
 */
export async function fittingValue(store: Store, entity: string, id: string, key: string, field: Field, value: unknown): Promise<unknown> {
  // A `member` value must name someone who has been in this space, removed people included.
  const ever: PeopleIds = field.type === "member" && store.memberIds ? everyone(store) : undefined;
  const fits = (v: unknown): boolean => fieldValueProblem(field, v, "read") === null && memberProblem(field, v, ever, "") === null;
  if (fits(value)) {
    if (field.type === "list" && Array.isArray(value)) return sanitiseListRows(field.of, value as Record<string, unknown>[]);
    return value;
  }
  const history = (await store.editHistory?.(entity, id).catch(() => [])) ?? [];
  const earlier = history.filter((e) => e.field === key).sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const edit of earlier) {
    if (fits(edit.value)) return edit.value;
  }
  return undefined;
}

/** Everyone who has ever been in the store's space, or `undefined` when it cannot say. */
export function everyone(store: Store): PeopleIds {
  const ids = store.memberIds?.() ?? [];
  // An empty list is a group not loaded yet, not a space with nobody in it: do not block on it.
  return ids.length ? new Set(ids) : undefined;
}

/** The people a `member` value may be SET to now: the space's current members, and you. */
export function currentPeople(space: { members: readonly { id: string }[] } | undefined, me: { id: string } | undefined): PeopleIds {
  if (!space) return undefined;
  return new Set([...space.members.map((m) => m.id), ...(me ? [me.id] : [])]);
}
