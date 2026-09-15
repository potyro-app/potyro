// "Only Ana, who added this, can change it." — the visible half of `editableBy: "creator"` (KA-21).
//
// The rule is enforced in the store, from the signed log, whatever this says. This only spares you
// filling in a form that will not save: on a row someone else added, Edit and Delete are drawn
// inactive, and a tap says who can change it.

import type { KartaRuntime } from "@karta/runtime";

/** Why this device may not change `record`, in words for a person — or `null` when it may. */
export function editLockFor(runtime: KartaRuntime, entity: string, record: Record<string, unknown> | null | undefined): string | null {
  if (!record || runtime.definition.entities[entity]?.editableBy !== "creator") return null;
  const { me, space } = runtime.ctx;
  // Solo: nobody else writes here, so there is nobody to hold back.
  if (!space || !me) return null;
  const creator = typeof record.createdBy === "string" ? record.createdBy : (record.createdBy as { id?: string } | undefined)?.id;
  if (!creator || creator === me.id) return null;
  const name = space.members.find((m) => m.id === creator)?.name;
  return name ? `Only ${name}, who added this, can change it.` : "Only the person who added this can change it.";
}
