// Does a stored value fit the field it is stored under? (KA-21, #62)
//
// The declarative half of an app has always been validated (validate.ts); the VALUES written into
// its records never were. For an app used alone that was a bug magnet, and for a shared one it is a
// hole: the relay is zero-knowledge and cannot look inside a change, so whatever a peer's copy
// writes — a buggy older version, or someone deliberately tampering — reaches every other copy,
// and every view and every piece of app logic downstream has to survive it.
//
// So values are checked at the host, at both ends:
//
//   write  a value that does not fit is REFUSED before it is stored (`fieldValueProblem(…, "write")`)
//   read   a value that does not fit is not shown — the record keeps the last value that did
//
// The two modes differ on purpose, and only where the app's own definition can move under data that
// was fine when it was written. An enum whose options were renamed, a number whose `min` was raised:
// old records then fail the new rule through no one's fault, and hiding them would look like data
// loss. Reading checks the SHAPE (a number is a number); writing also checks the rules of the
// definition in force now. Absent (`null`/`undefined`) is never a bad value — whether a field is
// required is the form's question, not the store's.

import type { Field } from "./types/fields.js";
import { humanizeKey } from "./humanize.js";
import { formatMoney } from "./money.js";
import { plainWords } from "./words-schema.js";

export type ValueCheck = "read" | "write";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isDate(v: unknown): boolean {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  return typeof v === "string" && v.trim() !== "" && !Number.isNaN(Date.parse(v));
}

function isMediaRef(v: unknown): boolean {
  return isObject(v) && typeof v.key === "string" && typeof v.mime === "string";
}

/** A `file` field's value: the file's id, with optional path/name/mime as it was when set. */
function isFileRef(v: unknown): boolean {
  if (!isObject(v) || typeof v.id !== "string" || v.id === "") return false;
  return (["path", "name", "mime"] as const).every((k) => v[k] == null || typeof v[k] === "string");
}

/** A stored relation is an id; an embedded related record (with its id) is accepted as well. */
function isRelationRef(v: unknown): boolean {
  return (typeof v === "string" && v !== "") || (isObject(v) && typeof v.id === "string");
}

/** A member is stored as an account id; a resolved Person (with its id) is accepted as well. */
function isMemberRef(v: unknown): boolean {
  return (typeof v === "string" && v !== "") || (isObject(v) && typeof v.id === "string");
}

/**
 * Why `value` does not fit `field`, in words for a person — or `null` when it fits.
 *
 * `label` names the field in the message; pass the key when there is no declared label.
 */
export function fieldValueProblem(field: Field, value: unknown, mode: ValueCheck, label = "This field"): string | null {
  if (value == null) return null;

  switch (field.type) {
    case "text":
    case "richtext":
    case "url":
      return typeof value === "string" ? null : `${label} must be text.`;

    case "number": {
      if (!isFiniteNumber(value)) return `${label} must be a number.`;
      if (mode === "read") return null;
      if (field.integer && !Number.isInteger(value)) return `${label} must be a whole number.`;
      if (field.min != null && value < field.min) return `${label} must be at least ${field.min}.`;
      if (field.max != null && value > field.max) return `${label} must be at most ${field.max}.`;
      return null;
    }

    case "duration":
      return isFiniteNumber(value) ? null : `${label} must be a number.`;

    case "money": {
      // Whole minor units (KA-26). A fraction of a cent is how two copies of a shared ledger drift.
      if (!isFiniteNumber(value) || !Number.isInteger(value)) return `${label} must be an amount of money.`;
      if (mode === "read") return null;
      if (field.min != null && value < field.min) return `${label} must be at least ${formatMoney(field.min, field.currency)}.`;
      if (field.max != null && value > field.max) return `${label} must be at most ${formatMoney(field.max, field.currency)}.`;
      return null;
    }

    case "boolean":
      return typeof value === "boolean" ? null : `${label} must be yes or no.`;

    case "enum": {
      if (typeof value !== "string") return `${label} must be one of: ${field.options.join(", ")}.`;
      if (mode === "write" && !field.options.includes(value)) return `${label} must be one of: ${field.options.join(", ")}.`;
      return null;
    }

    case "tags": {
      if (!Array.isArray(value) || !value.every((t) => typeof t === "string")) return `${label} must be a list of tags.`;
      return null;
    }

    case "datetime":
      return isDate(value) ? null : `${label} must be a date.`;

    case "geo": {
      const ok =
        isObject(value) &&
        isFiniteNumber(value.lat) &&
        isFiniteNumber(value.lng) &&
        Math.abs(value.lat) <= 90 &&
        Math.abs(value.lng) <= 180 &&
        (value.label == null || typeof value.label === "string");
      return ok ? null : `${label} must be a place.`;
    }

    case "media": {
      const ok = Array.isArray(value) ? value.every(isMediaRef) : isMediaRef(value);
      return ok ? null : `${label} must be a photo or file.`;
    }

    case "file":
      return isFileRef(value) ? null : `${label} must be a file in this app.`;

    case "relation": {
      const ok = field.many ? Array.isArray(value) && value.every(isRelationRef) : isRelationRef(value);
      return ok ? null : `${label} must point at ${field.many ? "records" : "a record"}.`;
    }

    case "member": {
      const ok = field.many ? Array.isArray(value) && value.every(isMemberRef) : isMemberRef(value);
      return ok ? null : `${label} must be ${field.many ? "people" : "a person"} in this app.`;
    }

    case "list": {
      if (!Array.isArray(value) || !value.every(isObject)) return `${label} must be a list.`;
      if (mode === "read") return null; // rows are sanitised one sub-value at a time instead (sanitiseListRows)
      for (const row of value) {
        for (const [key, sub] of Object.entries(field.of)) {
          const problem = fieldValueProblem(sub, row[key], mode, `${label} › ${sub.label ?? humanizeKey(key)}`);
          if (problem) return problem;
        }
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * The first value in `data` that does not fit its declared field, as a message — or `null`.
 *
 * Keys the entity does not declare are not judged: there is no rule to judge them by, and
 * bookkeeping such as `createdBy` lives there.
 */
export function recordValueProblem(fields: Record<string, Field>, data: Record<string, unknown>, mode: ValueCheck): string | null {
  for (const [key, value] of Object.entries(data)) {
    const field = fields[key];
    if (!field) continue;
    const problem = fieldValueProblem(field, value, mode, field.label === undefined ? humanizeKey(key) : plainWords(field.label));
    if (problem) return problem;
  }
  return null;
}

/**
 * A list's rows with every sub-value that does not fit removed (read side).
 *
 * Per sub-value rather than per list: one bad cell in a workout's sets must not take the other
 * twenty sets off the screen with it.
 */
export function sanitiseListRows(of: Record<string, Field>, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    let out: Record<string, unknown> | null = null;
    for (const [key, sub] of Object.entries(of)) {
      if (fieldValueProblem(sub, row[key], "read") === null) continue;
      out ??= { ...row };
      delete out[key];
    }
    return out ?? row;
  });
}

/** Thrown when app code tries to store a value that does not fit its field. */
export class FieldValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldValueError";
  }
}
