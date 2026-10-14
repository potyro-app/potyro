// Dates as people say them (#103): "Today, 12 Sep", "yesterday", "in 3 days", "Tue 15 Sep 2026".
// One place for the words, so a list, a record page and the picker agree — and so a day-precision
// field never shows a time it does not have.

import type { DateTimeField } from "potyro";
import { fmt } from "@potyro/i18n";

export type Precision = NonNullable<DateTimeField["precision"]>;

export const precisionOf = (field: Pick<DateTimeField, "precision"> | undefined): Precision => field?.precision ?? "day";

const DAY = 86_400_000;

/** Midnight at the start of `d`'s day, local time. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());

/** Whole days from today to `d` (negative in the past). */
export function daysFromToday(d: Date, now = new Date()): number {
  return Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / DAY);
}

export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// In the active language, read at call time so a language switch reformats (#299). `fmt` caches the
// formatters per language and options.
const SHORT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
const LONG: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" };
const TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
const short = (d: Date): string => fmt.date(d, SHORT);
const long = (d: Date): string => fmt.date(d, LONG);
const time = (d: Date): string => fmt.date(d, TIME);

/** A day either side of today, in words: `Intl.RelativeTimeFormat` with `numeric: "auto"`. */
const dayWord = (n: number): string => fmt.days(n);

/**
 * "today" / "yesterday" / "tomorrow" / "in 3 days" / "3 days ago", or null when it is not near —
 * each language's own words for these (#299).
 */
export function relativeDay(d: Date, now = new Date()): string | null {
  const n = daysFromToday(d, now);
  if (n < -6 || n > 6) return null;
  return dayWord(n);
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The value as the form's box shows it: "Today, 12 Sep", "Tue 15 Sep 2026", plus "· 18:30" for a minute field. */
export function formatDateForInput(d: Date, precision: Precision, now = new Date()): string {
  const rel = relativeDay(d, now);
  const sameYear = d.getFullYear() === now.getFullYear();
  const day = rel ? `${capital(rel)}, ${short(d)}` : sameYear ? `${long(d).replace(`, ${d.getFullYear()}`, "").replace(` ${d.getFullYear()}`, "")}` : long(d);
  return precision === "minute" ? `${day} · ${time(d)}` : day;
}

/** The value on a record page: absolute, with the time only for a minute field. */
export function formatDateAbsolute(d: Date, precision: Precision): string {
  return precision === "minute" ? `${long(d)}, ${time(d)}` : long(d);
}

/** The value in a list or a badge: relative when near, else the short absolute form. */
export function formatDateRelative(d: Date, precision: Precision, now = new Date()): string {
  const rel = relativeDay(d, now);
  const day = rel ?? (d.getFullYear() === now.getFullYear() ? short(d) : long(d));
  return precision === "minute" ? `${day} ${time(d)}` : day;
}

const pad = (n: number): string => String(n).padStart(2, "0");
export const toIsoDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toIsoTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * What someone typed into the box, as a day: `2026-09-12`, `12/9/2026`, `12.9.2026`, `12 sep`,
 * `sep 12`, or a word — today, tomorrow, yesterday. Null when it is none of those.
 */
export function parseTypedDay(text: string, now = new Date()): Date | null {
  const t = text.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!t) return null;
  // The English words always work; so do the active language's own ("dzisiaj", "morgen").
  for (const [n, word] of [[0, "today"], [1, "tomorrow"], [-1, "yesterday"]] as const) {
    if (t === word || t === dayWord(n).toLowerCase()) return addDays(startOfDay(now), n);
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return valid(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/.exec(t);
  if (m) {
    const y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    return valid(new Date(y, Number(m[2]) - 1, Number(m[1])));
  }
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = /^(\d{1,2}) ([a-z]{3,})(?: (\d{4}))?$/.exec(t) ?? /^([a-z]{3,}) (\d{1,2})(?: (\d{4}))?$/.exec(t);
  if (m) {
    const [a, b] = /^\d/.test(m[1]!) ? [m[1]!, m[2]!] : [m[2]!, m[1]!];
    const mi = months.indexOf(b.slice(0, 3));
    if (mi >= 0) return valid(new Date(m[3] ? Number(m[3]) : now.getFullYear(), mi, Number(a)));
  }
  return null;
}

function valid(d: Date): Date | null {
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Keep `d`'s day, take the time from `hhmm` ("18:30"); an empty time means midnight. */
export function withTime(d: Date, hhmm: string): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), m ? Number(m[1]) : 0, m ? Number(m[2]) : 0);
}
