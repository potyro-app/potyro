// The `aggregate` built-in: a screen derived from the WHOLE set (KA-24).
//
// ## Why this view exists at all
//
// `computed` is per-record and every other built-in renders rows, so a number or table folded out of
// *all* the records had nowhere declarative to live. "Who owes whom", "what's still to buy", "hours
// per project" — the MAIN screen of most shared apps — therefore had to be a custom view. And custom
// views are trusted-only (docs/05), so an app that arrived from a friend rendered its whole point as
// a blank rectangle, and the only way out was promoting a stranger's code to ambient authority.
// That is the capitulation the isolate exists to prevent, which made this bug upstream of the entire
// sharing and sync story (ADR 0001 step 0, spike F1/F2).
//
// ## Why declarative rather than sandboxed UI
//
// The isolate bridge is one string-in/string-out JSON function. A function that returns a *value*
// crosses it natively — that is already how `computed`, `filter`, `sort`, `binding` and `summary`
// work. A React component would need a serializable-VDOM plus an event-callback protocol that does
// not exist. So the fold stays ordinary TypeScript (the arithmetic, the rounding, the debt
// simplification — no DSL, hard rule 1) and only the *rendering* is declarative. Genuinely bespoke
// UI still wants DOM-sandboxed custom views one day; this covers the class that was blocking.
//
// The fold runs through the host, so it behaves identically trusted and untrusted. That is the
// entire point — verified in a browser by `e2e/aggregate-sandbox.spec.ts`.

import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { actionInfo, type AggregateRow, type Resolved } from "potyro";
import { getView, humanizeKey } from "./format.js";
import { useWriteTick } from "./write-tick.js";
import type { BuiltinViewProps } from "./types.js";
import { useDynamicText } from "./dynamic.js";

/** Coerce whatever the app returned into rows we can render, dropping anything unusable. */
function toRows(value: unknown): AggregateRow[] {
  if (!Array.isArray(value)) return [];
  const out: AggregateRow[] = [];
  for (const raw of value) {
    if (raw == null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.label !== "string") continue; // a row with nothing to name is not a row
    out.push({
      id: typeof r.id === "string" ? r.id : undefined,
      label: r.label,
      value: typeof r.value === "string" || typeof r.value === "number" ? r.value : undefined,
      detail: typeof r.detail === "string" ? r.detail : undefined,
      tone: r.tone === "positive" || r.tone === "negative" ? r.tone : "neutral",
      group: typeof r.group === "string" ? r.group : undefined,
      ...targetsOf(r),
    });
  }
  return out;
}

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Where a row leads, kept only when it is whole: a record, a page, an action on a record. */
function targetsOf(r: Record<string, unknown>): Pick<AggregateRow, "record" | "open" | "action"> {
  const out: Pick<AggregateRow, "record" | "open" | "action"> = {};
  const rec = r.record as Record<string, unknown> | undefined;
  if (rec && str(rec.entity) && (str(rec.id) || typeof rec.id === "number")) out.record = { entity: rec.entity, id: String(rec.id) };
  const open = r.open as Record<string, unknown> | undefined;
  if (open && str(open.page)) {
    const params: Record<string, string> = {};
    if (open.params && typeof open.params === "object") for (const [k, v] of Object.entries(open.params)) if (v != null) params[k] = String(v);
    out.open = { page: open.page, params };
  }
  const act = r.action as Record<string, unknown> | undefined;
  if (act && str(act.entity) && (str(act.id) || typeof act.id === "number") && str(act.key)) {
    // The row's own values for the action ("Tom pays you €12"): plain values only, nothing to run.
    const input = act.input && typeof act.input === "object" && !Array.isArray(act.input)
      ? Object.fromEntries(Object.entries(act.input as Record<string, unknown>).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)) as [string, string | number | boolean][])
      : undefined;
    out.action = { entity: act.entity, id: String(act.id), key: act.key, ...(str(act.label) ? { label: act.label } : {}), ...(input ? { input } : {}) };
  }
  return out;
}

