// Ask (#213), the shell's half of a proposal: finding the person's records the model named, marking
// what they already have, saving the rows they accepted and running the actions they ticked.
//
// All of it happens HERE, against the person's records on this device, because the model never sees
// those records (packages/generator/src/agent/ask.ts). The model names things the way the person did
// ("the fern", "Kitchen"); `findByName` decides which records those are, by the entity's display field,
// case- and spacing-blind. Only a single exact match is ever taken. Anything less — a name that merely
// contains it, two records with the same name — is offered unticked (an action's targets) or left
// empty with a note naming the candidates (a link); nothing found is said plainly. A row already
// there by name is marked, and comes unticked.
//
// Links inside a proposal are refs ("@lx"). Rows are created first, then those refs are resolved to the
// ids the store gave them; a row that links to rows created after it, or to itself through a cycle,
// gets its links by a patch. A link to a row the person unticked is dropped. A link to one of the
// person's records arrives here already resolved to its id.

import type { AppDefinition, Field, KartaRecord } from "karta";
import { actionInfo, humanizeKey } from "karta";
import type { Proposal, ProposedAction, ProposedRow, Trust } from "@karta/generator/agent";

type Records = Record<string, ReadonlyArray<Record<string, unknown>>>;

export interface ReviewRow extends ProposedRow {
  /** The person already has a record with this name. Shown, but not ticked. */
  duplicate: boolean;
  /** What the person should know about this row: a link that found nothing, or found something close. */
  notes: string[];
  /** How far what it says was confirmed by what was read. Absent for records the device made itself. */
  trust?: Trust;
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

/** Can a record of `entity` be made from a name alone? Its only required field is the name. */
function creatableByName(def: AppDefinition, entity: string): string | null {
  const e = def.entities[entity];
  const by = e?.displayField;
  if (!e || !by || e.fields[by]?.type !== "text") return null;
  const needs = Object.entries(e.fields).filter(([k, f]) => f.required && f.default === undefined && k !== by);
  return needs.length ? null : by;
}

/**
 * Resolves `{ match }` links against this device's records. One exact name links to it. A name that
 * finds nothing becomes a new record, when a name is all that record needs ("Dairy" for an aisle) —
 * one per name, shared by every link that asks for it. Anything uncertain is left empty, with a note.
 */
class Links {
  readonly made: ReviewRow[] = [];
  private readonly byName = new Map<string, string>();
  constructor(
    private readonly def: AppDefinition,
    private readonly existing: Records,
  ) {}

  /** The id, or "@ref" of a row made for it, or undefined (with a note) when it stays empty. */
  resolve(to: string, name: string, label: string, notes: string[]): string | undefined {
    const records = this.existing[to] ?? [];
    const { exact, partial } = findByName(this.def, to, records, name);
    const called = (id: string) => nameOf(this.def, to, records.find((r) => r.id === id) ?? {});
    if (exact.length === 1) return exact[0];
    const many = exact.length > 1 ? exact : partial;
    if (many.length) {
      notes.push(`${label}: “${name}” could be ${many.map(called).join(", ")}; left empty.`);
      return undefined;
    }
    const by = creatableByName(this.def, to);
    if (!by) {
      notes.push(`${label}: nothing called “${name}”; left empty.`);
      return undefined;
    }
    const key = `${to}:${norm(name)}`;
    let ref = this.byName.get(key);
    if (!ref) {
      ref = `new-${to}-${this.byName.size + 1}`;
      this.byName.set(key, ref);
      this.made.push({ entity: to, ref, values: { [by]: name.trim() }, duplicate: false, notes: [] });
    }
    return `@${ref}`;
  }

