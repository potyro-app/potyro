// A plan before a change that is not small (#75).
//
// A request to the Studio used to get one of two things: a change, saved, or a failure. A change that
// drops a field a dozen records hold something in was saved like one that adds a button, and the
// person found out by opening the app. Asking the model for a plan first would be a promise, and a
// second call; so the Studio does the opposite. The change is MADE, it passes every gate, and then —
// only when it is not small — it is shown before it is saved: the sentences its card would say, what
// it does to the records already there, and Go. Go keeps exactly what was made; no model is asked
// again. The person approves the real result, not a description of one.
//
// What counts as not small is the host's to decide, from the app before and after and the records it
// holds — never the model's opinion of its own change:
//
//   - a kind of record, or a field, that HAS RECORDS is removed or renamed (its key is gone; with a
//     migration that renames it the records are kept, and the plan says so);
//   - a field changes kind (text to number);
//   - a page is removed;
//   - more than PLAN_MAX_PARTS pages and kinds of record are added or changed at once.
//
// A new app is never planned: there is nothing to lose, and it is just made.
//
// Pure but for the records, which the caller reads (`RowsOf`) through the store the Studio already has
// open for the app. Definitions in, a plan or null out.

import { plural } from "@lingui/core/macro";
import { humanizeKey, type AppDefinition } from "potyro";
import type { AppLock, PackagedFile } from "@potyro/store";
import { quoted, type Described } from "./studio-summary.js";
import type { StudioLibraries } from "./studio-libraries.js";
import type { PlatformAsk } from "./studio-chat.js";

/** Pages and kinds of record a change may add or change at once before it is shown first. */
export const PLAN_MAX_PARTS = 4;

/** Why a change is shown before it is saved. `records`: how many hold something it touches. */
export type PlanTrigger =
  | { kind: "entity-removed"; entity: string; label: string; records: number; renamedTo?: string }
  | { kind: "field-removed"; entity: string; entityLabel: string; field: string; label: string; records: number; renamedTo?: string }
  | { kind: "field-kind"; entity: string; entityLabel: string; field: string; label: string; from: string; to: string; records: number }
  | { kind: "page-removed"; page: string }
  | { kind: "many-parts"; parts: number };

export interface Plan {
  triggers: PlanTrigger[];
  /** What the change does to the records already there, a sentence each; empty when it touches none. */
  consequences: string[];
}

type Row = Readonly<Record<string, unknown>>;
/** The records of one kind, as the app's store holds them. */
export type RowsOf = (entity: string) => Promise<readonly Row[]>;

/** The app after the change, with the migrations it declares: a rename they carry keeps the records. */
export type PlannedApp = Described & Pick<AppDefinition, "migrations">;

type Entities = Described["entities"];
const fieldsOf = (e: Entities[string] | undefined): Record<string, { type?: string; label?: string }> => (e?.fields ?? {}) as Record<string, { type?: string; label?: string }>;
const entityLabel = (key: string, e: Entities[string] | undefined): string => (typeof e?.label === "string" && e.label) || humanizeKey(key);
const fieldLabel = (key: string, f: { label?: string } | undefined): string => (typeof f?.label === "string" && f.label) || humanizeKey(key);

/** Something a person would miss: not nothing, not an empty text, not an empty list. */
const holds = (value: unknown): boolean => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);

/** Everything declared about a part but its functions: a difference is a change. */
const shapeOf = (part: unknown): string => JSON.stringify(part) ?? "";

/** Where a migration of the changed app moves a kind of record, or one of its fields. */
function renames(app: PlannedApp): { entity: (key: string) => string | undefined; field: (entity: string, key: string) => string | undefined } {
  const steps = (app.migrations ?? []).flatMap((m) => m.steps ?? []);
  return {
    entity: (key) => steps.flatMap((s) => ("op" in s && s.op === "renameEntity" && s.from === key ? [s.to] : []))[0],
    field: (entity, key) => steps.flatMap((s) => ("op" in s && s.op === "renameField" && s.entity === entity && s.from === key ? [s.to] : []))[0],
  };
}

/** How many pages and kinds of record the change adds or changes. */
export function partsTouched(before: Described, after: Described): number {
  const pages = after.pages.filter((p) => {
    const old = before.pages.find((b) => b.id === p.id);
    return !old || shapeOf(old) !== shapeOf(p);
  }).length;
  const kinds = Object.entries(after.entities).filter(([key, e]) => !(key in before.entities) || shapeOf(before.entities[key]) !== shapeOf(e)).length;
  return pages + kinds;
}

/**
 * Why this change is shown before it is saved; empty when it is small and is simply kept. Records are
 * read only for the kinds the change takes something from.
 */
