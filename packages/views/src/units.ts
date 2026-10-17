// One place decides how a number reads with its unit (#99): the form's suffix, the detail value
// and a list cell all say "7 days" the same way, and a duration in minutes or hours reads as
// "1 h 30 min" rather than "90".

import type { DurationField, NumberField } from "potyro";

export function formatNumber(value: unknown, integer = false): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value ?? "");
  return integer ? String(Math.round(value)) : String(Number(value.toFixed(4)));
}

/** A number with its unit after it, or the bare number when the field has none. */
export function formatWithUnit(value: unknown, field: Pick<NumberField, "unit" | "integer">): string {
  const n = formatNumber(value, field.integer);
  return field.unit && n !== "" ? `${n} ${field.unit}` : n;
}

/** A duration in the field's base unit, read the way a person says it: "6 min", "1 h 15 min",
 *  "45 s" — never "360 s" for six minutes. Under a minute it keeps its seconds (or milliseconds). */
export function formatDuration(value: unknown, field: Pick<DurationField, "unit">): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value ?? "");
  const unit = field.unit ?? "ms";
  const seconds = unit === "s" ? value : unit === "ms" ? value / 1000 : undefined;
  if (seconds !== undefined && seconds >= 60) {
    const whole = Math.round(seconds);
    const rest = whole % 60;
    // A step of "1 min 30 s" keeps its half minute; whole minutes read as minutes.
    if (rest && whole < 3600) return `${Math.floor(whole / 60)} min ${rest} s`;
    return formatDuration(Math.round(whole / 60), { unit: "min" });
  }
  if (unit === "min" || unit === "h") {
    const minutes = Math.round(unit === "h" ? value * 60 : value);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h && m) return `${h} h ${m} min`;
    if (h) return `${h} h`;
    return `${m} min`;
  }
  return `${formatNumber(value)} ${unit}`;
}