  /** `values` with every `{ match }` link resolved, top level and inside list rows. */
  values(fields: Record<string, Field>, values: Record<string, unknown>, notes: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = { ...values };
    const link = (field: Field & { type: "relation" }, label: string, v: unknown): unknown => {
      if (typeof v !== "object" || v === null || !("match" in v)) return v;
      return this.resolve(field.to, String((v as { match: unknown }).match), label, notes);
    };
    for (const [key, field] of Object.entries(fields)) {
      const v = values[key];
      if (v === undefined) continue;
      const label = field.label ?? humanizeKey(key);
      if (field.type === "relation") {
        if (field.many) out[key] = (Array.isArray(v) ? v : [v]).map((x) => link(field, label, x)).filter((x) => x !== undefined);
        else {
          const r = link(field, label, v);
          if (r === undefined) delete out[key];
          else out[key] = r;
        }
      } else if (field.type === "list" && Array.isArray(v)) {
        out[key] = v.map((row) => (typeof row === "object" && row !== null ? this.values(field.of, row as Record<string, unknown>, notes) : row));
      }
    }
    return out;
  }
}

/** `values` with each "@ref" in `map` replaced by the id it maps to, top level and inside list rows. */
function retarget(fields: Record<string, Field>, values: Record<string, unknown>, map: Map<string, string>): Record<string, unknown> {
  if (!map.size) return values;
  const out: Record<string, unknown> = { ...values };
  const one = (v: unknown) => (typeof v === "string" && v.startsWith("@") && map.has(v.slice(1)) ? map.get(v.slice(1)) : v);
  for (const [key, field] of Object.entries(fields)) {
    const v = values[key];
    if (field.type === "relation") out[key] = Array.isArray(v) ? v.map(one) : one(v);
    else if (field.type === "list" && Array.isArray(v)) out[key] = v.map((row) => (typeof row === "object" && row !== null ? retarget(field.of, row as Record<string, unknown>, map) : row));
  }
  for (const k of Object.keys(out)) if (out[k] === undefined && values[k] === undefined) delete out[k];
  return out;
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

function reviewAction(def: AppDefinition, run: ProposedAction, rows: ProposedRow[], existing: Records, links: Links, dup: Map<string, string>): ReviewAction {
  const info = actionInfo(def.entities[run.entity], run.action);
  const notes: string[] = [];
  // A declared action always gets an input, even an empty one: with none, the runtime would take the
  // run for a button tap and ask with a form, in the middle of applying a review.
  let input = info?.input ? (run.input ?? {}) : run.input;
  if (input && info?.input) input = retarget(info.input, links.values(info.input, input, notes), dup);
  const targets: ReviewTarget[] = [];
  if (run.on) {
    const ref = run.on.slice(1);
    const row = rows.find((r) => r.ref === ref);
    const mine = dup.get(ref);
    if (mine) targets.push({ kind: "existing", id: mine, name: nameOf(def, run.entity, (existing[run.entity] ?? []).find((r) => r.id === mine) ?? {}), ticked: true });
    else if (row) targets.push({ kind: "new", ref: row.ref, name: nameOf(def, row.entity, row.values), ticked: true });
  } else if (run.match) {
    const records = existing[run.entity] ?? [];
    const { exact, partial } = findByName(def, run.entity, records, run.match);
    for (const id of exact.length ? exact : partial) {
      targets.push({ kind: "existing", id, name: nameOf(def, run.entity, records.find((r) => r.id === id)!), ticked: exact.length === 1 });
    }
    const label = def.entities[run.entity]?.label?.toLowerCase() ?? run.entity;
    if (!targets.length) notes.push(`No ${label} called “${run.match}”.`);
    else if (exact.length > 1) notes.push(`More than one ${label} is called “${run.match}”; tick the ones you meant.`);
    else if (!exact.length) notes.push(`Nothing is called exactly “${run.match}”; tick the ones you meant.`);
  }
  const inputText = run.input && info?.input
    ? Object.entries(run.input)
        .map(([k, v]) => {
          const f = info.input![k];
          const shown = typeof v === "object" && v !== null && "match" in v ? String((v as { match: unknown }).match) : Array.isArray(v) ? `${v.length}` : String(v);
          return `${f?.label ?? humanizeKey(k)} ${shown}`;
        })
        .join(" · ")
    : undefined;
  return { entity: run.entity, action: run.action, label: info?.label ?? run.action, input, inputText, targets, notes };
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** A note on each place well outside the area the person was looking at. */
function areaNotes(def: AppDefinition, row: ReviewRow, area: { lat: number; lng: number; radiusKm?: number }): string[] {
  const out: string[] = [];
  for (const [key, f] of Object.entries(def.entities[row.entity]?.fields ?? {})) {
    const v = row.values[key] as { lat?: unknown; lng?: unknown } | undefined;
    if (f.type !== "geo" || typeof v?.lat !== "number" || typeof v?.lng !== "number") continue;
    const km = distanceKm(area, { lat: v.lat, lng: v.lng });
    if (km > Math.max(3, 2 * (area.radiusKm ?? 1))) out.push(`About ${Math.round(km)} km from the area on your map.`);
  }
  return out;
}

/** Everything the review shows, resolved against the person's records on this device. */
export function prepareReview(def: AppDefinition, proposal: Proposal, existing: Records, opts: { area?: { lat: number; lng: number; radiusKm?: number } } = {}): Review {
  const links = new Links(def, existing);
  const resolved = proposal.rows.map((row) => {
    const notes: string[] = [];
    const values = links.values(def.entities[row.entity]?.fields ?? {}, row.values, notes);
    return { ...row, values, notes };
  });
  const marked = markDuplicates(def, resolved, existing);
  // A proposed row the person already has: every link to it goes to theirs instead.
  const dup = new Map<string, string>();
  for (const row of marked) {
    if (!row.duplicate) continue;
    const by = def.entities[row.entity]?.displayField;
    const mine = by ? (existing[row.entity] ?? []).find((r) => norm(r[by]) === norm(row.values[by])) : undefined;
    if (mine) dup.set(row.ref, String(mine.id));
  }
  const rows = [...links.made, ...marked].map((row) => ({
    ...row,
    values: retarget(def.entities[row.entity]?.fields ?? {}, row.values, dup),
    notes: [...row.notes, ...(opts.area ? areaNotes(def, row, opts.area) : [])],
    ...(proposal.trust?.[row.ref] ? { trust: proposal.trust[row.ref] } : {}),
  }));
  return {
    summary: proposal.summary,
    rows,
    actions: proposal.actions.map((a) => reviewAction(def, a, proposal.rows, existing, links, dup)),
  };
}

/** The entities a review needs the person's records of: rows, link targets (in list rows too), actions, their inputs' links. */
export function entitiesToLoad(def: AppDefinition, proposal: Proposal): string[] {
  const out = new Set<string>();
  const links = (fields: Record<string, Field> | undefined) => {
    for (const f of Object.values(fields ?? {})) {
      if (f.type === "relation") out.add(f.to);
      if (f.type === "list") links(f.of);
    }
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

/** Every "@ref" a row's values hold, top level and inside list rows. */
function refsIn(fields: Record<string, Field>, values: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [key, field] of Object.entries(fields)) {
    const v = values[key];
    if (field.type === "relation") for (const x of Array.isArray(v) ? v : [v]) if (refOf(x)) out.push(refOf(x)!);
    if (field.type === "list" && Array.isArray(v)) for (const row of v) if (typeof row === "object" && row !== null) out.push(...refsIn(field.of, row as Record<string, unknown>));
  }
  return out;
}

/** `values` with refs swapped for ids. A ref to a row that was not accepted is dropped; one not yet
 *  created (a cycle) is dropped from list rows and collected for a patch at the top level. */
function substitute(
  fields: Record<string, Field>,
  values: Record<string, unknown>,
  ids: Map<string, string>,
  accepted: Set<string>,
  later: Record<string, string[]> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values };
  for (const [key, field] of Object.entries(fields)) {
    const v = values[key];
    if (v === undefined) continue;
    if (field.type === "relation") {
      const list = Array.isArray(v) ? v : [v];
      const now: string[] = [];
      const wait: string[] = [];
      for (const x of list) {
        const ref = refOf(x);
        if (ref === null) {
          if (typeof x === "string" && x) now.push(x); // an id resolved on this device
        } else if (ids.has(ref)) now.push(ids.get(ref)!);
        else if (accepted.has(ref)) wait.push(ref);
      }
      if (wait.length && later) later[key] = wait;
      if (!now.length) delete out[key];
      else out[key] = field.many ? now : now[0];
    } else if (field.type === "list" && Array.isArray(v)) {
      out[key] = v.map((row) => (typeof row === "object" && row !== null ? substitute(field.of, row as Record<string, unknown>, ids, accepted, null) : row));
    }
  }
  return out;
}

async function saveRows(runtime: Writer, def: AppDefinition, rows: ProposedRow[], ids: Map<string, string>, onCreated: () => void): Promise<void> {
  const accepted = new Set(rows.map((r) => r.ref));
  const fieldsOf = (row: ProposedRow) => def.entities[row.entity]?.fields ?? {};
  const later: Array<{ row: ProposedRow; id: string; links: Record<string, string[]> }> = [];

  // Rows nothing waits on go first where possible, so most links are set at creation.
  const pending = [...rows];
  const ready = (row: ProposedRow) => refsIn(fieldsOf(row), row.values).every((r) => !accepted.has(r) || ids.has(r) || r === row.ref);

  while (pending.length) {
    const i = Math.max(0, pending.findIndex(ready));
    const row = pending.splice(i, 1)[0]!;
    const waits: Record<string, string[]> = {};
    const data = substitute(fieldsOf(row), row.values, ids, accepted, waits);
    const record = await runtime.create(row.entity, data as Partial<KartaRecord>);
    onCreated();
    ids.set(row.ref, record.id);
    if (Object.keys(waits).length) later.push({ row, id: record.id, links: waits });
  }

  for (const { row, id, links } of later) {
    const data: Record<string, unknown> = {};
    for (const [key, refs] of Object.entries(links)) {
      const field = fieldsOf(row)[key] as Field & { type: "relation" };
      const current = substitute(fieldsOf(row), { [key]: row.values[key] }, ids, accepted, null)[key];
      data[key] = field.many ? current : (current ?? ids.get(refs[0]!));
    }
    await runtime.patch(row.entity, id, data as Partial<KartaRecord>);
  }
}
