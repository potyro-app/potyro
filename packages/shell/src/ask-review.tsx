// Ask's review (#213): everything a model proposed, before any of it happens.
//
// New records, grouped by entity, each with the values that matter; the ones the person already has
// come unticked. Then the actions: what runs, with what, on which records. A run on a record this
// proposal adds follows that row's tick. A run on the person's own records lists the records the name
// found on this device: an exact name ticked, a partial one offered unticked, none said plainly.
// One button does all of it, and says how much.

import { useMemo, useState } from "react";
import { humanizeKey, type AppDefinition, type Field } from "karta";
import type { Review, ReviewAction, ReviewRow, ReviewTarget } from "./ask-apply.js";

export interface AcceptedRun {
  entity: string;
  action: string;
  input?: Record<string, unknown>;
  target: ReviewTarget;
}

/** What a proposed row is called: its display field, else its first text value. */
function titleOf(def: AppDefinition, row: ReviewRow): string {
  const entity = def.entities[row.entity];
  const by = entity?.displayField;
  const v = by ? row.values[by] : Object.values(row.values).find((x) => typeof x === "string");
  return typeof v === "string" && v.trim() ? v : entity?.label ?? row.entity;
}

/** A value as the person reads it. A link shows the name of what it points at: a proposed row
 *  ("@lx") by its title, one of the person's records by the name it has on this device. */
function showValue(field: Field, value: unknown, refs: Map<string, string>, names: Map<string, string>): string | null {
  if (value == null || value === "") return null;
  switch (field.type) {
    case "geo": {
      const g = value as { lat: number; lng: number; label?: string };
      return g.label ? `📍 ${g.label}` : `📍 ${g.lat.toFixed(4)}, ${g.lng.toFixed(4)}`;
    }
    case "relation": {
      const list = Array.isArray(value) ? value : [value];
      const name = (v: unknown) => (typeof v === "string" ? (v.startsWith("@") ? refs.get(v.slice(1)) : names.get(v)) : undefined) ?? "";
      return list.map(name).filter(Boolean).join(", ") || null;
    }
    case "list":
      return Array.isArray(value) ? `${value.length} ${field.label ?? "item"}${value.length === 1 ? "" : "s"}` : null;
    case "tags":
      return Array.isArray(value) ? value.join(", ") : null;
    case "boolean":
      return value ? field.label ?? "yes" : null;
    case "number":
      return `${String(value)}${field.unit ? ` ${field.unit}` : ""}`;
    default:
      return typeof value === "string" || typeof value === "number" ? String(value) : null;
  }
}

/** A few of the row's other values, so the person can judge it without opening anything. */
function detailsOf(def: AppDefinition, row: ReviewRow, refs: Map<string, string>, names: Map<string, string>): string[] {
  const entity = def.entities[row.entity];
  if (!entity) return [];
  const out: string[] = [];
  for (const [key, field] of Object.entries(entity.fields)) {
    if (key === entity.displayField || out.length >= 4) continue;
    const shown = showValue(field, row.values[key], refs, names);
    if (shown) out.push(field.type === "text" && shown.length > 90 ? `${shown.slice(0, 88)}…` : shown);
  }
  return out;
}

const toggled = (set: Set<string>, key: string): Set<string> => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

