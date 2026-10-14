// What a computed value is, whichever way it was written (#310): a bare function, or `{ value,
// label }`. Everything that runs or names a computed reads it through here, so the two spellings
// cannot drift apart — as actions.ts does for actions.

import type { Computed, ComputedDef, EntityDef } from "./types/app.js";
import { plainWords } from "./words-schema.js";

export interface ComputedInfo {
  /** The function; a placeholder string in a definition read out of the sandbox. */
  value: Computed | string;
  /** Its own label, as words (a localized definition's is already the person's language); absent
   *  for a bare function or an object without one — the caller humanises the key. */
  label?: string;
}

export function computedInfo(entity: EntityDef | undefined, key: string): ComputedInfo | undefined {
  const c = entity?.computed?.[key] as Computed | ComputedDef | string | undefined;
  if (c === undefined || c === null) return undefined;
  if (typeof c === "function" || typeof c === "string") return { value: c };
  return c.label === undefined ? { value: c.value } : { value: c.value, label: plainWords(c.label) };
}

/** The callable, or undefined when there is none here (unknown key, or only the sandbox's placeholder). */
export function computedRun(entity: EntityDef | undefined, key: string): Computed | undefined {
  const value = computedInfo(entity, key)?.value;
  return typeof value === "function" ? value : undefined;
}
