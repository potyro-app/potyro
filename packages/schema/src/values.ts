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
 * Which rule a value broke, as data (#76).
 *
 * The sentence below (`describeValueIssue`) is English and is what app code and the console read.
 * What a PERSON reads is said by the shell from this, in their language and the app's own labels —
 * so the rule travels as data from where the write is refused to where it is shown, across the
 * sealed box too, and nobody parses a sentence.
 */
export type ValueIssue =
  | { rule: "text" | "number" | "whole" | "amount" | "yesNo" | "tags" | "date" | "place" | "media" | "file" | "list" }
  | { rule: "record" | "person" | "member"; many: boolean }
  | { rule: "min" | "max"; bound: number; currency?: string }
  | { rule: "options"; options: string[] }
  /** A row of a `list` field: `key` is the sub-field, `issue` what is wrong with its value. */
  | { rule: "row"; key: string; issue: ValueIssue };

/** A write that was refused: the entity and field it was for, and the rule the value broke. */
export interface FieldRefusal {
  entity: string;
  field: string;
  issue: ValueIssue;
}

/** Which rule `value` breaks for `field` — or `null` when it fits. */
export function fieldValueIssue(field: Field, value: unknown, mode: ValueCheck): ValueIssue | null {
  if (value == null) return null;

  switch (field.type) {
    case "text":
    case "richtext":
    case "url":
      return typeof value === "string" ? null : { rule: "text" };

    case "number": {
      if (!isFiniteNumber(value)) return { rule: "number" };
      if (mode === "read") return null;
      if (field.integer && !Number.isInteger(value)) return { rule: "whole" };
      if (field.min != null && value < field.min) return { rule: "min", bound: field.min };
      if (field.max != null && value > field.max) return { rule: "max", bound: field.max };
      return null;
    }

    case "duration":
      return isFiniteNumber(value) ? null : { rule: "number" };

    case "money": {
      // Whole minor units (KA-26). A fraction of a cent is how two copies of a shared ledger drift.
      if (!isFiniteNumber(value) || !Number.isInteger(value)) return { rule: "amount" };
      if (mode === "read") return null;
      if (field.min != null && value < field.min) return { rule: "min", bound: field.min, currency: field.currency };
      if (field.max != null && value > field.max) return { rule: "max", bound: field.max, currency: field.currency };
      return null;
    }

    case "boolean":
      return typeof value === "boolean" ? null : { rule: "yesNo" };

    case "enum": {
      if (typeof value !== "string") return { rule: "options", options: [...field.options] };
      if (mode === "write" && !field.options.includes(value)) return { rule: "options", options: [...field.options] };
      return null;
    }

    case "tags": {
      if (!Array.isArray(value) || !value.every((t) => typeof t === "string")) return { rule: "tags" };
      return null;
    }

    case "datetime":
      return isDate(value) ? null : { rule: "date" };

    case "geo": {
      const ok =
        isObject(value) &&
        isFiniteNumber(value.lat) &&
        isFiniteNumber(value.lng) &&
        Math.abs(value.lat) <= 90 &&
        Math.abs(value.lng) <= 180 &&
        (value.label == null || typeof value.label === "string");
      return ok ? null : { rule: "place" };
    }

    case "media": {
      const ok = Array.isArray(value) ? value.every(isMediaRef) : isMediaRef(value);
      return ok ? null : { rule: "media" };
    }

    case "file":
      return isFileRef(value) ? null : { rule: "file" };

    case "relation": {
      const ok = field.many ? Array.isArray(value) && value.every(isRelationRef) : isRelationRef(value);
      return ok ? null : { rule: "record", many: Boolean(field.many) };
    }

    case "member": {
      const ok = field.many ? Array.isArray(value) && value.every(isMemberRef) : isMemberRef(value);
      return ok ? null : { rule: "person", many: Boolean(field.many) };
    }

    case "list": {
      if (!Array.isArray(value) || !value.every(isObject)) return { rule: "list" };
      if (mode === "read") return null; // rows are sanitised one sub-value at a time instead (sanitiseListRows)
      for (const row of value) {
        for (const [key, sub] of Object.entries(field.of)) {
          const issue = fieldValueIssue(sub, row[key], mode);
          if (issue) return { rule: "row", key, issue };
        }
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * A broken rule as an English sentence naming the field by `label` — what `FieldValueError.message`
 * says. `field` is the field the issue is about (a `row` issue needs it for its sub-field's label).
 */
export function describeValueIssue(issue: ValueIssue, label: string, field?: Field): string {
  switch (issue.rule) {
    case "text":
      return `${label} must be text.`;
    case "number":
      return `${label} must be a number.`;
    case "whole":
      return `${label} must be a whole number.`;
    case "amount":
      return `${label} must be an amount of money.`;
    case "min":
      return `${label} must be at least ${issue.currency === undefined ? issue.bound : formatMoney(issue.bound, issue.currency)}.`;
    case "max":
      return `${label} must be at most ${issue.currency === undefined ? issue.bound : formatMoney(issue.bound, issue.currency)}.`;
    case "yesNo":
      return `${label} must be yes or no.`;
    case "options":
      return `${label} must be one of: ${issue.options.join(", ")}.`;
    case "tags":
      return `${label} must be a list of tags.`;
    case "date":
      return `${label} must be a date.`;
    case "place":
      return `${label} must be a place.`;
    case "media":
      return `${label} must be a photo or file.`;
    case "file":
      return `${label} must be a file in this app.`;
    case "record":
      return `${label} must point at ${issue.many ? "records" : "a record"}.`;
    case "person":
      return `${label} must be ${issue.many ? "people" : "a person"} in this app.`;
    case "member":
      return `${label} must be ${issue.many ? "people" : "someone"} in this app.`;
    case "list":
      return `${label} must be a list.`;
    case "row": {
      const sub = field?.type === "list" ? field.of[issue.key] : undefined;
      return describeValueIssue(issue.issue, `${label} › ${sub?.label === undefined ? humanizeKey(issue.key) : plainWords(sub.label)}`, sub);
    }
  }
}

/**
 * Why `value` does not fit `field`, in words for a person — or `null` when it fits.
 *
 * `label` names the field in the message; pass the key when there is no declared label.
 */
export function fieldValueProblem(field: Field, value: unknown, mode: ValueCheck, label = "This field"): string | null {
  const issue = fieldValueIssue(field, value, mode);
  return issue ? describeValueIssue(issue, label, field) : null;
}

/** How a field is named in a message: its label, or its key made readable. */
const labelOf = (field: Field, key: string): string => (field.label === undefined ? humanizeKey(key) : plainWords(field.label));

/** The first value in `data` that does not fit its declared field, as its key and the rule — or `null`. */
export function recordValueIssue(fields: Record<string, Field>, data: Record<string, unknown>, mode: ValueCheck): { field: string; issue: ValueIssue } | null {
  for (const [key, value] of Object.entries(data)) {
    const field = fields[key];
    if (!field) continue;
    const issue = fieldValueIssue(field, value, mode);
    if (issue) return { field: key, issue };
  }
  return null;
}

/**
 * The first value in `data` that does not fit its declared field, as a message — or `null`.
 *
 * Keys the entity does not declare are not judged: there is no rule to judge them by, and
 * bookkeeping such as `createdBy` lives there.
 */
export function recordValueProblem(fields: Record<string, Field>, data: Record<string, unknown>, mode: ValueCheck): string | null {
  const found = recordValueIssue(fields, data, mode);
  if (!found) return null;
  const field = fields[found.field]!;
  return describeValueIssue(found.issue, labelOf(field, found.field), field);
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

/**
 * Thrown when app code tries to store a value that does not fit its field.
 *
 * `message` is the English sentence; `refusal` is the same thing as data (which entity, which
 * field, which rule), for whoever says it to a person in their language (#76).
 */
export class FieldValueError extends Error {
  readonly refusal?: FieldRefusal;
  constructor(message: string, refusal?: FieldRefusal) {
    super(message);
    this.name = "FieldValueError";
    if (refusal) this.refusal = refusal;
  }
}
