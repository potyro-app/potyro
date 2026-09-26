// Changes Ask proposes to records the person already has (#213). Each shows which record, what each
// field holds now next to what it would hold, and how far the new values were confirmed. A value its
// sources dispute is left out unless the person keeps it, as for a new record. When the name matched
// more than one record, or none exactly, the person ticks the ones they meant.

import type { AppDefinition } from "karta";
import { editAsReviewRow, type ReviewEdit } from "./ask-apply.js";
import { Decision, fieldLabel, showValue, Sources, TrustBadge, ValueCell, type LinkNames } from "./ask-review-parts.js";

export interface EditState {
  approved: boolean;
  reason?: string;
  kept: ReadonlySet<string>;
  ticked: ReadonlySet<string>;
}

export function EditCard({
  def,
  edit,
  state,
  names,
  onDecide,
  onKeep,
  onTick,
}: {
  def: AppDefinition;
  edit: ReviewEdit;
  state: EditState;
  names: LinkNames;
  onDecide: (approved: boolean) => void;
  onKeep: (field: string) => void;
  onTick: (id: string) => void;
}) {
  const fields = def.entities[edit.entity]?.fields ?? {};
  const chosen = edit.targets.filter((t) => state.ticked.has(t.id));
  const title = chosen.length ? chosen.map((t) => t.name).join(", ") : edit.match;
  // What it holds now, from the one record being changed; with several, each may differ, so none is shown.
  const before = chosen.length === 1 ? chosen[0]!.before : edit.targets.length === 1 ? edit.targets[0]!.before : null;
  const row = editAsReviewRow(edit);
  const pick = edit.targets.length > 1 || edit.targets.some((t) => !t.ticked);
  const notes = edit.notes.filter((n) => n !== state.reason);
  const nowText = (before: Record<string, unknown>): string => {
    const shown = Object.keys(edit.set)
      .map((k) => (fields[k] ? `${fieldLabel(k, fields[k]!)} ${showValue(fields[k]!, before[k], names) ?? "—"}` : ""))
      .filter(Boolean)
      .join(" · ");
    return shown ? ` · ${shown}` : "";
  };

  return (
    <li className="k-ask-card k-ask-edit" data-approved={state.approved || undefined}>
      <div className="k-ask-card-head">
        <Decision approved={state.approved} onChange={onDecide} name={title} />
        <span className="k-ask-card-title">{title}</span>
        {!edit.targets.length ? null : edit.trust?.status === "general" ? (
          <span className="k-ask-badge" data-tone="neutral">
            Change
          </span>
        ) : (
          <TrustBadge row={row} />
        )}
      </div>
      {!state.approved && state.reason ? <p className="k-ask-held">{state.reason}</p> : null}
      {pick ? (
        <ul className="k-ask-targets" aria-label={`Which ${def.entities[edit.entity]?.label?.toLowerCase() ?? edit.entity}`}>
          {edit.targets.map((t) => (
            <li key={t.id} className="k-ask-target" data-ticked={state.ticked.has(t.id) || undefined}>
              <label>
                <input type="checkbox" checked={state.ticked.has(t.id)} onChange={() => onTick(t.id)} />
                <span>
                  {t.name}
                  {/* Records by the same name told apart by what the change would replace. */}
                  <span className="k-ask-target-now">{nowText(t.before)}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="k-ask-fields k-ask-changes">
        {Object.keys(edit.set).map((k) => {
          const f = fields[k];
          if (!f) return null;
          const was = before ? showValue(f, before[k], names) : null;
          return (
            <div key={k} className="k-ask-field-row">
              <dt>{fieldLabel(k, f)}</dt>
              <dd>
                {before ? (
                  <>
                    <span className="k-ask-before">{was ?? "—"}</span>
                    <span className="k-ask-arrow" aria-label="becomes">
                      →
                    </span>
                  </>
                ) : null}
                <ValueCell field={f} value={edit.set[k]} issue={edit.trust?.fieldIssues?.[k]} kept={state.kept.has(k)} onKeep={() => onKeep(k)} names={names} />
              </dd>
            </div>
          );
        })}
      </dl>
      {notes.length ? (
        <ul className="k-ask-row-notes">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
      {/* Their own request is already named by the badge; quoting it on every card says nothing new. */}
      {edit.trust?.sources.some((s) => !s.url.startsWith("karta:request")) ? <Sources row={row} /> : null}
    </li>
  );
}
