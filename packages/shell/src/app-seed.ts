// An app's sample records (#486): what a demo link of it opens on, and what its package carries as
// `seed.json` (docs/24 §3, docs/00 "Export, import and packages").
//
// Three places a seed comes from, and never a fourth:
//   - a bundled example's own first-run seeder (seed.ts);
//   - the `seed.json` its package came with (add-app.ts);
//   - for an app made in the Studio, the records its run check made up to test it on (run-candidate.ts):
//     a candidate that passed is kept with the records it passed on.
// Never the person's own records: nothing here reads an app's store.
//
// The app changes after its seed was made — a modify renames a field, an enum loses an option — so a
// seed is fitted to the app as it is now whenever the definition is at hand (`seedThatFits`): a row
// that no longer fits is dropped, never repaired by guessing, and a reference to a dropped row is
// taken out of the rows that pointed at it.

import { fieldValueProblem, type EntityDef, type Field } from "potyro";
import type { Store } from "@potyro/store";
import { isSeedFile } from "./seed-files.js";

/** Sample records by entity, as JSON: the shape of a package's `seed.json`. */
export type AppSeed = Record<string, Array<Record<string, unknown>>>;

/** Fields a store adds to every record: not the app's data, and never worth carrying. */
const STORE_FIELDS = new Set(["createdAt", "updatedAt"]);

/** A record as JSON: dates as their ISO text, nothing a seed cannot hold. */
export function plainSeedRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (STORE_FIELDS.has(k) || v === undefined) continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return JSON.parse(JSON.stringify(out)) as Record<string, unknown>;
}

/** Every record of these entities in a store, as a seed. Only ever called on a throwaway store. */
export async function seedFromStore(store: Store, entities: readonly string[]): Promise<AppSeed | undefined> {
  const seed: AppSeed = {};
  for (const entity of entities) {
    const rows = await store.all(entity);
    if (rows.length) seed[entity] = rows.map((r) => plainSeedRow(r as unknown as Record<string, unknown>));
  }
  return Object.keys(seed).length ? seed : undefined;
}

export type Entities = Readonly<Record<string, EntityDef>> | undefined;

/** A picture or a document a seed names by the file it shipped with: what a photo or file field may hold. */
const holdsFile = (field: Field): boolean => field.type === "media" || field.type === "file";
const isFileValue = (field: Field, v: unknown): boolean => holdsFile(field) && (isSeedFile(v) || (Array.isArray(v) && v.length > 0 && v.every(isSeedFile)));

/** Whether one value fits its field's write rule, a file named by its path where a photo or a file goes. */
function valueFits(field: Field, value: unknown, key: string): boolean {
  if (isFileValue(field, value)) return true;
  // A list's rows are judged one sub-field at a time, so a photo in a row can be a path too.
  if (field.type === "list" && Array.isArray(value) && value.every((r) => typeof r === "object" && r !== null && !Array.isArray(r))) {
    return value.every((row: Record<string, unknown>) => Object.entries(field.of).every(([k, sub]) => valueFits(sub, row[k], k)));
  }
  return fieldValueProblem(field, value, "write", key) === null;
}

/** Whether a seed row fits its entity as it is now: every value its field's write rule, every required field there. */
function fits(fields: Readonly<Record<string, Field>>, row: Record<string, unknown>): boolean {
  for (const [key, field] of Object.entries(fields)) {
    const value = row[key];
    // A photo cannot be made up, so a sample record without one is still a sample record.
    if (field.required && (value == null || value === "") && !holdsFile(field)) return false;
    if (!valueFits(field, value, key)) return false;
  }
  return true;
}

const NONE: ReadonlySet<string> = new Set();

const refId = (v: unknown): string | undefined =>
  typeof v === "string" ? v : typeof v === "object" && v !== null && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : undefined;

