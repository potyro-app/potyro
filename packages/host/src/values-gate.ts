// Values that do not fit their field go no further (KA-21, #62).
//
// Both ways app code reaches the store — the direct `ctx` (make-ctx.ts) and the isolate bridge
// (isolate-host.ts) — refuse through `assertValuesFit`, the same way both stamp authorship through
// authorship.ts, so neither can drift into trusting the app. Reading goes through `fittingValue`
// in resolve.ts, which every record passes on its way to app code and views.
//
// Why refuse at all, when the app's own code wrote it? Because in a shared app the other copies
// would have to survive it too, and the next reader cannot tell a bug from a tampered change.

import { FieldValueError, fieldValueProblem, humanizeKey, recordValueProblem, sanitiseListRows, type AppDefinition, type Field } from "karta";
import type { Store } from "@karta/store";

/** Throw a `FieldValueError` naming the first value in `data` that does not fit `entity`'s fields. */
export function assertValuesFit(definition: AppDefinition, entity: string, data: Record<string, unknown>): void {
  const fields = definition.entities[entity]?.fields;
  if (!fields) return;
  const problem = recordValueProblem(fields, data, "write");
  if (problem) throw new FieldValueError(problem);
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
): void {
  const fields = definition.entities[entity]?.fields;
  if (!fields) return;
  for (const [key, value] of Object.entries(patch)) {
    const field = fields[key];
    if (!field) continue;
    const unchanged = current != null && sameStored(current[key], value);
    const problem = fieldValueProblem(field, value, unchanged ? "read" : "write", field.label ?? humanizeKey(key));
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
  if (fieldValueProblem(field, value, "read") === null) {
    if (field.type === "list" && Array.isArray(value)) return sanitiseListRows(field.of, value as Record<string, unknown>[]);
    return value;
  }
  const history = (await store.editHistory?.(entity, id).catch(() => [])) ?? [];
  const earlier = history.filter((e) => e.field === key).sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const edit of earlier) {
    if (fieldValueProblem(field, edit.value, "read") === null) return edit.value;
  }
  return undefined;
}
