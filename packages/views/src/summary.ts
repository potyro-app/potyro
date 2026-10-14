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

import { t } from "@lingui/core/macro";
import { fmt } from "@potyro/i18n";
import type { Ctx, Resolved, SummaryValue } from "potyro";

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
    // The active language's digits and decimal mark, to at most two places; no grouping, as before.
    const rounded = fmt.number(v, { useGrouping: false, maximumFractionDigits: 2 });
    // The unit is the app's own word, after the number.
    return unit ? `${rounded} ${unit}` : rounded;
  }
  if (v instanceof Date) return fmt.date(v, { year: "numeric", month: "numeric", day: "numeric" });
  if (typeof v === "boolean") return v ? t`Yes` : t`No`;
  return String(v);
}

/**
 * The raw figure: a number for the declarative ops, whatever `value` returned otherwise, `null` for
 * an average or maximum of nothing. Throws when the figure cannot be computed. Stats tiles (#109)
 * use the number itself, to compare it with an earlier one.
 */
export async function figureValue(spec: SummaryValue, rows: readonly Resolved[], ctx: Ctx, callValue?: CallSummaryValue): Promise<unknown> {
  if (spec.value != null) {
    // `spec.value` is only a real function when the app runs trusted. Under the isolate the
    // definition carries the `__potyro_fn__` SENTINEL STRING here — the function stayed in the VM
    // — so calling it directly throws and the figure silently renders a dash. Routing through the
    // host makes both provenances take the same path (the `resolveBinding` pattern).
    if (callValue) return callValue(rows);
    if (typeof spec.value === "function") return spec.value([...rows], ctx);
    throw new Error("this summary's value function is not callable here");
  }

  if (spec.op === "count") return rows.length;

  const field = spec.field;
  if (!field || !spec.op) throw new Error("this summary declares no field to aggregate");

  const values = numbers(rows, field);
  // An empty set has no average or maximum. Zero would be a lie; a dash says "nothing here yet".
  if (values.length === 0) return spec.op === "sum" ? 0 : null;

  switch (spec.op) {
    case "sum":
      return values.reduce((n, v) => n + v, 0);
    case "avg":
      return values.reduce((n, v) => n + v, 0) / values.length;
    case "max":
      return Math.max(...values);
    default:
      throw new Error(`unknown summary op "${String(spec.op)}"`);
  }
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
    return { label: spec.label, text: formatFigure(await figureValue(spec, rows, ctx, callValue), unit) };
  } catch (e) {
    // Reported, not swallowed: the figure shows a dash and says why on hover.
    const reason = e instanceof Error ? e.message : String(e);
    console.warn(`[potyro] summary "${spec.label}" failed:`, e);
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
