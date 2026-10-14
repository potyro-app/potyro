import { resolveView, humanizeKey } from "potyro";
import type { PotyroRuntime } from "@potyro/runtime";
import type { View } from "potyro";
import { t } from "@lingui/core/macro";
import { fmt } from "@potyro/i18n";
import { formatDateRelative, type Precision } from "./dates.js";

/**
 * How a date reads where the field is not in hand — a list row, a badge, a table cell (#103).
 * A day-precision value is stored at local midnight, so a value with no time of day is a day and
 * never grows one; anything else keeps its clock.
 */
export function precisionOfValue(d: Date): Precision {
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0 ? "day" : "minute";
}

/** A date in a row or a badge: "today", "in 3 days", "3 Oct" — near dates in words (#103). */
export function formatDateValue(d: Date): string {
  return formatDateRelative(d, precisionOfValue(d));
}

/** Human-format a resolved value for display in built-in views. */
export function formatValue(v: unknown): string {
  if (v == null) return "–";
  if (v instanceof Date) return formatDateValue(v);
  // In the active language's digits and decimal mark; no grouping, as before.
  if (typeof v === "number")
    return Number.isInteger(v) ? fmt.number(v, { useGrouping: false }) : fmt.number(v, { useGrouping: false, minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (typeof v === "boolean") return v ? t`Yes` : t`No`;
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? "•" : String(x))).join(", ");
  if (typeof v === "object") return "…";
  return String(v);
}

export function toBadges(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (x instanceof Date ? formatDateValue(x) : String(x)));
  if (typeof v === "boolean") return v ? ["✓"] : [];
  if (v == null) return [];
  if (v instanceof Date) return [formatDateValue(v)];
  return [String(v)];
}

/** The view object for a page (typed loosely — declarative fields only guaranteed present). */
/** The view a page ref names — a layout item's for `page#index` (#105). */
export function getView(runtime: PotyroRuntime, pageRef: string): View {
  return resolveView(runtime.definition, pageRef);
}

/** The field an entity uses as its human label (relation pickers, list rows). */
export function displayFieldFor(runtime: PotyroRuntime, entity: string): string {
  const def = runtime.definition.entities[entity];
  if (!def) return "id";
  if (def.displayField) return def.displayField;
  if ("name" in def.fields) return "name";
  return Object.keys(def.fields)[0] ?? "id";
}

/** Humanize a field/computed key: "caloriesPerServing" → "Calories Per Serving". */
// Re-exported, not reimplemented — see `humanizeKey` in `potyro` for why. Imported as well as
// re-exported, because `fieldLabel` below calls it and `export … from` does not bring it into scope.
export { humanizeKey };

/** A readable label for a field/computed key on an entity. */
export function fieldLabel(runtime: PotyroRuntime, entity: string, key: string): string {
  return runtime.definition.entities[entity]?.fields[key]?.label ?? humanizeKey(key);
}
