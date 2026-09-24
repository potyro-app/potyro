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
import type { AggregateRow, Resolved } from "karta";
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
    });
  }
  return out;
}

export function AggregateView({ runtime, pageId, params }: BuiltinViewProps) {
  const { rows, loading } = runtime.usePageQuery(pageId, params);
  // Both may be functions of ctx (#133) — "Balances for the Lisbon trip".
  const title = useDynamicText(runtime, pageId, "title", "view", "");
  const emptyText = useDynamicText(runtime, pageId, "emptyText", "view", "Nothing to show yet.");

  const [derived, setDerived] = useState<AggregateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [runtime, pageId, rows, loading]);

  if (loading || derived === null) return <p className="k-muted">Loading…</p>;

  if (error) {
    return (
      <section className="k-aggregate" aria-labelledby="k-agg-h">
        {title ? <h2 id="k-agg-h" data-k-wording>{title}</h2> : null}
        <p className="k-aggregate-error" role="status">
          This screen could not be worked out: {error}
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
              <li key={row.id ?? `${row.label}-${j}`} className="k-aggregate-row" data-tone={row.tone}>
                <span className="k-aggregate-label">
                  {row.label}
                  {row.detail ? <small className="k-aggregate-detail">{row.detail}</small> : null}
                </span>
                {row.value != null ? <span className="k-aggregate-value">{String(row.value)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
