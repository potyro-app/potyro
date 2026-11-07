// What changed, by whom, since you last looked (KA-36).
//
// Composed from the store's `editHistory` and `removals`, which read the CRDT log rather than any
// record kept on the side. So this is retroactive, unforgeable, and costs no storage — see
// `Store.editHistory`.
//
// It lives here rather than in the shell because turning the log into a sentence needs two things
// the runtime already holds: the app's DEFINITION (for labels, display fields, what is hidden) and
// `ctx` (for `me` and the people around, so "by" becomes a name instead of an account id).
//
// ## The unit is a record, not a field
//
// Nobody asks "which field writes happened". A form save is five writes, a colour swatch is a write
// per tap, a creation is a write per field — reported one by one they read as noise, and the first
// version did exactly that. What a person asks is "what happened": Ana ADDED Milk, Tom CHANGED
// Lasagna, you TICKED Bought on flowers, someone REMOVED the old list. So every write by one person
// to one record within a few minutes folds into one event, and the event is what is shown.
//
// ## Only what a person can see counts
//
// Nothing is asked of the app — an app shared with you is untrusted code and a generated one has no
// author to annotate anything — so the filter comes from structure it already declares: an entity
// marked `hidden` is its own bookkeeping, and so is a `hidden` field. An event with nothing visible
// in it is not an event.
//
// ## Deliberately not stored
//
// Nothing here writes. The watermark — "what had I seen?" — is the caller's business, because where
// it belongs is a product decision (local-only keeps it private and off the wire; synced would make
// unread follow you across devices). This module takes a `since` and answers.

import { fieldValueProblem, humanizeKey, word } from "potyro";
import type { AppDefinition, Field, Id, Person, PotyroRecord } from "potyro";
import { isGuestId, type FieldEdit, type Store } from "@potyro/store";
import { memberName } from "./people.js";

/** Writes by one person to one record closer together than this are one event. */
export const FOLD_WINDOW_MS = 5 * 60 * 1000;

/** How much of a record's name a line carries. */
const LABEL_MAX = 48;

export type ActivityKind = "added" | "changed" | "ticked" | "unticked" | "removed";

/** One thing that happened to one record, ready to show. */
export interface ActivityEvent {
  kind: ActivityKind;
  entity: string;
  recordId: Id;
  /** The record as a person would name it — its display field, resolved; the entity's name as a last resort. */
  label: string;
  /** What the record belongs to, named the same way: the first required relation's record. "" when none. */
  parent: string;
  /** For `ticked`/`unticked`: the box's label. */
  field?: string;
  /** Account id, straight from the signing session — not app data (KA-18). */
  by: string;
  /** The person's display name, "You" for yourself, or a short id for someone who has left. */
  byName: string;
  /** When the latest write of the event happened. */
  at: Date;
  /** One line, already assembled in English: "Ana added Milk to Weekly". The shell says it in the person's language. */
  text: string;
}

export interface ActivityDeps {
  store: Store;
  definition: AppDefinition;
  me?: Person;
  /** The space's members, read fresh. */
  members?: readonly { id: string; name: string }[];
  /** `ctx.people`: the members plus placeholder people, which `members` does not carry. */
  people?: readonly { id: string; name: string }[];
}

/**
 * Whether this store can answer at all.
 *
 * Only a CRDT store keeps history; `MemoryStore` and `SqliteStore` hold current values. Callers must
 * check, because "no activity" and "this store cannot tell you" are different facts and a UI that
 * conflates them shows a confidently empty screen.
 */
export function activitySupported(store: Store): boolean {
  return typeof store.editHistory === "function";
}

type EntityShape = { label?: unknown; displayField?: string; hidden?: boolean; fields?: Record<string, Field> };

function entityOf(definition: AppDefinition, entity: string): EntityShape | undefined {
  return definition.entities[entity] as EntityShape | undefined;
}

function wordsOf(v: unknown, definition: AppDefinition): string {
  return word(v as Parameters<typeof word>[0], undefined, definition);
}

