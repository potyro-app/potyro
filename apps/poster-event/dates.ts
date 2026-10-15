// From what a poster says to when an event happens: plain functions, no ctx, no I/O, so the tests
// can hold every rule (test/dates.test.ts).
//
// The model reads the poster; it does not get the last word on the calendar. It copies the date as
// printed (`dateText`), gives its own reading of it (`date`), and says whether a year was printed.
// Everything after that — the year a "Fri 20 Nov" falls in, "8pm" against "20h30", doors against
// start, an end past midnight, a timezone printed beside the time — is worked out here, the same way
// every time, because a model that is right nine times in ten is wrong once a week for someone.

/** One event as the model reads it off a poster (the `events` items of POSTER in read.ts). */
export interface PosterReading {
  title: string;
  /** The date exactly as printed: "Fri 20 Nov", "12–14.06", "Sábado, 21 de novembro". */
  dateText: string | null;
  /** The model's reading of the first day, "YYYY-MM-DD". */
  date: string | null;
  /** The last day of an event over several days, "YYYY-MM-DD". */
  endDate: string | null;
  /** Whether the poster prints a year. When it does not, the year is decided here. */
  yearPrinted: boolean;
  /** As printed or as the model normalised it: "20:00", "8pm", "20h30", "20:00–23:00". */
  start: string | null;
  end: string | null;
  doors: string | null;
  /** Only when the poster prints one: "CET", "UTC+2", "ET". */
  timezone: string | null;
  venue: string | null;
  address: string | null;
  price: string | null;
  link: string | null;
  description: string | null;
}

/** What the confirm form opens with. `start` is null when no date could be found. */
// A type, not an interface, so it reads as a record (an index signature) where one is wanted.
export type Draft = {
  title: string;
  start: Date | null;
  end: Date | null;
  /** No time on the poster: the event is the whole day (or days). */
  allDay: boolean;
  /** "19:00" — when doors open, kept apart from the start. */
  doors: string | null;
  venue: string | null;
  address: string | null;
  price: string | null;
  link: string | null;
  description: string | null;
};

export interface Clock {
  h: number;
  m: number;
}

interface Day {
  y: number;
  m: number; // 1–12
  d: number;
}

const DAY_MS = 86_400_000;

// ---- times ----

const CLOCK = /(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?|uhr|h\b)?/gi;

/**
 * A time of day from how posters write it: "20:00", "20.00", "20h", "20h30", "8pm", "8:30 p.m.",
 * "20 Uhr", "noon", "midnight". The first time in the text, so a range gives its start. Null when
 * there is none — a bare number with no separator and no am/pm/h is a count or a price, not a time.
 */
export function parseClock(text: string | null | undefined): Clock | null {
  if (!text) return null;
  const s = text.toLowerCase();
  if (/\bnoon\b|\bmidday\b|\bmittag\b|\bmediod[ií]a\b|\bpo[łl]udnie\b|\bmezzogiorno\b|\bmeio-dia\b/.test(s)) return { h: 12, m: 0 };
  if (/\bmidnight\b|\bmitternacht\b|\bmedianoche\b|\bp[óo][łl]noc\b|\bmezzanotte\b|\bmeia-noite\b/.test(s)) return { h: 0, m: 0 };
  for (const m of s.matchAll(CLOCK)) {
    let h = Number(m[1]);
    const min = m[2] === undefined ? 0 : Number(m[2]);
    const suffix = (m[3] ?? "").replace(/[\s.]/g, "");
    if (m[2] === undefined && !suffix) continue;
    if (suffix === "pm" && h < 12) h += 12;
    if (suffix === "am" && h === 12) h = 0;
    if (h === 24 && min === 0) h = 0;
    if (h > 23 || min > 59) continue;
    return { h, m: min };
  }
  return null;
}

/** "20:00–23:00", "8pm till late", "19:00 - 01:00": the two ends; `end` null when there is one time. */
export function parseClockRange(text: string | null | undefined): { start: Clock | null; end: Clock | null } {
  if (!text) return { start: null, end: null };
  const parts = text.split(/\s+(?:to|till|until|bis|hasta|a|do|alle|às|até)\s+|\s*[–—-]\s*/i);
  const rest = parts.slice(1).join(" ");
  let end = parts.length > 1 ? parseClock(rest) : null;
  // "8–11pm": a bare start takes the end's am/pm.
  const bare = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*$/.exec(parts[0] ?? "");
  let start = parseClock(parts[0]);
  if (!start && bare && end && Number(bare[1]) < 13) {
    const h = Number(bare[1]);
    const pm = /p\.?\s?m/i.test(rest) && h < 12 && h + 12 <= end.h;
    start = { h: pm ? h + 12 : h, m: bare[2] ? Number(bare[2]) : 0 };
  }
  if (end && start && end.h === start.h && end.m === start.m) end = null;
  return { start, end };
}

export const clockText = (c: Clock): string => `${String(c.h).padStart(2, "0")}:${String(c.m).padStart(2, "0")}`;

// ---- days ----

