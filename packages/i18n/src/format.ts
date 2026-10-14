// Dates, numbers, relative times and lists in a given language — `Intl`, never concatenation.
//
// Every function takes the locale as an argument. The shell and views use the bound versions in
// `index.ts` (the active language); the host can call these directly when it formats on an app's
// behalf (#302), which is how formatting reaches the sealed box: QuickJS has no `Intl`, so an app
// there asks `ctx` and the host answers with these, outside the box.
//
// Formatters are cached per (locale, options): constructing an `Intl.DateTimeFormat` costs far more
// than using one, and a list view formats the same way hundreds of times.

import { intlLocale } from "./locale.js";

const cache = new Map<string, unknown>();
function cached<T>(kind: string, locale: string, options: object | undefined, make: () => T): T {
  const key = `${kind}|${locale}|${options ? JSON.stringify(options) : ""}`;
  let hit = cache.get(key) as T | undefined;
  if (!hit) {
    hit = make();
    cache.set(key, hit);
  }
  return hit;
}

export type DateInput = Date | number | string;
const toDate = (d: DateInput): Date => (d instanceof Date ? d : new Date(d));

export function formatDate(locale: string, value: DateInput, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "";
  const l = intlLocale(locale);
  return cached("date", l, options, () => new Intl.DateTimeFormat(l, options)).format(date);
}

export function formatNumber(locale: string, value: number, options?: Intl.NumberFormatOptions): string {
  const l = intlLocale(locale);
  return cached("number", l, options, () => new Intl.NumberFormat(l, options)).format(value);
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/**
 * "3 days ago", "in 2 hours", "yesterday" — the largest unit that fits, rounded. `numeric: "auto"`
 * by default, so a day either side is a word ("yesterday", "tomorrow") in languages that have one.
 */
export function formatRelativeTime(
  locale: string,
  value: DateInput,
  now: DateInput = Date.now(),
  options: Intl.RelativeTimeFormatOptions = { numeric: "auto" },
): string {
  const then = toDate(value).getTime();
  const at = toDate(now).getTime();
  if (Number.isNaN(then) || Number.isNaN(at)) return "";
  const secs = Math.round((then - at) / 1000);
  const abs = Math.abs(secs);
  const [unit, size] = UNITS.find(([, s]) => abs >= s) ?? ["second", 1];
  const l = intlLocale(locale);
  return cached("relative", l, options, () => new Intl.RelativeTimeFormat(l, options)).format(Math.round(secs / size), unit);
}

/** "a, b and c" — or "a, b oraz c", "a, b und c"… `type: "disjunction"` for "or". */
export function formatList(locale: string, items: readonly string[], options: Intl.ListFormatOptions = { type: "conjunction" }): string {
  const l = intlLocale(locale);
  return cached("list", l, options, () => new Intl.ListFormat(l, options)).format(items);
}