function fieldLabel(definition: AppDefinition, entity: string, field: string): string {
  const declared = entityOf(definition, entity)?.fields?.[field] as { label?: unknown } | undefined;
  return wordsOf(declared?.label, definition) || humanizeKey(field);
}

/** Short, human, and never "[object Object]". */
function show(v: unknown): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) return v.toLocaleDateString();
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.map(show).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["name", "title", "label"]) if (typeof o[k] === "string") return o[k] as string;
    return "";
  }
  return String(v);
}

function clip(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > LABEL_MAX ? `${one.slice(0, LABEL_MAX - 1).trimEnd()}…` : one;
}

/** Did this write actually change anything? Values are JSON, so a structural compare is enough. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function idOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string") return (v as { id: string }).id;
  return null;
}

/** Does a `member` value name only people who have been in this space? Unknowable → yes. */
function namesSomeoneWhoWasHere(value: unknown, everyone: ReadonlySet<string>): boolean {
  if (!everyone.size || value == null) return true;
  const ids = (Array.isArray(value) ? value : [value]).map(idOf);
  // A guest (docs/04 §Guests) is not an account: the values gate has already kept out one never added.
  return ids.every((id) => typeof id === "string" && (everyone.has(id) || isGuestId(id)));
}

function sentence(e: Omit<ActivityEvent, "text">): string {
  const who = e.byName;
  switch (e.kind) {
    case "added":
      return e.parent ? `${who} added ${e.label} to ${e.parent}` : `${who} added ${e.label}`;
    case "removed":
      return e.parent ? `${who} removed ${e.label} from ${e.parent}` : `${who} removed ${e.label}`;
    case "ticked":
    case "unticked": {
      const on = e.parent ? `${e.label} in ${e.parent}` : e.label;
      return `${who} ${e.kind} ${e.field} on ${on}`;
    }
    default:
      return e.parent ? `${who} changed ${e.label} in ${e.parent}` : `${who} changed ${e.label}`;
  }
}

/** One person's run of writes to one record. */
interface Fold {
  by: string;
  start: number;
  end: number;
  fields: Map<string, { before: unknown; after: unknown }>;
}

/**
 * Edits grouped into events: consecutive writes by the same person closer together than the window
 * are one fold. A different person, or a pause, starts another.
 */
export function foldEdits(edits: readonly { field: string; before: unknown; after: unknown; by: string; at: Date }[]): Fold[] {
  const sorted = [...edits].sort((a, b) => a.at.getTime() - b.at.getTime());
  const open = new Map<string, Fold>();
  const folds: Fold[] = [];
  for (const e of sorted) {
    const t = e.at.getTime();
    const cur = open.get(e.by);
    if (cur && t - cur.end <= FOLD_WINDOW_MS) {
      cur.end = t;
      const had = cur.fields.get(e.field);
      cur.fields.set(e.field, { before: had ? had.before : e.before, after: e.after });
      continue;
    }
    const fold: Fold = { by: e.by, start: t, end: t, fields: new Map([[e.field, { before: e.before, after: e.after }]]) };
    open.set(e.by, fold);
    folds.push(fold);
  }
  return folds;
}

/**
 * Everything that happened after `since`, newest first.
 *
 * Two-stage on purpose. Records carry `updatedAt`, so the vast majority can be skipped without
 * touching their history at all; only the ones that actually moved are walked. The log grows with
 * every edit ever made and never shrinks (KA-30), so a feed that folded all of it would get slower
 * for as long as the app was used.
 */