/** A relation's value with every reference to a dropped row taken out; undefined when none is left. */
function keptRefs(field: Field & { type: "relation" }, value: unknown, dropped: ReadonlySet<string>): unknown {
  const gone = (v: unknown) => dropped.has(refId(v) ?? "");
  if (field.many) {
    const left = Array.isArray(value) ? value.filter((v) => !gone(v)) : [];
    return left.length ? left : undefined;
  }
  return gone(value) ? undefined : value;
}

/**
 * A row with only the fields its entity declares, and no reference to a row that was dropped. A
 * reference to a record the seed never had (one the app makes itself) is left as it is.
 */
function trimmed(fields: Readonly<Record<string, Field>>, row: Record<string, unknown>, dropped: Readonly<Record<string, Set<string>>>): Record<string, unknown> {
  const out: Record<string, unknown> = typeof row.id === "string" ? { id: row.id } : {};
  for (const [key, field] of Object.entries(fields)) {
    let value = row[key];
    if (value === undefined) continue;
    if (field.type === "relation") value = keptRefs(field, value, dropped[field.to] ?? NONE);
    else if (field.type === "list" && Array.isArray(value)) {
      value = value.map((sub: Record<string, unknown>) => {
        const out: Record<string, unknown> = { ...sub };
        for (const [k, f] of Object.entries(field.of)) {
          if (f.type !== "relation" || out[k] === undefined) continue;
          const left = keptRefs(f, out[k], dropped[f.to] ?? NONE);
          if (left === undefined) delete out[k];
          else out[k] = left;
        }
        return out;
      });
    }
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * The part of a seed that fits the app as it is now: only the entities it declares, only rows whose
 * values still pass their fields' rules, each row with only the fields it declares, and no reference
 * to a row that was dropped. Undefined when nothing is left. Never adds a row.
 */
export function seedThatFits(seed: AppSeed | undefined, entities: Entities): AppSeed | undefined {
  if (!seed || !entities) return undefined;
  const fieldsOf = (entity: string) => (entities[entity]?.fields ?? {}) as Record<string, Field>;
  let rows: AppSeed = {};
  for (const [entity, list] of Object.entries(seed)) {
    if (entities[entity] && Array.isArray(list)) rows[entity] = list.filter((row) => typeof row === "object" && row !== null && !Array.isArray(row));
  }
  // Dropping a row can leave a row that needed it (a required reference) without it: again, until
  // every row left fits. Each round drops a row or ends, so it ends.
  for (;;) {
    const good: AppSeed = {};
    for (const [entity, list] of Object.entries(rows)) good[entity] = list.filter((row) => fits(fieldsOf(entity), row));
    const dropped: Record<string, Set<string>> = {};
    for (const [entity, list] of Object.entries(rows)) {
      const left = new Set(good[entity]);
      dropped[entity] = new Set(list.filter((r) => !left.has(r)).map((r) => refId(r.id)).filter((id): id is string => Boolean(id)));
    }
    const next: AppSeed = {};
    for (const [entity, list] of Object.entries(good)) if (list.length) next[entity] = list.map((row) => trimmed(fieldsOf(entity), row, dropped));
    if (Object.entries(next).every(([entity, list]) => list.every((row) => fits(fieldsOf(entity), row)))) {
      return Object.keys(next).length ? next : undefined;
    }
    rows = next;
  }
}

/** Whether two seeds are the same rows. */
export const sameSeed = (a: AppSeed | undefined, b: AppSeed | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The seed to save with a version of an app (#486), fitted to that version's entities: a new app's
 * is the one its run passed on (`made`); a changed app keeps the rows of the one it had that still
 * fit. `null` when none is left — the app's seed goes; `undefined` when the version's entities are not
 * known (it did not build), and the seed stays as it was until a version that builds.
 */
export function seedForVersion(opts: { isNew: boolean; prev?: AppSeed; made?: AppSeed; entities: Entities }): AppSeed | null | undefined {
  if (!opts.entities) return opts.isNew ? opts.made : undefined;
  return seedThatFits(opts.isNew ? opts.made : opts.prev, opts.entities) ?? null;
}
