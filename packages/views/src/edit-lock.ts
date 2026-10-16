// "Only Ana, who added this, can change it." — the visible half of `editableBy: "creator"` (KA-21).
//
// The rule is enforced in the store, from the signed log, whatever this says. This only spares you
// filling in a form that will not save: on a row someone else added, Edit and Delete are drawn
// inactive, and a tap says who can change it.

import { t } from "@lingui/core/macro";
import type { PotyroRuntime } from "@potyro/runtime";

/**
 * Whether people add, change and delete this entity's records by hand. `editableBy: "app"` says only
 * the app's own code does — a live feed's records — so no view or form offers Add, Edit or Delete for
 * them, and nothing in them changes in place. The app's code, and its actions, still write through ctx.
 */
export function byPeople(runtime: Pick<PotyroRuntime, "definition">, entity: string): boolean {
  return runtime.definition.entities[entity]?.editableBy !== "app";
}

/** Why this device may not change `record`, in words for a person — or `null` when it may. */
export function editLockFor(runtime: PotyroRuntime, entity: string, record: Record<string, unknown> | null | undefined): string | null {
  if (!record || runtime.definition.entities[entity]?.editableBy !== "creator") return null;
  const { me, space } = runtime.ctx;
  // Solo: nobody else writes here, so there is nobody to hold back.
  if (!space || !me) return null;
  const creator = typeof record.createdBy === "string" ? record.createdBy : (record.createdBy as { id?: string } | undefined)?.id;
  if (!creator || creator === me.id) return null;
  const name = space.members.find((m) => m.id === creator)?.name;
  return name ? t`Only ${name}, who added this, can change it.` : t`Only the person who added this can change it.`;
}