export async function planTriggers(before: Described, after: PlannedApp, rowsOf: RowsOf): Promise<PlanTrigger[]> {
  const out: PlanTrigger[] = [];
  const moved = renames(after);
  const read = async (entity: string): Promise<readonly Row[]> => rowsOf(entity).catch(() => []);

  for (const [key, was] of Object.entries(before.entities)) {
    const now = after.entities[key];
    if (!now) {
      const records = (await read(key)).length;
      const renamedTo = moved.entity(key);
      if (records > 0) out.push({ kind: "entity-removed", entity: key, label: entityLabel(key, was), records, ...(renamedTo ? { renamedTo: entityLabel(renamedTo, after.entities[renamedTo]) } : {}) });
      continue;
    }
    const [had, has] = [fieldsOf(was), fieldsOf(now)];
    const gone = Object.keys(had).filter((f) => !(f in has));
    const rekinded = Object.keys(had).filter((f) => f in has && had[f]!.type !== has[f]!.type);
    if (!gone.length && !rekinded.length) continue;
    const rows = await read(key);
    const holding = (field: string): number => rows.filter((r) => holds(r[field])).length;
    for (const field of gone) {
      const records = holding(field);
      if (records === 0) continue;
      const to = moved.field(key, field);
      out.push({ kind: "field-removed", entity: key, entityLabel: entityLabel(key, now), field, label: fieldLabel(field, had[field]), records, ...(to ? { renamedTo: fieldLabel(to, has[to]) } : {}) });
    }
    for (const field of rekinded) {
      out.push({
        kind: "field-kind",
        entity: key,
        entityLabel: entityLabel(key, now),
        field,
        label: fieldLabel(field, has[field]),
        from: String(had[field]!.type),
        to: String(has[field]!.type),
        records: holding(field),
      });
    }
  }

  for (const page of before.pages) if (!after.pages.some((p) => p.id === page.id)) out.push({ kind: "page-removed", page: page.id });

  const parts = partsTouched(before, after);
  if (parts > PLAN_MAX_PARTS) out.push({ kind: "many-parts", parts });
  return out;
}

/** What the change does to the records already there, in plain words — one sentence for each thing it touches. */
export function planConsequences(triggers: readonly PlanTrigger[]): string[] {
  return triggers.flatMap((trigger): string[] => {
    const n = "records" in trigger ? trigger.records : 0;
    if (trigger.kind === "entity-removed") {
      const kind = quoted(trigger.label);
      if (trigger.renamedTo) {
        const to = quoted(trigger.renamedTo);
        return [plural(n, { one: `# record of ${kind} is kept, as ${to}.`, other: `# records of ${kind} are kept, as ${to}.` })];
      }
      return [plural(n, { one: `# record of ${kind} will no longer be in the app.`, other: `# records of ${kind} will no longer be in the app.` })];
    }
    if (trigger.kind === "field-removed") {
      const kind = quoted(trigger.entityLabel);
      const field = quoted(trigger.label);
      if (trigger.renamedTo) {
        const to = quoted(trigger.renamedTo);
        return [plural(n, { one: `What # record of ${kind} has in ${field} is kept, under ${to}.`, other: `What # records of ${kind} have in ${field} is kept, under ${to}.` })];
      }
      return [plural(n, { one: `# record of ${kind} will lose what is in ${field}.`, other: `# records of ${kind} will lose what is in ${field}.` })];
    }
    if (trigger.kind === "field-kind" && n > 0) {
      const kind = quoted(trigger.entityLabel);
      const field = quoted(trigger.label);
      return [
        plural(n, {
          one: `# record of ${kind} has something in ${field}, which becomes a different kind of field: it may not read the same.`,
          other: `# records of ${kind} have something in ${field}, which becomes a different kind of field: it may not read the same.`,
        }),
      ];
    }
    return [];
  });
}

/** The plan for a change to an app that exists, or null when the change is small and is simply kept. */
export async function planFor(before: Described, after: PlannedApp, rowsOf: RowsOf): Promise<Plan | null> {
  const triggers = await planTriggers(before, after, rowsOf);
  return triggers.length ? { triggers, consequences: planConsequences(triggers) } : null;
}

// ---- The change a plan is about, held until the person says Go -----------------------------------

/**
 * A change that was made, passed every gate, and waits for Go. It lives only in the open Studio: a
 * candidate is a whole app (and its libraries' bytes), which does not belong in the conversation that
 * follows the person across their devices. Closed before Go, it is gone — the conversation keeps what
 * was said of it and says it was not saved (studio-thread-view.tsx).
 */
export interface Planned<Built = unknown> {
  source: string;
  /** The app built from it, as it was checked: Go shows this one, and builds nothing again. */
  built: Built;
  summary: string;
  /** What was asked, for the version's note. */
  note: string;
  consequences: string[];
  libraries: StudioLibraries | null;
  /** The modules it edited (#448): every module's text, and the files and lock entries they make. */
  own?: { texts: Record<string, string>; code: { lock: AppLock; files: PackagedFile[] } };
  /** What rides on its card when it is kept: a request to the Potyro team, the guesses it made, what it did not do. */
  extra: { platform?: PlatformAsk; assumed?: string[]; notDone?: string[] };
}

/** Go: exactly what was made is what is saved — the same source, the same words, nothing asked of a model. */
export function goWith<Built>(plan: Planned<Built>): Pick<Planned<Built>, "source" | "built" | "summary" | "note" | "libraries" | "own" | "extra"> {
  return { source: plan.source, built: plan.built, summary: plan.summary, note: plan.note, libraries: plan.libraries, ...(plan.own ? { own: plan.own } : {}), extra: plan.extra };
}

/**
 * What the model is told when the person, looking at a plan, asks for something different: the app in
 * front of it already has the change, which is not saved, and only what they now say is to change.
 * English, like every word the model is given; the person's own words stay as they wrote them.
 */
export function refineInstruction(said: string, plan: Pick<Planned, "note">): string {
  const earlier = plan.note.replace(/\s+/g, " ").trim();
  return `${said}\n\n(The app above already has what they asked for just before — "${earlier}" — as a version they have seen and not kept yet. Change only what they now say; keep the rest of it.)`;
}
