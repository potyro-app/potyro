// Ask (#213), the shell's half of a proposal: finding the person's records the model named, marking
// what they already have, saving the rows they accepted and running the actions they ticked.
//
// All of it happens HERE, against the person's records on this device, because the model never sees
// those records (packages/generator/src/agent/ask.ts). The model names things the way the person did
// ("the fern", "Kitchen"); `findByName` decides which records those are, by the entity's display field,
// case- and spacing-blind. One exact match is taken; names that merely contain it are offered, not
// taken; nothing found is said plainly. A row already there by name is marked, and comes unticked.
//
// Links inside a proposal are refs ("@lx"). Rows are created first, then those refs are resolved to the
// ids the store gave them; a row that links to rows created after it, or to itself through a cycle,
// gets its links by a patch. A link to a row the person unticked is dropped. A link to one of the
// person's records arrives here already resolved to its id.

import type { AppDefinition, Field, KartaRecord } from "karta";
import { actionInfo } from "karta";
import type { Proposal, ProposedAction, ProposedRow } from "@karta/generator/agent";

type Records = Record<string, ReadonlyArray<Record<string, unknown>>>;

export interface ReviewRow extends ProposedRow {
  /** The person already has a record with this name. Shown, but not ticked. */
  duplicate: boolean;
  /** What the person should know about this row: a link that found nothing, or found something close. */
  notes: string[];
}

export type ReviewTarget =
  | { kind: "new"; ref: string; name: string; ticked: boolean }
  | { kind: "existing"; id: string; name: string; ticked: boolean };

export interface ReviewAction {
  entity: string;
  action: string;
  label: string;
  /** Input with its links resolved to ids. */
  input?: Record<string, unknown>;
  /** The input as the person reads it: "Grams 10 · To Bedroom". */
  inputText?: string;
  targets: ReviewTarget[];
  notes: string[];
}

export interface Review {
  summary: string;
  rows: ReviewRow[];
  actions: ReviewAction[];
}

const norm = (v: unknown): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").toLowerCase() : "");

const nameOf = (def: AppDefinition, entity: string, r: Record<string, unknown>): string => {
  const by = def.entities[entity]?.displayField;
  const v = by ? r[by] : undefined;
  return typeof v === "string" && v.trim() ? v : String(r.id ?? "");
};

/** The person's records of `entity` called `name`: exact names, else names that contain it. */
export function findByName(def: AppDefinition, entity: string, records: ReadonlyArray<Record<string, unknown>>, name: string): { exact: string[]; partial: string[] } {
  const q = norm(name);
  if (!q) return { exact: [], partial: [] };
  const singular = q.length > 3 && q.endsWith("s") ? q.slice(0, -1) : q;
  const named = records.map((r) => ({ id: String(r.id), n: norm(nameOf(def, entity, r)) }));
  const exact = named.filter((r) => r.n === q || r.n === singular).map((r) => r.id);
  if (exact.length) return { exact, partial: [] };
  return { exact: [], partial: named.filter((r) => r.n.includes(q) || r.n.includes(singular)).map((r) => r.id) };
}

/** A link's `{ match }` as the id it names on this device, with a note when that is not certain. */
function resolveLink(def: AppDefinition, to: string, existing: Records, name: string, label: string): { id?: string; note?: string } {
  const records = existing[to] ?? [];
  const { exact, partial } = findByName(def, to, records, name);
  const called = (id: string) => nameOf(def, to, records.find((r) => r.id === id) ?? {});
  if (exact.length === 1) return { id: exact[0] };
  if (!exact.length && partial.length === 1) return { id: partial[0], note: `${label}: “${name}” taken as ${called(partial[0]!)}.` };
  const many = exact.length > 1 ? exact : partial;
  if (many.length) return { note: `${label}: “${name}” could be ${many.map(called).join(", ")}; left empty.` };
  return { note: `${label}: nothing called “${name}”; left empty.` };
}

