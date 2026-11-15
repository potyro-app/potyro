// A form's values, in RAW value space (what `runtime.create()` / `patch()` take): a relation is an
// id, a list's rows carry ids too. Shared by the record form and its fill buttons (#81).

import type { ShownField as Field } from "./shown.js";

function relId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "object") return (value as { id?: string }).id ?? null;
  return String(value);
}

/** Convert a resolved value back to raw (relations → ids); recurse into list rows. */
export function toRaw(field: Field, val: unknown): unknown {
  if (val == null) return val;
  if (field.type === "relation") {
    return field.many ? (Array.isArray(val) ? val.map(relId).filter(Boolean) : []) : relId(val);
  }
  if (field.type === "list") {
    if (!Array.isArray(val)) return [];
    return val.map((row) => rawRow(field.of, row as Record<string, unknown>));
  }
  return val;
}

function rawRow(of: Record<string, Field>, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, sub] of Object.entries(of)) out[k] = toRaw(sub, row?.[k]);
  return out;
}

/** Nothing entered: no value, no text, an empty list. `false` is an answer, not an absence. */
export function isEmpty(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** A value as it is compared: a date by its moment, text without the space around it, the rest as stored. */
function comparable(field: Field | undefined, v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "string") {
    if (field?.type === "datetime") {
      const at = Date.parse(v);
      return Number.isNaN(at) ? v : new Date(at).toISOString();
    }
    return v.trim();
  }
  if (Array.isArray(v)) return v.map((x) => comparable(undefined, x));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = comparable(undefined, (v as Record<string, unknown>)[k]);
      if (x !== null) out[k] = x;
    }
    return out;
  }
  return v;
}

/** One line that is the same for two values a person would call the same. */
export function valueKey(field: Field | undefined, v: unknown): string {
  return JSON.stringify(comparable(field, field ? toRaw(field, v) : v));
}