export function AggregateView({ runtime, pageId, params, navigate }: BuiltinViewProps) {
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  // Both may be functions of ctx (#133) — "Balances for the Lisbon trip".
  const { t } = useLingui();
  const title = useDynamicText(runtime, pageId, "title", "view", "");
  const emptyText = useDynamicText(runtime, pageId, "emptyText", "view", t`Nothing to show yet.`);

  const [derived, setDerived] = useState<AggregateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The fold may read other kinds of record (Split's payments): a write to them re-runs it too.
  const tick = useWriteTick(runtime, (getView(runtime, pageId) as { entity?: string } | undefined)?.entity);

  useEffect(() => {
    if (loading) return;
    let alive = true;
    void (async () => {
      try {
        const value = await runtime.core.app.callAggregate(pageId, [...rows] as Resolved[], runtime.ctx);
        if (alive) {
          setDerived(toRows(value));
          setError(null);
        }
      } catch (e) {
        // A fold is app code. One bad aggregate must say so rather than blanking the screen —
        // "nothing here" and "this crashed" are different facts and the user deserves to know which.
        if (alive) {
          setDerived([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      alive = false;
    };
    // `rows` identity changes per query pass, which is exactly when the fold must re-run.
  }, [runtime, pageId, rows, loading, tick]);

  if (loading || derived === null) return <p className="k-muted">
        <Trans>Loading…</Trans>
      </p>;

  if (error) {
    return (
      <section className="k-aggregate" aria-labelledby="k-agg-h">
        {title ? <h2 id="k-agg-h" data-k-wording>{title}</h2> : null}
        <p className="k-aggregate-error" role="status">
          <Trans>This screen could not be worked out: {error}</Trans>
        </p>
      </section>
    );
  }

  if (!derived.length) {
    return (
      <section className="k-aggregate" aria-labelledby="k-agg-h">
        {title ? <h2 id="k-agg-h" data-k-wording>{title}</h2> : null}
        <p className="k-muted" data-k-wording>{emptyText}</p>
      </section>
    );
  }

  // Consecutive rows sharing a `group` render under one heading — two sections ("balances", then
  // "settle up") is the natural shape of this screen, and it needs no second view type.
  const sections: Array<{ group?: string; rows: AggregateRow[] }> = [];
  for (const row of derived) {
    const last = sections[sections.length - 1];
    if (last && last.group === row.group) last.rows.push(row);
    else sections.push({ group: row.group, rows: [row] });
  }

  return (
    <section className="k-aggregate" aria-labelledby={title ? "k-agg-h" : undefined}>
      {title ? <h2 id="k-agg-h" data-k-wording>{title}</h2> : null}
      {sections.map((section, i) => (
        <div key={section.group ?? i} className="k-aggregate-section">
          {section.group ? <h3 className="k-aggregate-group">{section.group}</h3> : null}
          <ul className="k-aggregate-rows">
            {section.rows.map((row, j) => (
              <AggregateRowItem key={row.id ?? `${row.label}-${j}`} row={row} runtime={runtime} navigate={navigate} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * One row. With a `record` or `open` the whole row opens it (its label is the button, so the keyboard
 * reaches it); with an `action`, a small button at its end runs that action on that record.
 */
function AggregateRowItem({ row, runtime, navigate }: { row: AggregateRow; runtime: BuiltinViewProps["runtime"]; navigate: BuiltinViewProps["navigate"] }) {
  const go = rowTarget(row, runtime, navigate);
  const action = row.action;
  const actionLabel = action ? action.label ?? actionInfo(runtime.definition.entities[action.entity], action.key)?.label ?? humanizeKey(action.key) : "";
  return (
    <li className="k-aggregate-row" data-tone={row.tone} data-clickable={go ? "true" : undefined} onClick={go}>
      <span className="k-aggregate-label">
        {go ? (
          <button type="button" className="k-aggregate-open" onClick={(e) => { e.stopPropagation(); go(); }}>
            {row.label}
          </button>
        ) : (
          row.label
        )}
        {row.detail ? <small className="k-aggregate-detail">{row.detail}</small> : null}
      </span>
      {row.value != null ? <span className="k-aggregate-value">{String(row.value)}</span> : null}
      {action ? (
        <button
          type="button"
          className="k-action k-row-action"
          onClick={(e) => {
            e.stopPropagation();
            void runtime.runAction(action.entity, action.key, action.id, action.input);
          }}
        >
          {actionLabel}
        </button>
      ) : null}
      {go ? (
        <span className="k-row-chevron" aria-hidden>
          ›
        </span>
      ) : null}
    </li>
  );
}

/** What tapping a row does: open its page, or its record's page (the entity's detail page). */
function rowTarget(row: AggregateRow, runtime: BuiltinViewProps["runtime"], navigate: BuiltinViewProps["navigate"]): (() => void) | undefined {
  if (row.open) {
    const { page, params } = row.open;
    return () => navigate(page, params ?? {});
  }
  if (row.record) {
    const { entity, id } = row.record;
    const page = runtime.definition.pages.find((p) => (p.view as { type?: string; entity?: string }).type === "detail" && (p.view as { entity?: string }).entity === entity);
    if (!page) return undefined;
    const param = (page.view as { param?: string }).param ?? "id";
    return () => navigate(page.id, { [param]: id });
  }
  return undefined;
}
