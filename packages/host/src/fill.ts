// A form's fill button (#81): the app's function is asked for values, and what it answers is
// checked HERE, on the host's side, before any of it reaches the form.
//
// `EntityDef.fill[n].run(draft, ctx)` runs where every function of the app runs — directly for the
// person's own app, in the realm's Worker or the isolate for a shared one (`LoadedApp.callFill`).
// The draft goes in as a copy of plain data; the answer comes back as whatever the app returned.
// From a sealed app that answer is untrusted, and from any app it may simply be wrong (an AI read
// "Cabernet" for a field that lists eight other grapes), so one function sorts it for all three
// runners:
//
//   values   what fits its field, by the rule a write is held to — copied, plain data only
//   refused  what its field does not take, as the same `FieldRefusal` a refused write carries
//   unknown  keys that are no field of the entity (a record's own `id` and dates are not counted)
//
// Nothing is saved here and nothing is thrown for a bad value: the form fills what fits and says
// what did not. Only an answer that is not a set of values at all, or is absurdly large, fails the
// whole fill — as a bug of the app's, in the developer's words.

import { fieldValueIssue, type Ctx, type Field, type FieldRefusal, type ValueIssue } from "potyro";
import type { LoadedApp } from "./types.js";

export const FILL_LIMITS = {
  /** Keys an answer may carry. An entity has tens of fields, not thousands. */
  keys: 500,
  /** Characters of text in one answer, all values together. */
  chars: 2_000_000,
  /** How deep a value may nest (a list's rows, a place). */
  depth: 12,
} as const;

/** What a fill came to, once the host has checked it. */
export interface FillOutcome {
  /** Values that fit their field, by key: plain data, safe to put in the form. */
  values: Record<string, unknown>;
  /** Values a field refused. */
  refused: FieldRefusal[];
  /** Keys the app returned that are no field of the entity. */
  unknown: string[];
  /** The app returned nothing at all: it had nothing to say (the person closed its picker). */
  nothing?: true;
}

/** A record's own bookkeeping: an app that returns `{ ...draft, name }` returns these too. */
const RECORD_KEYS = new Set(["id", "createdAt", "updatedAt", "createdBy", "updatedBy"]);

const NOT_PLAIN = Symbol("not plain data");

class TooLarge extends Error {}

/**
 * A deep copy of plain data — text, numbers, booleans, dates, lists and plain objects of them — or
 * `NOT_PLAIN` when anything else is in it (a function, a Blob, a class instance, a cycle). `budget`
 * counts the text copied, so a value the size of the device's memory is stopped while it is read.
 */
function plainCopy(value: unknown, budget: { chars: number }, depth = 0, seen: Set<object> = new Set()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    budget.chars -= value.length;
    if (budget.chars < 0) throw new TooLarge();
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return NOT_PLAIN; // a function, a symbol, a bigint
  if (value instanceof Date) return new Date(value.getTime());
  if (depth >= FILL_LIMITS.depth || seen.has(value)) return NOT_PLAIN;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      budget.chars -= value.length;
      if (budget.chars < 0) throw new TooLarge();
      const out: unknown[] = [];
      for (const item of value) {
        const copy = plainCopy(item, budget, depth + 1, seen);
        if (copy === NOT_PLAIN) return NOT_PLAIN;
        out.push(copy);
      }
      return out;
    }
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) return NOT_PLAIN;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      // An own "__proto__" key (JSON and structured clone both deliver one) would, assigned below, become
      // the copy's prototype: a value its field accepts by reading through it, and that saves as {}.
      if (key === "__proto__") return NOT_PLAIN;
      budget.chars -= key.length;
      if (budget.chars < 0) throw new TooLarge();
      const copy = plainCopy((value as Record<string, unknown>)[key], budget, depth + 1, seen);
      if (copy === NOT_PLAIN) return NOT_PLAIN;
      if (copy !== undefined) out[key] = copy;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/** The rule a field holds any value to: what a value that is not even data has broken. */
const shapeIssue = (field: Field): ValueIssue => fieldValueIssue(field, NOT_PLAIN, "write") ?? { rule: "text" };

/** What kind of thing an answer is, for the developer's line. */
function kindOf(v: unknown): string {
  if (Array.isArray(v)) return "a list";
  if (v instanceof Date) return "a date";
  return typeof v === "object" ? "an object that is not plain data" : `a ${typeof v}`;
}

/**
 * Sort what a fill returned against the entity's fields. Throws a `TypeError` — a bug, never words
 * for a person — when the answer is not a set of values, or is larger than any form's values are.
 */
export function checkFill(entity: string, fields: Readonly<Record<string, Field>>, returned: unknown): FillOutcome {
  const out: FillOutcome = { values: {}, refused: [], unknown: [] };
  if (returned == null) return { ...out, nothing: true }; // the person closed the camera or the list: not an error, and nothing to say
  if (typeof returned !== "object" || Array.isArray(returned) || returned instanceof Date) {
    throw new TypeError(`a form's fill returns the values to fill, by field key — { name: "…" } — or nothing; this one returned ${kindOf(returned)}`);
  }
  const keys = Object.keys(returned);
  if (keys.length > FILL_LIMITS.keys) throw new TypeError(`a form's fill returned ${keys.length} keys — more than any form has fields`);
  const budget = { chars: FILL_LIMITS.chars };
  try {
    for (const key of keys) {
      const field = Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : undefined;
      if (!field) {
        if (!RECORD_KEYS.has(key)) out.unknown.push(key.slice(0, 200));
        continue;
      }
      const value = plainCopy((returned as Record<string, unknown>)[key], budget);
      if (value === undefined) continue; // no answer for this field: it keeps what it has
      const issue = value === NOT_PLAIN ? shapeIssue(field) : value === null ? null : fieldValueIssue(field, value, "write");
      if (issue) out.refused.push({ entity, field: key, issue });
      else out.values[key] = value;
    }
  } catch (e) {
    if (e instanceof TooLarge) throw new TypeError(`a form's fill returned more than ${FILL_LIMITS.chars} characters of values — more than a form holds`);
    throw e;
  }
  return out;
}

/** A form's values as the copy a fill is handed: plain data, so nothing the form holds can be reached through it. */
export function draftCopy(draft: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const budget = { chars: Number.MAX_SAFE_INTEGER };
  for (const [key, value] of Object.entries(draft)) {
    const copy = plainCopy(value, budget);
    if (copy !== NOT_PLAIN && copy !== undefined) out[key] = copy;
  }
  return out;
}

/**
 * Run the entity's `fill[index]` on a copy of the form's values, where the app runs, and check what
 * it answers. Rejects with what the app threw (sorted by `actionFailure`, like an action's failure).
 */
export async function runFill(app: LoadedApp, entity: string, index: number, draft: Readonly<Record<string, unknown>>, ctx: Ctx): Promise<FillOutcome> {
  const fields = app.definition.entities[entity]?.fields;
  if (!fields) throw new Error(`fill ${entity}[${index}]: no such entity`);
  const returned = await app.callFill(entity, index, draftCopy(draft), ctx);
  return checkFill(entity, fields, returned);
}
