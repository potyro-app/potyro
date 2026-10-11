// What changed, by whom, since you last looked (KA-36).
//
// Composed from the store's `editHistory`, which reads the CRDT log rather than any record kept on
// the side. So this is retroactive, unforgeable, and costs no storage — see `Store.editHistory`.
//
// It lives here rather than in the shell because turning an edit into a sentence needs two things
// the runtime already holds: the app's DEFINITION (for field labels and the record's display field)
// and `ctx` (for `me` and the space's members, so "by" becomes a name instead of an account id).
//
// ## Deliberately not stored
//
// Nothing here writes. The watermark — "what had I seen?" — is the caller's business, because where
// it belongs is a product decision (local-only keeps it private and off the wire; synced would make
// unread follow you across devices). This module takes a `since` and answers.

import { fieldValueProblem, humanizeKey } from "potyro";
import type { AppDefinition, Id, Person } from "potyro";
import type { FieldEdit, Store } from "@potyro/store";
import { memberName } from "./people.js";

/** One field of one record changing, ready to show. */
export interface ActivityItem {
  entity: string;
  recordId: Id;
  /** The record as a person would name it — its display field, or its id as a last resort. */
  recordLabel: string;
  field: string;
  fieldLabel: string;
  /** Absent when this is the first value the field ever had. */
  from?: unknown;
  to: unknown;
  /** Account id, straight from the signing session — not app data (KA-18). */
  by: string;
  /** The member's display name, "You" for yourself, or a short id for someone who has left. */
  byName: string;
  at: Date;
  /** One line, already assembled: "Ana changed Quantity from 2 to 3 on Milk". */
  text: string;
}

export interface ActivityDeps {
  store: Store;
  definition: AppDefinition;
  me?: Person;
  members?: readonly { id: string; name: string }[];
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

function labelFor(definition: AppDefinition, entity: string, field: string): string {
  const declared = definition.entities[entity]?.fields?.[field] as { label?: string } | undefined;
  return declared?.label ?? humanizeKey(field);
}

/** Short, human, and never "[object Object]". */
function show(v: unknown): string {
  if (v == null || v === "") return "nothing";
  if (v instanceof Date) return v.toLocaleDateString();
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length ? v.map(show).join(", ") : "nothing";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Resolved people and relations both carry something nameable.
    for (const k of ["name", "title", "label"]) if (typeof o[k] === "string") return o[k] as string;
    return "something";
  }
  return String(v);
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

function sentence(item: Omit<ActivityItem, "text">): string {
  const who = item.byName;
  const on = item.recordLabel ? ` on ${item.recordLabel}` : "";
  if (item.from === undefined) return `${who} set ${item.fieldLabel} to ${show(item.to)}${on}`;
  return `${who} changed ${item.fieldLabel} from ${show(item.from)} to ${show(item.to)}${on}`;
}

/**
 * Everything that changed after `since`, newest first.
 *
 * Two-stage on purpose. Records carry `updatedAt`, so the vast majority can be skipped without
 * touching their history at all; only the ones that actually moved are walked. The log grows with
 * every edit ever made and never shrinks (KA-30), so a feed that folded all of it would get slower
 * for as long as the app was used.
 */
export async function activitySince(
  deps: ActivityDeps,
  since?: Date,
  opts?: { limit?: number },
): Promise<ActivityItem[]> {
  const { store, definition, me, members } = deps;
  if (!store.editHistory) return [];

  const cutoff = since?.getTime() ?? 0;
  const nameOf = (id: string): string => memberName(id, { me, members });

  const items: ActivityItem[] = [];
  // Everyone who has ever been in the space (KA-19); empty = cannot say, so nothing is held back.
  const everyone = new Set(store.memberIds?.() ?? []);

  for (const entity of Object.keys(definition.entities)) {
    const displayField = (definition.entities[entity] as { displayField?: string } | undefined)?.displayField;
    const rows = await store.all(entity);

    for (const row of rows) {
      // Cheap prefilter: a record whose own `updatedAt` predates the watermark cannot contain a
      // newer edit, so its history is never opened.
      if (cutoff && Date.parse(String(row.updatedAt ?? "")) <= cutoff) continue;

      // Fetched WITHOUT `since`, deliberately: the previous value is what makes "from 2 to 3"
      // possible, and windowing here would discard exactly the edit that supplies it. The prefilter
      // above is what keeps that affordable — only records that moved are read.
      const history = await store.editHistory(entity, row.id);
      const previous = new Map<string, unknown>();

      const fields = definition.entities[entity]?.fields ?? {};
      for (const edit of history) {
        // A value that does not fit its field never took (KA-21): records show the last value that
        // did, so the feed must not announce the one that did not — nor use it as a "from".
        const declared = fields[edit.field];
        if (declared && fieldValueProblem(declared, edit.value, "read") !== null) continue;
        if (declared?.type === "member" && !namesSomeoneWhoWasHere(edit.value, everyone)) continue;
        const had = previous.has(edit.field);
        const before = previous.get(edit.field);
        previous.set(edit.field, edit.value);

        if (edit.at.getTime() <= cutoff) continue;
        // Saving a form rewrites every field, so fields nobody touched arrive as edits. "Ana changed
        // Name from Milk to Milk" is noise that would swamp the real change sitting next to it.
        if (had && same(before, edit.value)) continue;

        items.push(build(entity, row.id, displayField, row, edit, had ? before : undefined, nameOf, definition));
      }
    }
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return opts?.limit ? items.slice(0, opts.limit) : items;
}

function build(
  entity: string,
  recordId: Id,
  displayField: string | undefined,
  row: Record<string, unknown>,
  edit: FieldEdit,
  from: unknown,
  nameOf: (id: string) => string,
  definition: AppDefinition,
): ActivityItem {
  const partial: Omit<ActivityItem, "text"> = {
    entity,
    recordId,
    recordLabel: displayField ? show(row[displayField]) : "",
    field: edit.field,
    fieldLabel: labelFor(definition, entity, edit.field),
    ...(from === undefined ? {} : { from }),
    to: edit.value,
    by: edit.by,
    byName: nameOf(edit.by),
    at: edit.at,
  };
  return { ...partial, text: sentence(partial) };
}

/** Does a `member` value name only people who have been in this space? Unknowable → yes. */
function namesSomeoneWhoWasHere(value: unknown, everyone: ReadonlySet<string>): boolean {
  if (!everyone.size || value == null) return true;
  const ids = (Array.isArray(value) ? value : [value]).map((v) => (typeof v === "string" ? v : (v as { id?: unknown } | null)?.id));
  return ids.every((id) => typeof id === "string" && everyone.has(id));
}
