// Ask's review (#213): everything a model proposed, before any of it happens.
//
// Each record comes with how far what it says was confirmed by what was actually read, and starts
// approved or held back accordingly (ask-verdicts.ts) — the person decides. Two ways to look: cards,
// one record at a time with every value and where it was found; or a table per kind of record, for
// comparing many. A value its sources dispute is left out unless the person keeps it. Then the
// changes to records the person has, each field as it is now and as it would be; then the actions:
// what runs, with what, on which records. One button does all of it, and says how much.

import { useMemo, useState } from "react";
import { humanizeKey, type AppDefinition as SourceDefinition, type Localized } from "potyro";
/** The definition as the person reads it — `runtime.definition`, localized (#302). */
type AppDefinition = Localized<SourceDefinition>;
import { editApproval, type Review, type ReviewAction, type ReviewEdit, type ReviewRow, type ReviewTarget } from "./ask-apply.js";
import { defaultApproval, valuesToSave } from "./ask-verdicts.js";
import { titleOf, type LinkNames } from "./ask-review-parts.js";
import { EntityTable, RowCard, type RowState } from "./ask-review-layouts.js";
import { EditCard, type EditState } from "./ask-review-edits.js";

export interface AcceptedRun {
  entity: string;
  action: string;
  input?: Record<string, unknown>;
  target: ReviewTarget;
}

/** A change the person approved, on one of their records: only the values they kept. */
export interface AcceptedEdit {
  entity: string;
  id: string;
  set: Record<string, unknown>;
}