export function parseDay(iso: string | null | undefined): Day | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const day = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const probe = new Date(Date.UTC(day.y, day.m - 1, day.d));
  if (probe.getUTCMonth() !== day.m - 1 || probe.getUTCDate() !== day.d) return null;
  return day;
}

const weekdayUtc = (day: Day): number => new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
const dayNumber = (day: Day): number => Date.UTC(day.y, day.m - 1, day.d) / DAY_MS;
const localDay = (d: Date): Day => ({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });

// Weekday words at the START of a printed date, in the six languages the app speaks. Only words that
// cannot be a month or an ordinary word there: "mar" (martes / martedì / March) and "do" (Donnerstag
// / "do" in Portuguese) are left out, which costs nothing — the weekday only breaks a tie.
const WEEKDAYS: Array<[RegExp, number]> = [
  [/^(sun|sunday|so|sonntag|dom|domingo|domenica|niedz|niedziela|nd)\b/, 0],
  [/^(mon|monday|mo|montag|lun|lunes|luned[iì]|seg|segunda(-feira)?|pon|poniedzia[łl]ek|pn)\b/, 1],
  [/^(tue|tues|tuesday|di|dienstag|martes|marted[iì]|ter|ter[cç]a(-feira)?|wt|wtorek)\b/, 2],
  [/^(wed|wednesday|mi|mittwoch|mi[ée]|mi[ée]rcoles|mer|mercoled[iì]|qua|quarta(-feira)?|[śs]r|[śs]roda)\b/, 3],
  [/^(thu|thur|thurs|thursday|donnerstag|jue|jueves|gio|gioved[iì]|qui|quinta(-feira)?|czw|czwartek)\b/, 4],
  [/^(fri|friday|fr|freitag|vie|viernes|ven|venerd[iì]|sex|sexta(-feira)?|pt|pi[aą]tek)\b/, 5],
  [/^(sat|saturday|sa|samstag|s[áa]b|s[áa]bado|sabato|sob|sobota)\b/, 6],
];

/** The weekday a printed date starts with ("Fri 20 Nov" → 5), or null. */
export function printedWeekday(dateText: string | null | undefined): number | null {
  if (!dateText) return null;
  const s = dateText.trim().toLowerCase().normalize("NFC");
  for (const [re, n] of WEEKDAYS) if (re.test(s)) return n;
  return null;
}

/**
 * The year of a date printed without one. The first of this year and the next that has not passed;
 * when the poster prints a weekday, the one of those two it matches, if one does. A date a few days
 * back stays this year — it is a poster for something that has just happened, and saying so is
 * better than moving it a year on.
 */
export function inferYear(month: number, day: number, weekday: number | null, today: Date): number {
  const now = localDay(today);
  const candidates = [now.y, now.y + 1].map((y) => ({ y, m: month, d: day }));
  const recent = (c: Day) => dayNumber(c) >= dayNumber(now) - 7;
  const ahead = candidates.filter(recent);
  if (weekday !== null) {
    const match = ahead.find((c) => weekdayUtc(c) === weekday);
    if (match) return match.y;
  }
  return (ahead[0] ?? candidates[1]!).y;
}

// ---- timezones ----

// What posters print, as minutes east of UTC. Generic US zones follow US daylight time (below); the
// European abbreviations are taken as written, since "CET" in July is what a poster means by it.
const ZONES: Record<string, number> = {
  utc: 0, gmt: 0, z: 0, wet: 0, west: 60, bst: 60, cet: 60, cest: 120, mez: 60, mesz: 120,
  eet: 120, eest: 180, msk: 180, brt: -180, art: -180, est: -300, edt: -240, cst: -360, cdt: -300,
  mst: -420, mdt: -360, pst: -480, pdt: -420, akst: -540, akdt: -480, hst: -600, jst: 540, kst: 540,
  aest: 600, aedt: 660, nzst: 720, nzdt: 780, sgt: 480, hkt: 480,
};
const US_GENERIC: Record<string, number> = { et: -300, ct: -360, mt: -420, pt: -480 };

/** Daylight time in the US: from the second Sunday of March to the first Sunday of November. */
function usDaylight(day: Day): boolean {
  const nthSunday = (month: number, n: number) => {
    const first = weekdayUtc({ y: day.y, m: month, d: 1 });
    return 1 + ((7 - first) % 7) + (n - 1) * 7;
  };
  const n = dayNumber(day);
  return n >= dayNumber({ y: day.y, m: 3, d: nthSunday(3, 2) }) && n < dayNumber({ y: day.y, m: 11, d: nthSunday(11, 1) });
}

/**
 * Minutes east of UTC for a timezone as a poster prints it — "CET", "UTC+2", "GMT-03:00", "+0530",
 * "ET" — on that day. Null for anything else, and for "local time": the event is then in the
 * device's own zone, which for a poster on the street is the right one.
 */
