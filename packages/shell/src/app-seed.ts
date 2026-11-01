// An app's sample records (#486): what a demo link of it opens on, and what its package carries as
// `seed.json` (docs/24 §3, docs/00 "Export, import and packages").
//
// Three places a seed comes from, and never a fourth:
//   - a bundled example's own first-run seeder (seed.ts);
//   - the `seed.json` its package came with (add-app.ts);
//   - for an app made in the Studio, sample records the create loop asked the model for once its app
//     passed its run (`sampleSeed`; the generator's sample-records.ts). Never the run's own made-up
//     rows ("name 1"), which only exercise the code.
// Never the person's own records: nothing here reads an app's store.
//
// The stored seed is never narrowed. The app changes after its seed was made — a modify renames a
// field, an enum loses an option, History puts an older version back — so a seed is fitted at the
// point of USE, against the definition at hand (`seedThatFits`): when a demo link is made, when a
// package is saved, when a demo opens. A row is dropped only when the store's own write gate would
// refuse it, and a reference to a dropped row is taken out of the rows that pointed at it. A version
// whose shape no longer fits gets fewer rows, or none; going back to one that fits gets them all back.

import { fieldValueProblem, type EntityDef, type Field } from "potyro";
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

/**
 * Whether a seed row would go in as it is: every value it holds passes its field's write rule — the
 * one the host holds every write to (values-gate.ts: enum options, min and max, the value's shape).
 * Whether a field is required is not asked: that is the form's question, not the store's (values.ts),
 * and the store takes a record without it — so a field with a default, or with nothing, is fine.
 */
function fits(fields: Readonly<Record<string, Field>>, row: Record<string, unknown>): boolean {
  return Object.entries(fields).every(([key, field]) => valueFits(field, row[key], key));
}

const NONE: ReadonlySet<string> = new Set();

const refId = (v: unknown): string | undefined =>
  typeof v === "string" ? v : typeof v === "object" && v !== null && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : undefined;

/** A relation's value with every reference to a dropped row taken out: a list keeps the rest (or none), one goes. */
function keptRefs(field: Field & { type: "relation" }, value: unknown, dropped: ReadonlySet<string>): unknown {
  const gone = (v: unknown) => dropped.has(refId(v) ?? "");
  if (field.many) return Array.isArray(value) ? value.filter((v) => !gone(v)) : value;
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
 * The part of a seed that fits the app as it is now: only the entities it declares, only rows the
 * store's write gate would take, each row with only the fields it declares, and no reference to a row
 * that was dropped. Undefined when nothing is left. Never adds a row, never changes what is stored:
 * it is what a use of the seed (a demo link, a package, a demo opening) gets.
 */
export function seedThatFits(seed: AppSeed | undefined, entities: Entities): AppSeed | undefined {
  if (!seed || !entities) return undefined;
  const fieldsOf = (entity: string) => (entities[entity]?.fields ?? {}) as Record<string, Field>;
  const good: AppSeed = {};
  const dropped: Record<string, Set<string>> = {};
  for (const [entity, list] of Object.entries(seed)) {
    if (!entities[entity] || !Array.isArray(list)) continue;
    const rows = list.filter((row) => typeof row === "object" && row !== null && !Array.isArray(row));
    good[entity] = rows.filter((row) => fits(fieldsOf(entity), row));
    const left = new Set(good[entity]);
    dropped[entity] = new Set(rows.filter((r) => !left.has(r)).map((r) => refId(r.id)).filter((id): id is string => Boolean(id)));
  }
  // Taking a reference out leaves a row the gate still takes (no field is required of it), so one
  // pass is enough.
  const out: AppSeed = {};
  for (const [entity, list] of Object.entries(good)) if (list.length) out[entity] = list.map((row) => trimmed(fieldsOf(entity), row, dropped));
  return Object.keys(out).length ? out : undefined;
}

/** How many records a seed holds, in every entity. */
export const seedRows = (seed: AppSeed | undefined): number => Object.values(seed ?? {}).reduce((n, rows) => n + (Array.isArray(rows) ? rows.length : 0), 0);

/** Fewer sample records than this, and an app made in the Studio keeps none: it opens on an empty copy. */
export const MIN_SAMPLE_ROWS = 2;
/** At most this many of the model's rows are kept for one entity: it is asked for 3–5. */
const MAX_SAMPLE_ROWS = 8;

/** Fields a model's sample record cannot fill: a photo or a file it would have to name, a person in the app. */
const madeUpOnly = (field: Field): boolean => holdsFile(field) || field.type === "member";

/**
 * The sample records a model wrote for a new app (#486), as its seed: its reply's rows checked one by
 * one by the same rule a use of the seed is (`seedThatFits`) — a row that does not fit is dropped,
 * never repaired. A photo, a file or a person it named is taken out first: it cannot know them.
 * Undefined, and the app opens on an empty copy, when fewer than `MIN_SAMPLE_ROWS` are left, or the
 * reply was not rows at all.
 */
export function sampleSeed(reply: unknown, entities: Entities): AppSeed | undefined {
  if (!entities || typeof reply !== "object" || reply === null || Array.isArray(reply)) return undefined;
  const rows: AppSeed = {};
  for (const [entity, list] of Object.entries(reply as Record<string, unknown>)) {
    const def = entities[entity];
    if (!def || !Array.isArray(list)) continue;
    const fields = (def.fields ?? {}) as Record<string, Field>;
    rows[entity] = list
      .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null && !Array.isArray(row))
      .slice(0, MAX_SAMPLE_ROWS)
      .map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !(fields[k] && madeUpOnly(fields[k]!)))));
  }
  const fitted = seedThatFits(rows, entities);
  return seedRows(fitted) >= MIN_SAMPLE_ROWS ? fitted : undefined;
}
