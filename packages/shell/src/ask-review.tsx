// Ask's review (#213): everything a model proposed, before any of it happens.
//
// Each record comes with how far what it says was confirmed by what was actually read, and starts
// approved or held back accordingly (ask-verdicts.ts) — the person decides. Two ways to look: cards,
// one record at a time with every value and where it was found; or a table per kind of record, for
// comparing many. A value its sources dispute is left out unless the person keeps it. Then the
// actions: what runs, with what, on which records. One button does all of it, and says how much.

import { useMemo, useState } from "react";
import { humanizeKey, type AppDefinition } from "karta";
import type { Review, ReviewAction, ReviewRow, ReviewTarget } from "./ask-apply.js";
import { defaultApproval, valuesToSave } from "./ask-verdicts.js";
import { titleOf, type LinkNames } from "./ask-review-parts.js";
import { EntityTable, RowCard, type RowState } from "./ask-review-layouts.js";

export interface AcceptedRun {
  entity: string;
  action: string;
  input?: Record<string, unknown>;
  target: ReviewTarget;
}

type Layout = "cards" | "table";
const LAYOUT_KEY = "karta:ask-review-layout";
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
  onAccept: (rows: ReviewRow[], runs: AcceptedRun[]) => void;
  onDiscard: () => void;
}) {
  const { rows, actions } = review;
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
  const decide = (row: ReviewRow, approved: boolean) => setDecided((m) => new Map(m).set(row.ref, approved));
  const keep = (row: ReviewRow, field: string) => setKept((m) => new Map(m).set(row.ref, toggled(new Set(keptOf(row)), field)));

  const approvedRows = rows.filter((r) => stateOf(r).approved);
  const approvedRefs = new Set(approvedRows.map((r) => r.ref));
  const runs: AcceptedRun[] = actions.flatMap((a, ai) =>
    a.targets
      .filter((t) => tickedRuns.has(targetKey(ai, t)) && (t.kind !== "new" || approvedRefs.has(t.ref)))
      .map((t) => ({ entity: a.entity, action: a.action, input: a.input, target: t })),
  );
  const nRows = approvedRows.length;
  const nRuns = runs.length;
  const verb = [nRows ? `Add ${nRows}` : "", nRuns ? `${nRows ? "run" : "Run"} ${nRuns}` : ""].filter(Boolean).join(" and ");
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
          disabled={!nRows && !nRuns}
          onClick={() => onAccept(approvedRows.map((r) => ({ ...r, values: valuesToSave(r, keptOf(r)) })), runs)}
        >
          {verb || "Nothing approved"}
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
