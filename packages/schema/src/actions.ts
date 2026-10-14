// What an action is, whichever way it was written (#213): a bare function, or `{ run, label,
// description, input }`. Everything that shows or runs an action reads it through here, so the two
// spellings cannot drift apart.

import type { ActionDef, ActionFn, EntityDef } from "./types/app.js";
import type { Field } from "./types/fields.js";
import { humanizeKey } from "./humanize.js";
import { recordValueProblem } from "./values.js";
import { plainWords } from "./words-schema.js";

export interface ActionInfo {
  /** The function; a placeholder string in a definition read out of the sandbox. */
  run: ActionFn | string;
  label: string;
  description?: string;
  input?: Record<string, Field>;
}

export function actionInfo(entity: EntityDef | undefined, key: string): ActionInfo | undefined {
  const a = entity?.actions?.[key] as ActionFn | ActionDef | string | undefined;
  if (a === undefined) return undefined;
  if (typeof a === "function" || typeof a === "string") return { run: a, label: humanizeKey(key) };
  return { run: a.run, label: a.label === undefined ? humanizeKey(key) : plainWords(a.label), description: a.description, input: a.input };
}

/** The callable, or undefined when there is none here (unknown key, or only the sandbox's placeholder). */
export function actionRun(entity: EntityDef | undefined, key: string): ActionFn | undefined {
  const run = actionInfo(entity, key)?.run;
  return typeof run === "function" ? run : undefined;
}

/**
 * Why `value` is not an input `fields` accepts, in words for a person — or null. The same rules a
 * save uses (write mode), plus: an object, no key the action does not take, required ones present.
 */
export function actionInputProblem(fields: Record<string, Field>, value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "The action's input must be a set of named values.";
  const given = value as Record<string, unknown>;
  for (const key of Object.keys(given)) if (!fields[key]) return `The action does not take "${key}".`;
  for (const [key, field] of Object.entries(fields)) {
    const v = given[key];
    if (field.required && (v == null || v === "")) return `${field.label === undefined ? humanizeKey(key) : plainWords(field.label)} is required.`;
  }
  return recordValueProblem(fields, given, "write");
}
