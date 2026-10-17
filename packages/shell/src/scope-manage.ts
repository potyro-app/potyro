// What an app-wide selection (`scope`, #134) holds, and duplicating or deleting it with its contents.
//
// An app that works on one list, one trip, one group at a time owes the person the ways to have more
// than one: a new one, a copy of this one, and getting rid of one. None of that is the app's to
// write — every such app needs the same three — so the shell does it, from the shape alone: what
// belongs to a list is every record whose single relation points at it (a shopping item's `list`).
//
// A copy is a copy of the contents too, with the relations between them kept inside the copy: a
// trip's places that point at the trip's days point at the copied days, not the originals.

import type { PotyroRuntime } from "@potyro/runtime";
import type { Resolved } from "potyro";

/** The entities whose records belong to one of `scopeEntity`'s, by which field. */
export function ownedBy(runtime: PotyroRuntime, scopeEntity: string): { entity: string; field: string }[] {
  const out: { entity: string; field: string }[] = [];
  for (const [entity, def] of Object.entries(runtime.definition.entities)) {
    if (entity === scopeEntity) continue;
    for (const [field, f] of Object.entries(def.fields)) {
      if (f.type === "relation" && f.to === scopeEntity && !f.many) out.push({ entity, field });
    }
  }
  return out;
}

const idOf = (v: unknown): string => (typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String((v as { id: unknown }).id) : "");

/** The records that belong to `id`, by entity. */
export async function contentsOf(runtime: PotyroRuntime, scopeEntity: string, id: string): Promise<{ entity: string; rows: Resolved[] }[]> {
  const out: { entity: string; rows: Resolved[] }[] = [];
  for (const { entity, field } of ownedBy(runtime, scopeEntity)) {
    const rows = (await runtime.ctx.query(entity)).filter((r) => idOf(r[field]) === id);
    if (rows.length) out.push({ entity, rows });
  }
  return out;
}

/** A record's own fields as they are written: relations as ids, nothing computed, no bookkeeping. */
function writable(runtime: PotyroRuntime, entity: string, row: Resolved): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, f] of Object.entries(runtime.definition.entities[entity]?.fields ?? {})) {
    const v = row[key];
    if (v === undefined) continue;
    if (f.type === "relation") out[key] = f.many ? (Array.isArray(v) ? v.map(idOf).filter(Boolean) : []) : idOf(v) || null;
    else out[key] = v;
  }
  return out;
}

/**
 * Copy `id` as `name`, with everything that belongs to it. Returns the copy's id.
 *
 * Two passes: every record is made first, then the relations between copied records are pointed at
 * the copies — a record cannot name a copy that does not exist yet.
 */
export async function duplicateScope(runtime: PotyroRuntime, scopeEntity: string, id: string, name: string): Promise<string> {
  const def = runtime.definition.entities[scopeEntity];
  const original = (await runtime.ctx.query(scopeEntity)).find((r) => r.id === id);
  if (!def || !original) throw new Error(`no ${scopeEntity} ${id}`);
  const copy = await runtime.create(scopeEntity, { ...writable(runtime, scopeEntity, original), [def.displayField ?? "name"]: name });
  const ids = new Map<string, string>([[id, String(copy.id)]]);
  const made: { entity: string; id: string; values: Record<string, unknown> }[] = [];
  for (const { entity, rows } of await contentsOf(runtime, scopeEntity, id)) {
    for (const row of rows) {
      const values = writable(runtime, entity, row);
      const created = await runtime.create(entity, values);
      ids.set(String(row.id), String(created.id));
      made.push({ entity, id: String(created.id), values });
    }
  }
  for (const { entity, id: madeId, values } of made) {
    const patch: Record<string, unknown> = {};
    for (const [key, f] of Object.entries(runtime.definition.entities[entity]?.fields ?? {})) {
      if (f.type !== "relation") continue;
      const v = values[key];
      if (Array.isArray(v)) {
        if (v.some((x) => ids.has(String(x)))) patch[key] = v.map((x) => ids.get(String(x)) ?? x);
      } else if (typeof v === "string" && ids.has(v)) patch[key] = ids.get(v);
    }
    if (Object.keys(patch).length) await runtime.patch(entity, madeId, patch);
  }
  return String(copy.id);
}

/** Delete `id` and everything that belongs to it. */
export async function deleteScope(runtime: PotyroRuntime, scopeEntity: string, id: string): Promise<void> {
  for (const { entity, rows } of await contentsOf(runtime, scopeEntity, id)) {
    for (const row of rows) await runtime.remove(entity, String(row.id));
  }
  await runtime.remove(scopeEntity, id);
}
