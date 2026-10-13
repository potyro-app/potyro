// The two ways to look over what Ask proposed (#213): cards, one record at a time with everything it
// says and where it was found; or a table per kind of record, every field a column, for comparing
// many at once. Both show the same things and take the same decisions.

import { useState } from "react";
import type { AppDefinition as SourceDefinition, Localized } from "potyro";
/** The definition as the person reads it — `runtime.definition`, localized (#302). */
type AppDefinition = Localized<SourceDefinition>;
import type { ReviewRow } from "./ask-apply.js";
import { Decision, fieldLabel, shownFields, Sources, showValue, titleOf, TrustBadge, ValueCell, type LinkNames } from "./ask-review-parts.js";

export interface RowState {
  approved: boolean;
  /** Why it was held back, when it was by default. */
  reason?: string;
  kept: ReadonlySet<string>;
}

export interface RowProps {
  def: AppDefinition;
  row: ReviewRow;
  state: RowState;
  names: LinkNames;
  onDecide: (approved: boolean) => void;
  onKeep: (field: string) => void;
}

/** The row's notes and the trust issues that are not about one field. */
function Notes({ row }: { row: ReviewRow }) {
  const lines = [...row.notes, ...(row.trust?.issues ?? []).filter((i) => !/double-checked/.test(i))];
  if (!lines.length) return null;
  return (
    <ul className="k-ask-row-notes">
      {lines.map((n, i) => (
        <li key={i}>{n}</li>
      ))}
    </ul>
  );
}

export function RowCard({ def, row, state, names, onDecide, onKeep }: RowProps) {
  const [open, setOpen] = useState(false);
  const title = titleOf(def, row);
  const by = def.entities[row.entity]?.displayField;
  const fields = shownFields(def, row).filter(([k]) => k !== by);
  const summary = fields
    .slice(0, 3)
    .map(([k, f]) => showValue(f, row.values[k], names))
    .filter((v): v is string => Boolean(v))
    .map((v) => v.split("\n")[0]!)
    .join(" · ");
  const flagged = Object.keys(row.trust?.fieldIssues ?? {}).length;

  return (
    <li className="k-ask-card" data-approved={state.approved || undefined}>
      <div className="k-ask-card-head">
        <Decision approved={state.approved} onChange={onDecide} name={title} />
        <span className="k-ask-card-title">{title}</span>
        <TrustBadge row={row} />
      </div>
      {!state.approved && state.reason ? <p className="k-ask-held">{state.reason}</p> : null}
      {summary ? <p className="k-ask-card-summary">{summary}</p> : null}
      <Notes row={row} />
      <button type="button" className="k-ask-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide details" : `All details${row.trust?.sources.length ? " and sources" : ""}${flagged ? ` · ${flagged} to check` : ""}`}
      </button>
      {open ? (
        <div className="k-ask-card-body">
          <dl className="k-ask-fields">
            {shownFields(def, row).map(([k, f]) => (
              <div key={k} className="k-ask-field-row">
                <dt>{fieldLabel(k, f)}</dt>
                <dd>
                  <ValueCell field={f} value={row.values[k]} issue={row.trust?.fieldIssues?.[k]} kept={state.kept.has(k)} onKeep={() => onKeep(k)} names={names} />
                </dd>
              </div>
            ))}
          </dl>
          <Sources row={row} />
        </div>
      ) : null}
    </li>
  );
}

/** One kind of record, every field a column. A row opens to its sources and notes. */
export function EntityTable({
  def,
  entity,
  rows,
  stateOf,
  names,
  onDecide,
  onKeep,
}: {
  def: AppDefinition;
  entity: string;
  rows: ReviewRow[];
  stateOf: (row: ReviewRow) => RowState;
  names: LinkNames;
  onDecide: (row: ReviewRow, approved: boolean) => void;
  onKeep: (row: ReviewRow, field: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const e = def.entities[entity];
  const columns = Object.entries(e?.fields ?? {}).filter(([k, f]) => !f.hidden && rows.some((r) => r.values[k] != null || r.trust?.fieldIssues?.[k]));
  return (
    <div className="k-ask-table-wrap">
      <table className="k-ask-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="k-sr">Decision</span>
            </th>
            <th scope="col">Confirmed</th>
            {columns.map(([k, f]) => (
              <th key={k} scope="col">
                {fieldLabel(k, f)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const state = stateOf(row);
            const title = titleOf(def, row);
            return [
              <tr key={row.ref} data-approved={state.approved || undefined}>
                <td>
                  <Decision approved={state.approved} onChange={(a) => onDecide(row, a)} name={title} />
                </td>
                <td>
                  <button type="button" className="k-ask-badge-btn" aria-expanded={open === row.ref} title="Sources and notes" onClick={() => setOpen((o) => (o === row.ref ? null : row.ref))}>
                    <TrustBadge row={row} />
                  </button>
                </td>
                {columns.map(([k, f]) => (
                  <td key={k}>
                    <ValueCell field={f} value={row.values[k]} issue={row.trust?.fieldIssues?.[k]} kept={state.kept.has(k)} onKeep={() => onKeep(row, k)} names={names} />
                  </td>
                ))}
              </tr>,
              open === row.ref ? (
                <tr key={`${row.ref}-more`} className="k-ask-table-more">
                  <td colSpan={columns.length + 2}>
                    {!state.approved && state.reason ? <p className="k-ask-held">{state.reason}</p> : null}
                    <Sources row={row} />
                    <Notes row={row} />
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
