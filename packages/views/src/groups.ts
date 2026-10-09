// One grouping for the form and the detail page (#100). An entity's `groups` say how its fields
// are arranged; both surfaces read the same declaration, so the sections a person edits in are
// the sections they read back. Before this, only the detail view had sections and only the form
// followed field order, and the two never matched.

import type { EntityDef, Field } from "potyro";

export interface ResolvedGroup {
  title?: string;
  /** Keys in group order: fields, and on the detail page computed values too. */
  fields: string[];
  /** Folded at first. Never true for the first group — it is what the page opens on. */
  collapsed: boolean;
  /** The heading folds it, remembered on this device (#108). A folded-at-first group always can. */
  collapsible?: boolean;
}

export type GroupSurface = "form" | "detail";

const isHidden = (field: Field | undefined): boolean => Boolean((field as { hidden?: boolean } | undefined)?.hidden);

/**
 * The entity's groups as this surface shows them. Hidden fields never appear. The form shows
 * only editable fields (a computed value has no control); the detail page shows fields and
 * computed alike. Fields left out of every group follow the last one, untitled, in declaration
 * order — a field added in the Studio is never lost for want of a group. Groups left with nothing
 * to show are dropped rather than rendered as an empty heading.
 */
export function resolveGroups(entity: EntityDef | undefined, surface: GroupSurface): ResolvedGroup[] {
  const fields = entity?.fields ?? {};
  const computed = entity?.computed ?? {};
  const shows = (key: string): boolean => {
    const field = fields[key];
    if (field) return !isHidden(field);
    return surface === "detail" && key in computed;
  };
  const placed = new Set<string>();
  const out: ResolvedGroup[] = [];
  for (const group of entity?.groups ?? []) {
    const keys = group.fields.filter((key) => shows(key) && !placed.has(key));
    for (const key of keys) placed.add(key);
    if (keys.length === 0) continue;
    const collapsed = out.length > 0 && Boolean(group.collapsed);
    out.push({ ...(group.title ? { title: group.title } : {}), fields: keys, collapsed, collapsible: collapsed || Boolean(group.collapsible) });
  }
  const rest = Object.keys(fields).filter((key) => !placed.has(key) && shows(key));
  if (rest.length > 0) out.push({ fields: rest, collapsed: false });
  return out;
}