export async function activitySince(deps: ActivityDeps, since?: Date, opts?: { limit?: number }): Promise<ActivityEvent[]> {
  const { store, definition } = deps;
  if (!store.editHistory) return [];
  const cutoff = since?.getTime() ?? 0;
  const names = new Namer(deps);
  const labels = new Labeller(deps, names);
  // Everyone who has ever been in the space (KA-19); empty = cannot say, so nothing is held back.
  const everyone = new Set(store.memberIds?.() ?? []);

  const events: ActivityEvent[] = [];
  for (const entity of Object.keys(definition.entities)) {
    const def = entityOf(definition, entity);
    if (!def || def.hidden) continue;
    const fields = def.fields ?? {};

    for (const row of await store.all(entity)) {
      // Cheap prefilter: a record whose own `updatedAt` predates the watermark cannot contain a
      // newer edit, so its history is never opened.
      if (cutoff && Date.parse(String(row.updatedAt ?? "")) <= cutoff) continue;
      // Fetched WITHOUT `since`, deliberately: whether a fold is the record's CREATION needs the
      // first write ever, and the previous value is what tells a rewrite from a change.
      const history = await store.editHistory(entity, row.id);
      const folds = foldEdits(visibleEdits(history, fields, everyone));
      if (!folds.length) continue;
      const firstAt = Math.min(...history.map((e) => e.at.getTime()));
      const firstBy = history.find((e) => e.at.getTime() === firstAt)?.by;
      for (const fold of folds) {
        if (fold.end <= cutoff) continue;
        const created = fold.by === firstBy && fold.start - firstAt <= FOLD_WINDOW_MS;
        events.push(await build(kindOf(fold, created, fields), entity, row, fold.by, new Date(fold.end), fold, definition, labels, names));
      }
    }

    for (const gone of (await store.removals?.(entity, since ? { since } : undefined)) ?? []) {
      if (gone.at.getTime() <= cutoff) continue;
      const row = gone.record ?? ({ id: gone.id, createdAt: "", updatedAt: "" } as PotyroRecord);
      events.push(await build("removed", entity, row, gone.by, gone.at, null, definition, labels, names));
    }
  }

  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  return opts?.limit ? events.slice(0, opts.limit) : events;
}

/** The edits a person could notice: declared, visible, fitting their field, and actually different. */
function visibleEdits(history: readonly FieldEdit[], fields: Record<string, Field>, everyone: ReadonlySet<string>) {
  const previous = new Map<string, unknown>();
  const out: { field: string; before: unknown; after: unknown; by: string; at: Date }[] = [];
  for (const edit of history) {
    const declared = fields[edit.field] as (Field & { hidden?: boolean }) | undefined;
    if (!declared || declared.hidden) continue;
    // A value that does not fit its field never took (KA-21): records show the last value that
    // did, so the feed must not announce the one that did not — nor use it as a "from".
    if (fieldValueProblem(declared, edit.value, "read") !== null) continue;
    if (declared.type === "member" && !namesSomeoneWhoWasHere(edit.value, everyone)) continue;
    const had = previous.has(edit.field);
    const before = previous.get(edit.field);
    previous.set(edit.field, edit.value);
    // Saving a form rewrites every field, so fields nobody touched arrive as edits.
    if (had && same(before, edit.value)) continue;
    out.push({ field: edit.field, before: had ? before : undefined, after: edit.value, by: edit.by, at: edit.at });
  }
  return out;
}

function kindOf(fold: Fold, created: boolean, fields: Record<string, Field>): ActivityKind {
  if (created) return "added";
  if (fold.fields.size === 1) {
    const [field, { after }] = [...fold.fields][0]!;
    if (fields[field]?.type === "boolean" && typeof after === "boolean") return after ? "ticked" : "unticked";
  }
  return "changed";
}

async function build(
  kind: ActivityKind,
  entity: string,
  row: PotyroRecord,
  by: string,
  at: Date,
  fold: Fold | null,
  definition: AppDefinition,
  labels: Labeller,
  names: Namer,
): Promise<ActivityEvent> {
  const field = fold && (kind === "ticked" || kind === "unticked") ? fieldLabel(definition, entity, [...fold.fields.keys()][0]!) : undefined;
  const partial: Omit<ActivityEvent, "text"> = {
    kind,
    entity,
    recordId: row.id,
    label: await labels.of(entity, row),
    parent: await labels.parentOf(entity, row),
    ...(field === undefined ? {} : { field }),
    by,
    byName: await names.of(by, entity, row.id),
    at,
  };
  return { ...partial, text: sentence(partial) };
}