/** Values with every `{ match }` link replaced by the id it names, or dropped with a note. */
function resolveLinks(def: AppDefinition, fields: Record<string, Field>, values: Record<string, unknown>, existing: Records): { values: Record<string, unknown>; notes: string[] } {
  const out: Record<string, unknown> = { ...values };
  const notes: string[] = [];
  for (const [key, field] of Object.entries(fields)) {
    if (field.type !== "relation" || values[key] === undefined) continue;
    const label = field.label ?? key;
    const one = (v: unknown): unknown => {
      if (typeof v !== "object" || v === null || !("match" in v)) return v;
      const r = resolveLink(def, field.to, existing, String((v as { match: unknown }).match), label);
      if (r.note) notes.push(r.note);
      return r.id;
    };
    if (field.many) {
      const list = (Array.isArray(values[key]) ? (values[key] as unknown[]) : [values[key]]).map(one).filter((v) => v !== undefined);
      out[key] = list;
    } else {
      const v = one(values[key]);
      if (v === undefined) delete out[key];
      else out[key] = v;
    }
  }
  return { values: out, notes };
}

/** `rows`, each marked when the person already has a record of that entity with the same name. */
export function markDuplicates(def: AppDefinition, rows: ProposedRow[], existing: Records): ReviewRow[] {
  const names = new Map<string, Set<string>>();
  for (const [entity, records] of Object.entries(existing)) {
    const by = def.entities[entity]?.displayField;
    if (by) names.set(entity, new Set(records.map((r) => norm(r[by])).filter(Boolean)));
  }
  return rows.map((row) => {
    const by = def.entities[row.entity]?.displayField;
    const name = by ? norm(row.values[by]) : "";
    return { ...row, duplicate: Boolean(name && names.get(row.entity)?.has(name)), notes: (row as Partial<ReviewRow>).notes ?? [] };
  });
}

function reviewAction(def: AppDefinition, run: ProposedAction, rows: ProposedRow[], existing: Records): ReviewAction {
  const info = actionInfo(def.entities[run.entity], run.action);
  const notes: string[] = [];
  let input = run.input;
  if (input && info?.input) {
    const r = resolveLinks(def, info.input, input, existing);
    input = r.values;
    notes.push(...r.notes);
  }
  const targets: ReviewTarget[] = [];
  if (run.on) {
    const row = rows.find((r) => `@${r.ref}` === run.on);
    if (row) targets.push({ kind: "new", ref: row.ref, name: nameOf(def, row.entity, row.values), ticked: true });
  } else if (run.match) {
    const records = existing[run.entity] ?? [];
    const { exact, partial } = findByName(def, run.entity, records, run.match);
    for (const id of exact.length ? exact : partial) {
      targets.push({ kind: "existing", id, name: nameOf(def, run.entity, records.find((r) => r.id === id)!), ticked: exact.length > 0 });
    }
    const label = def.entities[run.entity]?.label?.toLowerCase() ?? run.entity;
    if (!targets.length) notes.push(`No ${label} called “${run.match}”.`);
    else if (!exact.length) notes.push(`Nothing is called exactly “${run.match}”; tick the ones you meant.`);
  }
  const inputText = run.input && info?.input
    ? Object.entries(run.input)
        .map(([k, v]) => {
          const f = info.input![k];
          const shown = typeof v === "object" && v !== null && "match" in v ? String((v as { match: unknown }).match) : Array.isArray(v) ? `${v.length}` : String(v);
          return `${f?.label ?? k} ${shown}`;
        })
        .join(" · ")
    : undefined;
  return { entity: run.entity, action: run.action, label: info?.label ?? run.action, input, inputText, targets, notes };
}

/** Everything the review shows, resolved against the person's records on this device. */
export function prepareReview(def: AppDefinition, proposal: Proposal, existing: Records): Review {
  const resolved = proposal.rows.map((row) => {
    const r = resolveLinks(def, def.entities[row.entity]?.fields ?? {}, row.values, existing);
    return { ...row, values: r.values, notes: r.notes };
  });
  return {
    summary: proposal.summary,
    rows: markDuplicates(def, resolved, existing),
    actions: proposal.actions.map((a) => reviewAction(def, a, proposal.rows, existing)),
  };
}

/** The entities a review needs the person's records of: rows, link targets, actions, their inputs' links. */
export function entitiesToLoad(def: AppDefinition, proposal: Proposal): string[] {
  const out = new Set<string>();
  const links = (fields: Record<string, Field> | undefined) => {
    for (const f of Object.values(fields ?? {})) if (f.type === "relation") out.add(f.to);
  };
  for (const r of proposal.rows) {
    out.add(r.entity);
    links(def.entities[r.entity]?.fields);
  }
  for (const a of proposal.actions) {
    out.add(a.entity);
    links(actionInfo(def.entities[a.entity], a.action)?.input);
  }
  return [...out].filter((e) => def.entities[e]);
}