const targetKey = (ai: number, t: ReviewTarget): string => `${ai}:${t.kind === "new" ? `@${t.ref}` : t.id}`;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function ActionItem({
  action,
  ai,
  rowTicked,
  ticked,
  onToggle,
}: {
  action: ReviewAction;
  ai: number;
  rowTicked: (ref: string) => boolean;
  ticked: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <li className="k-ask-action">
      <div className="k-ask-action-head">
        <span className="k-ask-action-name">{action.label}</span>
        {action.inputText ? <span className="k-ask-row-details">{action.inputText}</span> : null}
      </div>
      {action.notes.map((n, i) => (
        <p key={i} className="k-ask-note">
          {n}
        </p>
      ))}
      {action.targets.length ? (
        <ul className="k-ask-targets">
          {action.targets.map((t) => {
            const key = targetKey(ai, t);
            const waitsOnRow = t.kind === "new" && !rowTicked(t.ref);
            const on = ticked.has(key) && !waitsOnRow;
            return (
              <li key={key} className="k-ask-target" data-ticked={on || undefined}>
                <label>
                  <input type="checkbox" checked={on} disabled={waitsOnRow} onChange={() => onToggle(key)} />
                  <span>
                    {t.name}
                    {t.kind === "new" ? <span className="k-ask-target-new"> new</span> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

export function ReviewPanel({
  def,
  review,
  names,
  onAccept,
  onDiscard,
}: {
  def: AppDefinition;
  review: Review;
  /** The person's records the review mentions, id → name, for showing links. */
  names: Map<string, string>;
  onAccept: (rows: ReviewRow[], runs: AcceptedRun[]) => void;
  onDiscard: () => void;
}) {
  const { rows, actions } = review;
  const [tickedRows, setTickedRows] = useState(() => new Set(rows.filter((r) => !r.duplicate).map((r) => r.ref)));
  const [tickedRuns, setTickedRuns] = useState(() => new Set(actions.flatMap((a, ai) => a.targets.filter((t) => t.ticked).map((t) => targetKey(ai, t)))));
  const refs = useMemo(() => new Map(rows.map((r) => [r.ref, titleOf(def, r)])), [def, rows]);
  const groups = useMemo(() => {
    const by = new Map<string, ReviewRow[]>();
    for (const r of rows) by.set(r.entity, [...(by.get(r.entity) ?? []), r]);
    return [...by];
  }, [rows]);

  const runs: AcceptedRun[] = actions.flatMap((a, ai) =>
    a.targets
      .filter((t) => tickedRuns.has(targetKey(ai, t)) && (t.kind !== "new" || tickedRows.has(t.ref)))
      .map((t) => ({ entity: a.entity, action: a.action, input: a.input, target: t })),
  );
  const nRows = tickedRows.size;
  const nRuns = runs.length;
  const verb = [nRows ? `Add ${nRows}` : "", nRuns ? `${nRows ? "run" : "Run"} ${nRuns}` : ""].filter(Boolean).join(" and ");

  return (
    <>
      {review.summary ? <p className="k-ask-summary">{review.summary}</p> : null}
      <div className="k-ask-review">
        {groups.map(([entity, list]) => (
          <section key={entity} className="k-ask-group" aria-label={def.entities[entity]?.label ?? humanizeKey(entity)}>
            <h3 className="k-ask-group-head">
              {def.entities[entity]?.icon ? <span aria-hidden>{def.entities[entity]!.icon} </span> : null}
              {def.entities[entity]?.label ?? humanizeKey(entity)}
              <span className="k-ask-group-count">{list.length}</span>
            </h3>
            <ul className="k-ask-rows">
              {list.map((row) => {
                const details = detailsOf(def, row, refs, names);
                return (
                  <li key={row.ref} className="k-ask-row" data-duplicate={row.duplicate || undefined} data-ticked={tickedRows.has(row.ref) || undefined}>
                    <label>
                      <input type="checkbox" checked={tickedRows.has(row.ref)} onChange={() => setTickedRows((s) => toggled(s, row.ref))} />
                      <span className="k-ask-row-body">
                        <span className="k-ask-row-title">{titleOf(def, row)}</span>
                        {row.duplicate ? <span className="k-ask-row-dup">already in your app</span> : null}
                        {details.length ? <span className="k-ask-row-details">{details.join(" · ")}</span> : null}
                        {row.notes.map((n, i) => (
                          <span key={i} className="k-ask-note">
                            {n}
                          </span>
                        ))}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {actions.length ? (
          <section className="k-ask-group" aria-label="Actions">
            <h3 className="k-ask-group-head">
              Actions <span className="k-ask-group-count">{actions.length}</span>
            </h3>
            <ul className="k-ask-rows">
              {actions.map((a, ai) => (
                <ActionItem key={ai} action={a} ai={ai} rowTicked={(ref) => tickedRows.has(ref)} ticked={tickedRuns} onToggle={(k) => setTickedRuns((s) => toggled(s, k))} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <footer className="k-ask-actions">
        <button type="button" className="k-add" onClick={onDiscard}>
          Discard
        </button>
        <button
          type="button"
          className="k-add k-primary-action"
          disabled={!nRows && !nRuns}
          onClick={() => onAccept(rows.filter((r) => tickedRows.has(r.ref)), runs)}
        >
          {verb || "Nothing ticked"}
        </button>
      </footer>
    </>
  );
}

export function doneText(created: number, ran: number): string {
  return [created ? `Added ${plural(created, "record", "records")}` : "", ran ? `ran ${plural(ran, "action", "actions")}` : ""]
    .filter(Boolean)
    .join(", ")
    .replace(/^ran/, "Ran")
    .concat(".");
}
