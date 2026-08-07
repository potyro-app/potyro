// Computing a page's summary figures — a monthly total, a head count, a running average.
//
// This is the one shape the built-in views could not express: `computed` is per-record and every
// view renders rows, so a number derived from the WHOLE set had nowhere to go. Three of the
// generator's own 24 corpus prompts ask for exactly that (`expenses`, `subscriptions`, `guests`).
//
// The figures are computed over the page's FILTERED rows, so toggling a filter chip changes them.
// A total that disagreed with the rows underneath it would read as a bug.
//
// Kept separate from the component so the arithmetic is testable without rendering, and so a
// `value` function throwing can be contained here rather than taking the page down with it.

import type { Ctx, Resolved, SummaryValue } from "karta";

/** Invoke a figure's `value` function through the host, whichever runner the app is in. */
export type CallSummaryValue = (rows: readonly Resolved[]) => Promise<unknown>;

export interface SummaryFigure {
  label: string;
  /** Ready to render. `null` when the figure could not be computed. */
  text: string | null;
  /** Why it could not be computed — shown as a title, never as a crash. */
  error?: string;
}

/** Sum/avg/max only make sense over numbers; anything else in the column is skipped. */
function numbers(rows: readonly Resolved[], field: string): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const v = row[field] as unknown;
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Render a computed figure.
 *
 * A `value` function may return a string when it wants full control of the formatting; numbers are
 * rendered here so the common case needs no ceremony. Long decimals are the usual result of summing
 * money, so they are trimmed rather than shown to 15 places.
 */
export function formatFigure(v: unknown, unit?: string): string {
  if (v == null) return "–";
  if (typeof v === "string") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "–";
    const rounded = Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
    return unit ? `${rounded} ${unit}` : rounded;
  }
  if (v instanceof Date) return v.toLocaleDateString();
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/**
 * Compute one figure over `rows`.
 *
 * Never throws: a `value` function is app code, and one bad summary must not blank the page it sits
 * above. A failure is reported in the figure itself.
 */
export async function computeFigure(
  spec: SummaryValue,
  rows: readonly Resolved[],
  ctx: Ctx,
  unit?: string,
  callValue?: CallSummaryValue,
): Promise<SummaryFigure> {
  try {
    if (spec.value != null) {
      // `spec.value` is only a real function when the app runs trusted. Under the isolate the
      // definition carries the `__karta_fn__` SENTINEL STRING here — the function stayed in the VM
      // — so calling it directly throws and the figure silently renders a dash. Routing through the
      // host makes both provenances take the same path (the `resolveBinding` pattern).
      if (callValue) return { label: spec.label, text: formatFigure(await callValue(rows), unit) };
      if (typeof spec.value === "function") {
        return { label: spec.label, text: formatFigure(await spec.value([...rows], ctx), unit) };
      }
      return { label: spec.label, text: null, error: "this summary's value function is not callable here" };
    }

    if (spec.op === "count") return { label: spec.label, text: String(rows.length) };

    const field = spec.field;
    if (!field || !spec.op) return { label: spec.label, text: null, error: "this summary declares no field to aggregate" };

    const values = numbers(rows, field);
    // An empty set has no average or maximum. Zero would be a lie; a dash says "nothing here yet".
    if (values.length === 0) return { label: spec.label, text: spec.op === "sum" ? formatFigure(0, unit) : "–" };

    switch (spec.op) {
      case "sum":
        return { label: spec.label, text: formatFigure(values.reduce((n, v) => n + v, 0), unit) };
      case "avg":
        return { label: spec.label, text: formatFigure(values.reduce((n, v) => n + v, 0) / values.length, unit) };
      case "max":
        return { label: spec.label, text: formatFigure(Math.max(...values), unit) };
      default:
        return { label: spec.label, text: null, error: `unknown summary op "${String(spec.op)}"` };
    }
  } catch (e) {
    // Reported, not swallowed: the figure shows a dash and says why on hover.
    const reason = e instanceof Error ? e.message : String(e);
    console.warn(`[karta] summary "${spec.label}" failed:`, e);
    return { label: spec.label, text: null, error: reason };
  }
}

export async function computeSummary(
  specs: readonly SummaryValue[],
  rows: readonly Resolved[],
  ctx: Ctx,
  unitFor?: (field: string) => string | undefined,
  callValue?: (index: number, rows: readonly Resolved[]) => Promise<unknown>,
): Promise<SummaryFigure[]> {
  return Promise.all(
    specs.map((spec, i) =>
      computeFigure(
        spec,
        rows,
        ctx,
        spec.field ? unitFor?.(spec.field) : undefined,
        callValue ? (rs) => callValue(i, rs) : undefined,
      ),
    ),
  );
}
