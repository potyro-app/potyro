// Ask (#213), the shell's half of a proposal: which rows the person already has, and saving the
// rows they accepted.
//
// Duplicates are found HERE, against the person's records on this device, because the model never
// sees those records (packages/generator/src/agent/ask.ts). A match is by the entity's display
// field, case- and spacing-blind: "Jardim da Estrela" is already there as "jardim da estrela".
//
// Relations inside a proposal are refs ("@lx"). Rows are created first, then those refs are resolved
// to the ids the store gave them; a row that links to rows created after it, or to itself through a
// cycle, gets its links by a patch. A link to a row the person unticked is dropped.

import type { AppDefinition, Field, KartaRecord } from "karta";
import type { ProposedRow } from "@karta/generator/agent";

export interface ReviewRow extends ProposedRow {
  /** The person already has a record with this name. Shown, but not ticked. */
  duplicate: boolean;
}

const norm = (v: unknown): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").toLowerCase() : "");

/** `rows`, each marked when the person already has a record of that entity with the same name. */
export function markDuplicates(def: AppDefinition, rows: ProposedRow[], existing: Record<string, ReadonlyArray<Record<string, unknown>>>): ReviewRow[] {
  const names = new Map<string, Set<string>>();
  for (const [entity, records] of Object.entries(existing)) {
    const by = def.entities[entity]?.displayField;
    if (by) names.set(entity, new Set(records.map((r) => norm(r[by])).filter(Boolean)));
  }
  return rows.map((row) => {
    const by = def.entities[row.entity]?.displayField;
    const name = by ? norm(row.values[by]) : "";
    return { ...row, duplicate: Boolean(name && names.get(row.entity)?.has(name)) };
  });
}

interface Writer {
  create(entity: string, data: Partial<KartaRecord>): Promise<KartaRecord>;
  patch(entity: string, id: string, data: Partial<KartaRecord>): Promise<void>;
}

const refOf = (v: unknown): string | null => (typeof v === "string" && v.startsWith("@") ? v.slice(1) : null);

function relationKeys(def: AppDefinition, entity: string): Array<[string, Field & { type: "relation" }]> {
  return Object.entries(def.entities[entity]?.fields ?? {}).filter((e): e is [string, Field & { type: "relation" }] => e[1].type === "relation");
}

/** Save the accepted rows. Returns how many records were created. */
export async function applyProposal(runtime: Writer, def: AppDefinition, rows: ProposedRow[]): Promise<number> {
  const accepted = new Set(rows.map((r) => r.ref));
  const ids = new Map<string, string>();
  const later: Array<{ row: ProposedRow; id: string; links: Record<string, unknown> }> = [];

  // Rows nothing waits on go first where possible, so most links are set at creation.
  const pending = [...rows];
  const ready = (row: ProposedRow) =>
    relationKeys(def, row.entity).every(([k]) => {
      const v = row.values[k];
      const refs = (Array.isArray(v) ? v : [v]).map(refOf).filter((r): r is string => r !== null && accepted.has(r));
      return refs.every((r) => ids.has(r) || r === row.ref);
    });

  while (pending.length) {
    const i = Math.max(0, pending.findIndex(ready));
    const row = pending.splice(i, 1)[0]!;
    const data: Record<string, unknown> = { ...row.values };
    const links: Record<string, unknown> = {};
    for (const [key, field] of relationKeys(def, row.entity)) {
      const v = row.values[key];
      if (v === undefined) continue;
      delete data[key];
      const refs = (Array.isArray(v) ? v : [v]).map(refOf).filter((r): r is string => r !== null && accepted.has(r));
      if (!refs.length) continue;
      if (refs.every((r) => ids.has(r))) data[key] = field.many ? refs.map((r) => ids.get(r)) : ids.get(refs[0]!);
      else links[key] = refs;
    }
    const created = await runtime.create(row.entity, data as Partial<KartaRecord>);
    ids.set(row.ref, created.id);
    if (Object.keys(links).length) later.push({ row, id: created.id, links });
  }

  for (const { row, id, links } of later) {
    const data: Record<string, unknown> = {};
    for (const [key, refs] of Object.entries(links)) {
      const field = def.entities[row.entity]!.fields[key] as Field & { type: "relation" };
      const resolved = (refs as string[]).map((r) => ids.get(r)).filter(Boolean);
      data[key] = field.many ? resolved : resolved[0];
    }
    await runtime.patch(row.entity, id, data as Partial<KartaRecord>);
  }
  return rows.length;
}