/**
 * Account id → name. The space's members first, then `ctx.people` (placeholders), then — for an
 * id neither knows — the record's own group, which is where a document-link participant lives and
 * nowhere else (record-sharing.ts). A short id is the honest answer for someone who has left.
 */
class Namer {
  private readonly extra = new Map<string, string>();
  private readonly asked = new Set<string>();
  constructor(private readonly deps: ActivityDeps) {}

  async of(id: string, entity: string, recordId: Id): Promise<string> {
    const known = this.lookup(id);
    if (known) return known;
    const key = `${entity}:${recordId}`;
    if (this.deps.store.recordMembers && !this.asked.has(key)) {
      this.asked.add(key);
      try {
        for (const m of await this.deps.store.recordMembers(entity, recordId)) if (m.name) this.extra.set(m.id, m.name);
      } catch {
        // No group to read: the short id below is what there is.
      }
    }
    return this.lookup(id) ?? memberName(id, { me: this.deps.me });
  }

  /** A name without asking any record: for a value, not an author. */
  lookup(id: string): string | undefined {
    const { me, members, people } = this.deps;
    if (me && id === me.id) return "You";
    return members?.find((m) => m.id === id)?.name ?? people?.find((p) => p.id === id)?.name ?? this.extra.get(id);
  }
}

/** A record's name, resolved one level: a member names a person, a relation names its record. */
class Labeller {
  private readonly cache = new Map<string, string>();
  constructor(
    private readonly deps: ActivityDeps,
    private readonly names: Namer,
  ) {}

  async of(entity: string, row: RecordLike): Promise<string> {
    const def = entityOf(this.deps.definition, entity);
    const key = def?.displayField;
    const field = key ? def?.fields?.[key] : undefined;
    const value = key ? row[key] : undefined;
    const named = field ? await this.value(field, value, entity, String(row.id)) : "";
    return clip(named) || wordsOf(def?.label, this.deps.definition) || humanizeKey(entity);
  }

  /** The record this one belongs to: its first required relation, named — "" when there is none. */
  async parentOf(entity: string, row: RecordLike): Promise<string> {
    const def = entityOf(this.deps.definition, entity);
    for (const [key, field] of Object.entries(def?.fields ?? {})) {
      const f = field as Field & { required?: boolean; hidden?: boolean; to?: string; many?: boolean };
      if (f.type !== "relation" || !f.required || f.hidden || f.many) continue;
      if (!f.to || entityOf(this.deps.definition, f.to)?.hidden) continue;
      const id = idOf(row[key]);
      return id ? clip(await this.related(f.to, id)) : "";
    }
    return "";
  }

  private async value(field: Field, value: unknown, entity: string, recordId: string): Promise<string> {
    const f = field as Field & { to?: string };
    if (f.type === "member") {
      const ids = (Array.isArray(value) ? value : [value]).map(idOf).filter((id): id is string => id !== null);
      const names = await Promise.all(ids.map((id) => this.names.of(id, entity, recordId)));
      return names.join(", ");
    }
    if (f.type === "relation" && f.to) {
      const ids = (Array.isArray(value) ? value : [value]).map(idOf).filter((id): id is string => id !== null);
      const names = await Promise.all(ids.map((id) => this.related(f.to!, id)));
      return names.filter(Boolean).join(", ");
    }
    return show(value);
  }

  private async related(entity: string, id: string): Promise<string> {
    const key = `${entity}:${id}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    let name = "";
    try {
      const row = await this.deps.store.get(entity, id);
      if (row) {
        const def = entityOf(this.deps.definition, entity);
        const dk = def?.displayField;
        name = dk ? show(row[dk]) : "";
      }
    } catch {
      name = "";
    }
    this.cache.set(key, name);
    return name;
  }
}

type RecordLike = { id: Id; [field: string]: unknown };