export function zoneOffset(zone: string | null | undefined, on: { y: number; m: number; d: number }): number | null {
  if (!zone) return null;
  const s = zone.trim().toLowerCase().replace(/[()]/g, "");
  const off = /^(?:utc|gmt)?\s*([+-−])\s*(\d{1,2})(?::?(\d{2}))?$/.exec(s);
  if (off) {
    const sign = off[1] === "+" ? 1 : -1;
    const h = Number(off[2]);
    const m = off[3] ? Number(off[3]) : 0;
    if (h > 14 || m > 59) return null;
    return sign * (h * 60 + m);
  }
  if (s in ZONES) return ZONES[s]!;
  if (s in US_GENERIC) return US_GENERIC[s]! + (usDaylight(on) ? 60 : 0);
  return null;
}

/** A wall time on a day as an instant: in `offset` minutes east of UTC, or the device's own zone. */
export function wallTime(day: Day, clock: Clock, offset: number | null): Date {
  if (offset === null) return new Date(day.y, day.m - 1, day.d, clock.h, clock.m);
  return new Date(Date.UTC(day.y, day.m - 1, day.d, clock.h, clock.m) - offset * 60_000);
}

const addDays = (day: Day, n: number): Day => {
  const d = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};

// ---- the rest of a reading ----

/** A link as printed ("lanternroom.example/tickets") made into one a phone can open; null if it is not one. */
export function normaliseLink(text: string | null | undefined): string | null {
  if (!text) return null;
  const s = text.trim().replace(/[\s,;]+$/, "");
  if (!s || /\s/.test(s)) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s) ? `https://${s}` : null;
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t : null;
};

/**
 * One reading as the draft the confirm form opens with. `today` decides the year of a date printed
 * without one; the device's zone is used unless the poster prints another.
 */
export function toDraft(r: PosterReading, today: Date): Draft {
  let first = parseDay(r.date);
  let last = parseDay(r.endDate);
  if (first && !r.yearPrinted) {
    const y = inferYear(first.m, first.d, printedWeekday(r.dateText), today);
    if (last) last = { ...last, y: last.y + (y - first.y) };
    first = { ...first, y };
  }
  // "28 Dec – 2 Jan" printed without years: the end is in the next one.
  if (first && last && dayNumber(last) < dayNumber(first)) last = { ...last, y: last.y + 1 };
  if (first && last && dayNumber(last) === dayNumber(first)) last = null;

  const range = parseClockRange(r.start);
  const doorsAt = parseClock(r.doors);
  const startAt = range.start ?? doorsAt;
  const endAt = parseClock(r.end) ?? range.end;
  const doors = doorsAt && startAt && (doorsAt.h !== startAt.h || doorsAt.m !== startAt.m) ? clockText(doorsAt) : null;

  const base: Omit<Draft, "start" | "end" | "allDay"> = {
    title: clean(r.title) ?? "",
    doors,
    venue: clean(r.venue),
    address: clean(r.address),
    price: clean(r.price),
    link: normaliseLink(r.link),
    description: clean(r.description),
  };
  if (!first) return { ...base, start: null, end: null, allDay: !startAt };

  if (!startAt) {
    // A day, or days, with no time: midnight of each, the way a calendar keeps an all-day event.
    return { ...base, start: new Date(first.y, first.m - 1, first.d), end: last ? new Date(last.y, last.m - 1, last.d) : null, allDay: true };
  }
  const offset = zoneOffset(r.timezone, first);
  const start = wallTime(first, startAt, offset);
  let end: Date | null = null;
  if (endAt) {
    end = wallTime(last ?? first, endAt, offset);
    // "20:00–02:00": past midnight is the next day.
    if (end.getTime() <= start.getTime()) end = wallTime(addDays(last ?? first, 1), endAt, offset);
  } else if (last) {
    end = wallTime(last, { h: 23, m: 59 }, offset);
  }
  return { ...base, start, end, allDay: false };
}

// ---- when an event is over ----

/** Three hours, for an event with a start and no end: long enough for a concert, short enough for a talk. */
export const ASSUMED_LENGTH_MS = 3 * 3_600_000;

export interface EventTimes {
  start?: unknown;
  end?: unknown;
  allDay?: unknown;
  /** A record has more; these are the ones read here. */
  [field: string]: unknown;
}

export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** The moment an event is over: its end; the end of its last day when it is all-day; else three hours on. */
export function endsAt(e: EventTimes): Date | null {
  const start = toDate(e.start);
  if (!start) return null;
  const end = toDate(e.end);
  if (e.allDay) {
    const lastDay = end && end.getTime() > start.getTime() ? end : start;
    return new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1);
  }
  return end && end.getTime() > start.getTime() ? end : new Date(start.getTime() + ASSUMED_LENGTH_MS);
}

/** Over by `now`. An event with no start is not over: it is not anywhere yet. */
export function isOver(e: EventTimes, now: Date): boolean {
  const end = endsAt(e);
  return end !== null && end.getTime() <= now.getTime();
}

/** Whole days from today to the event's first day (0 today, 1 tomorrow, negative behind). */
export function daysUntil(start: Date, today: Date): number {
  return Math.round((dayNumber(localDay(start)) - dayNumber(localDay(today))));
}