interface Writer {
  create(entity: string, data: Partial<KartaRecord>): Promise<KartaRecord>;
  patch(entity: string, id: string, data: Partial<KartaRecord>): Promise<void>;
}

interface ActionRunner {
  runAction(entity: string, action: string, id: string, input?: unknown): Promise<void>;
}

const refOf = (v: unknown): string | null => (typeof v === "string" && v.startsWith("@") ? v.slice(1) : null);

function relationKeys(def: AppDefinition, entity: string): Array<[string, Field & { type: "relation" }]> {
  return Object.entries(def.entities[entity]?.fields ?? {}).filter((e): e is [string, Field & { type: "relation" }] => e[1].type === "relation");
}

/** A save or a run that stopped partway. What came before IS done: `created` says how much, so the
 *  person is told the truth rather than "nothing happened". */
export class ApplyError extends Error {
  constructor(
    readonly created: number,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ApplyError";
  }
}

/** Save the accepted rows: how many, and the id each ref got. Throws `ApplyError` if a write fails. */
export async function applyProposal(runtime: Writer, def: AppDefinition, rows: ProposedRow[]): Promise<{ created: number; ids: Map<string, string> }> {
  let created = 0;
  const ids = new Map<string, string>();
  try {
    await saveRows(runtime, def, rows, ids, () => (created += 1));
    return { created, ids };
  } catch (e) {
    throw new ApplyError(created, e);
  }
}

/** Run the ticked actions, in order. Returns how many ran; throws `ApplyError` at the first failure. */
export async function runActions(runner: ActionRunner, runs: Array<{ entity: string; action: string; id: string; input?: Record<string, unknown> }>): Promise<number> {
  let ran = 0;
  try {
    for (const r of runs) {
      await runner.runAction(r.entity, r.action, r.id, r.input);
      ran += 1;
    }
    return ran;
  } catch (e) {
    throw new ApplyError(ran, e);
  }
}

async function saveRows(runtime: Writer, def: AppDefinition, rows: ProposedRow[], ids: Map<string, string>, onCreated: () => void): Promise<void> {
  const accepted = new Set(rows.map((r) => r.ref));
  const later: Array<{ row: ProposedRow; id: string; links: Record<string, { fixed: string[]; refs: string[] }> }> = [];
  const split = (v: unknown) => {
    const list = Array.isArray(v) ? v : [v];
    return {
      refs: list.map(refOf).filter((r): r is string => r !== null && accepted.has(r)),
      // An id already resolved on this device (a `{ match }` the review found).
      fixed: list.filter((x): x is string => typeof x === "string" && refOf(x) === null && x !== ""),
    };
  };

  // Rows nothing waits on go first where possible, so most links are set at creation.
  const pending = [...rows];
  const ready = (row: ProposedRow) => relationKeys(def, row.entity).every(([k]) => split(row.values[k]).refs.every((r) => ids.has(r) || r === row.ref));

  while (pending.length) {
    const i = Math.max(0, pending.findIndex(ready));
    const row = pending.splice(i, 1)[0]!;
    const data: Record<string, unknown> = { ...row.values };
    const links: Record<string, { fixed: string[]; refs: string[] }> = {};
    for (const [key, field] of relationKeys(def, row.entity)) {
      const v = row.values[key];
      if (v === undefined) continue;
      delete data[key];
      const { refs, fixed } = split(v);
      if (!refs.length && !fixed.length) continue;
      if (refs.every((r) => ids.has(r))) {
        const all = [...fixed, ...refs.map((r) => ids.get(r)!)];
        data[key] = field.many ? all : all[0];
      } else links[key] = { fixed, refs };
    }
    const record = await runtime.create(row.entity, data as Partial<KartaRecord>);
    onCreated();
    ids.set(row.ref, record.id);
    if (Object.keys(links).length) later.push({ row, id: record.id, links });
  }

  for (const { row, id, links } of later) {
    const data: Record<string, unknown> = {};
    for (const [key, { fixed, refs }] of Object.entries(links)) {
      const field = def.entities[row.entity]!.fields[key] as Field & { type: "relation" };
      const all = [...fixed, ...refs.map((r) => ids.get(r)).filter((x): x is string => Boolean(x))];
      data[key] = field.many ? all : all[0];
    }
    await runtime.patch(row.entity, id, data as Partial<KartaRecord>);
  }
}
