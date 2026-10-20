// When to remind, and the event as a calendar file (.ics, RFC 5545) a phone's calendar opens.
// Plain functions, no ctx: test/calendar.test.ts holds them.

import { endsAt, toDate, type EventTimes } from "./dates.js";

// ---- reminders ----

/** The reminder choices, as records keep them. What each reads as is in the app's `labels`. */
export const REMIND = ["none", "at start", "1 hour before", "3 hours before", "1 day before", "1 week before"] as const;
export type Remind = (typeof REMIND)[number];
export const DEFAULT_REMIND: Remind = "1 day before";

// Hours count on the clock; days and weeks count on the calendar, so "a day before" 20:00 is 20:00 the
// day before even when the clocks change in between.
const OFFSET: Record<Exclude<Remind, "none">, { minutes?: number; days?: number }> = {
  "at start": { minutes: 0 },
  "1 hour before": { minutes: 60 },
  "3 hours before": { minutes: 180 },
  "1 day before": { days: 1 },
  "1 week before": { days: 7 },
};

/** An all-day event has no hour, so its reminders count back from 9:00 on its first day. */
export const ALL_DAY_HOUR = 9;

export interface RemindedEvent extends EventTimes {
  remind?: unknown;
}

/**
 * When to remind about an event: the chosen time before its start, or null — no reminder, no start,
 * an unknown choice, or an event already over (a reminder that can never be useful is not one; it
 * would only sit on the app's tile as "due" for ever).
 */
export function remindAt(e: RemindedEvent, now: Date): Date | null {
  const start = toDate(e.start);
  const choice = typeof e.remind === "string" ? e.remind : DEFAULT_REMIND;
  if (!start || choice === "none" || !(choice in OFFSET)) return null;
  const end = endsAt(e);
  if (end && end.getTime() <= now.getTime()) return null;
  const from = e.allDay ? new Date(start.getFullYear(), start.getMonth(), start.getDate(), ALL_DAY_HOUR) : start;
  const back = OFFSET[choice as Exclude<Remind, "none">];
  if (back.days) return new Date(from.getFullYear(), from.getMonth(), from.getDate() - back.days, from.getHours(), from.getMinutes());
  return new Date(from.getTime() - (back.minutes ?? 0) * 60_000);
}

// ---- .ics ----

export interface CalendarEvent {
  /** Stable for the record, so importing the file twice updates rather than duplicates. */
  uid: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  venue?: string | null;
  address?: string | null;
  description?: string | null;
  link?: string | null;
  /** When the calendar should remind, as worked out by `remindAt`. */
  alarm?: Date | null;
  /** The reminder's words. */
  alarmText?: string;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 20261120T190000Z — a UTC time, which needs no VTIMEZONE and means the same in every calendar. */
export const utcStamp = (d: Date): string =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/** 20261120 — a calendar day, as the device sees it. */
const dayStamp = (d: Date): string => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

/** TEXT as RFC 5545 §3.3.11 escapes it: backslash, semicolon, comma, and newlines as `\n`. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Bytes of one character in UTF-8 — by arithmetic, so it needs no TextEncoder in any runner. */
const utf8Length = (ch: string): number => {
  const c = ch.codePointAt(0) ?? 0;
  return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
};

/**
 * Fold a content line at 75 octets (§3.1): CRLF and one space before each continuation. Counted in
 * UTF-8 bytes and never inside a character, so "Łódź" survives a fold.
 */
export function foldLine(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = utf8Length(ch);
    if (bytes + n > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
      limit = 74; // the leading space of a continuation counts
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** A whole VCALENDAR with one VEVENT (and its VALARM), CRLF line endings, every line folded. */
export function buildIcs(e: CalendarEvent, now: Date): string {
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Potyro//Poster to Event 1.0//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT"];
  lines.push(`UID:${e.uid}`, `DTSTAMP:${utcStamp(now)}`);
  if (e.allDay) {
    // DTEND of an all-day event is the day AFTER its last day (§3.6.1).
    const last = e.end && e.end.getTime() > e.start.getTime() ? e.end : e.start;
    const after = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${dayStamp(e.start)}`, `DTEND;VALUE=DATE:${dayStamp(after)}`);
  } else {
    lines.push(`DTSTART:${utcStamp(e.start)}`);
    // No end on the poster: none in the file either. A calendar shows the start; inventing a length
    // here would put a made-up time in someone's diary.
    if (e.end && e.end.getTime() > e.start.getTime()) lines.push(`DTEND:${utcStamp(e.end)}`);
  }
  lines.push(`SUMMARY:${escapeText(e.title)}`);
  const where = [e.venue, e.address].filter((s): s is string => !!s && !!s.trim()).join(", ");
  if (where) lines.push(`LOCATION:${escapeText(where)}`);
  if (e.description?.trim()) lines.push(`DESCRIPTION:${escapeText(e.description.trim())}`);
  if (e.link) lines.push(`URL:${e.link}`);
  if (e.alarm) {
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(e.alarmText || e.title)}`, `TRIGGER;VALUE=DATE-TIME:${utcStamp(e.alarm)}`, "END:VALARM");
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** A file name for the event: its title in plain letters, or "event". */
export function icsName(title: string, start: Date): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48)
    .replace(/-+$/g, "");
  return `${slug || "event"}-${dayStamp(start)}.ics`;
}