type Layout = "cards" | "table";
const LAYOUT_KEY = "potyro:ask-review-layout";
function savedLayout(): Layout {
  try {
    return globalThis.localStorage?.getItem(LAYOUT_KEY) === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
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
  onAccept: (rows: ReviewRow[], runs: AcceptedRun[], edits: AcceptedEdit[]) => void;
  onDiscard: () => void;
}) {
  const { rows, actions, edits } = review;
  const [layout, setLayout] = useState<Layout>(savedLayout);
  /** The person's own decisions, by ref; everything else follows its default. */
  const [decided, setDecided] = useState<Map<string, boolean>>(new Map());
  const [kept, setKept] = useState<Map<string, Set<string>>>(new Map());
  const [tickedRuns, setTickedRuns] = useState(() => new Set(actions.flatMap((a, ai) => a.targets.filter((t) => t.ticked).map((t) => targetKey(ai, t)))));
  const linkNames: LinkNames = useMemo(() => ({ refs: new Map(rows.map((r) => [r.ref, titleOf(def, r)])), records: names }), [def, rows, names]);
  const groups = useMemo(() => {
    const by = new Map<string, ReviewRow[]>();
    for (const r of rows) by.set(r.entity, [...(by.get(r.entity) ?? []), r]);
    return [...by];
  }, [rows]);

  const keptOf = (row: ReviewRow): ReadonlySet<string> => kept.get(row.ref) ?? new Set();
  const stateOf = (row: ReviewRow): RowState => {
    const d = defaultApproval(def, row, keptOf(row));
    return { approved: decided.get(row.ref) ?? d.approved, ...(d.reason ? { reason: d.reason } : {}), kept: keptOf(row) };
  };
  const decide = (row: { ref: string }, approved: boolean) => setDecided((m) => new Map(m).set(row.ref, approved));
  const keep = (row: { ref: string }, field: string) => setKept((m) => new Map(m).set(row.ref, toggled(new Set(kept.get(row.ref) ?? []), field)));

  const [editTicks, setEditTicks] = useState<Map<string, Set<string>>>(() => new Map(edits.map((e) => [e.ref, new Set(e.targets.filter((t) => t.ticked).map((t) => t.id))])));
  const editState = (edit: ReviewEdit): EditState => {
    const ticked = editTicks.get(edit.ref) ?? new Set<string>();
    const k = kept.get(edit.ref) ?? new Set<string>();
    const d = editApproval(edit, k, ticked);
    return { approved: (decided.get(edit.ref) ?? d.approved) && ticked.size > 0, ...(d.reason ? { reason: d.reason } : {}), kept: k, ticked };
  };
  const tick = (edit: ReviewEdit, id: string) => setEditTicks((m) => new Map(m).set(edit.ref, toggled(new Set(m.get(edit.ref) ?? []), id)));

  const approvedRows = rows.filter((r) => stateOf(r).approved);
  const approvedRefs = new Set(approvedRows.map((r) => r.ref));
  const runs: AcceptedRun[] = actions.flatMap((a, ai) =>
    a.targets
      .filter((t) => tickedRuns.has(targetKey(ai, t)) && (t.kind !== "new" || approvedRefs.has(t.ref)))
      .map((t) => ({ entity: a.entity, action: a.action, input: a.input, target: t })),
  );
  const accepted: AcceptedEdit[] = edits.flatMap((e) => {
    const st = editState(e);
    if (!st.approved) return [];
    const set = valuesToSave({ ...e, values: e.set, duplicate: false }, st.kept);
    return Object.keys(set).length ? e.targets.filter((t) => st.ticked.has(t.id)).map((t) => ({ entity: e.entity, id: t.id, set })) : [];
  });
  const nRows = approvedRows.length;
  const nRuns = runs.length;
  const nEdits = accepted.length;
  const parts = [nRows ? `add ${nRows}` : "", nEdits ? `change ${nEdits}` : "", nRuns ? `run ${nRuns}` : ""].filter(Boolean);
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
  const verb = joined.charAt(0).toUpperCase() + joined.slice(1);
  const held = rows.length - nRows;

  const pickLayout = (l: Layout): void => {
    setLayout(l);
    try {
      globalThis.localStorage?.setItem(LAYOUT_KEY, l);
    } catch {
      // remembered for this review only
    }
  };

  return (
    <>
      {review.summary ? <p className="k-ask-summary">{review.summary}</p> : null}
      {rows.length ? (
        <div className="k-ask-review-bar">
          <span className="k-ask-review-count">
            {nRows} of {rows.length} approved{held ? ` · ${held} held back` : ""}
          </span>
          <span className="k-ask-layout" role="group" aria-label="Show as">
            <button type="button" aria-pressed={layout === "cards"} onClick={() => pickLayout("cards")}>
              Cards
            </button>
            <button type="button" aria-pressed={layout === "table"} onClick={() => pickLayout("table")}>
              Table
            </button>
          </span>
        </div>
      ) : null}
      <div className="k-ask-review">
        {groups.map(([entity, list]) => (
          <section key={entity} className="k-ask-group" aria-label={def.entities[entity]?.label ?? humanizeKey(entity)}>
            <h3 className="k-ask-group-head">
              {def.entities[entity]?.icon ? <span aria-hidden>{def.entities[entity]!.icon} </span> : null}
              {def.entities[entity]?.label ?? humanizeKey(entity)}
              <span className="k-ask-group-count">{list.length}</span>
            </h3>
            {layout === "table" ? (
              <EntityTable def={def} entity={entity} rows={list} stateOf={stateOf} names={linkNames} onDecide={decide} onKeep={keep} />
            ) : (
              <ul className="k-ask-cards">
                {list.map((row) => (
                  <RowCard key={row.ref} def={def} row={row} state={stateOf(row)} names={linkNames} onDecide={(a) => decide(row, a)} onKeep={(k) => keep(row, k)} />
                ))}
              </ul>
            )}
          </section>
        ))}
        {edits.length ? (
          <section className="k-ask-group" aria-label="Changes">
            <h3 className="k-ask-group-head">
              Changes to your records <span className="k-ask-group-count">{edits.length}</span>
            </h3>
            <ul className="k-ask-cards">
              {edits.map((e) => (
                <EditCard
                  key={e.ref}
                  def={def}
                  edit={e}
                  state={editState(e)}
                  names={linkNames}
                  onDecide={(a) => decide(e, a)}
                  onKeep={(k) => keep(e, k)}
                  onTick={(id) => tick(e, id)}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {actions.length ? (
          <section className="k-ask-group" aria-label="Actions">
            <h3 className="k-ask-group-head">
              Actions <span className="k-ask-group-count">{actions.length}</span>
            </h3>
            <ul className="k-ask-rows">
              {actions.map((a, ai) => (
                <ActionItem key={ai} action={a} ai={ai} rowTicked={(ref) => approvedRefs.has(ref)} ticked={tickedRuns} onToggle={(k) => setTickedRuns((s) => toggled(s, k))} />
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
          disabled={!nRows && !nRuns && !nEdits}
          onClick={() => onAccept(approvedRows.map((r) => ({ ...r, values: valuesToSave(r, keptOf(r)) })), runs, accepted)}
        >
          {verb || "Nothing approved"}
        </button>
      </footer>
    </>
  );
}

export function doneText(created: number, ran: number, changed = 0): string {
  const text = [created ? `added ${plural(created, "record", "records")}` : "", changed ? `changed ${plural(changed, "record", "records")}` : "", ran ? `ran ${plural(ran, "action", "actions")}` : ""]
    .filter(Boolean)
    .join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
