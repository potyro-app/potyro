// How long food keeps, and what that means today: the expiry arithmetic of the app, in plain
// functions the tests run without a browser.
//
// A date printed on the pack wins. Without one, the app guesses from the kind of food and where it
// is kept, and says it is a guess everywhere the date is shown — a guess the person can correct.
// Every date here is a calendar DAY (a `datetime` field with day precision keeps local midnight), so
// "days left" counts midnights, not 24-hour stretches, and a clock change cannot move it.

export const CATEGORIES = ["produce", "dairy", "meat", "fish", "bakery", "frozen", "dry", "drinks", "leftovers", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const PLACES = ["fridge", "freezer", "cupboard"] as const;
export type Place = (typeof PLACES)[number];

export const STATUSES = ["in", "used", "wasted"] as const;
export type Status = (typeof STATUSES)[number];

/** Where each kind of food usually lives, when the photo does not say. */
export const USUAL_PLACE: Record<Category, Place> = {
  produce: "fridge",
  dairy: "fridge",
  meat: "fridge",
  fish: "fridge",
  bakery: "cupboard",
  frozen: "freezer",
  dry: "cupboard",
  drinks: "cupboard",
  leftovers: "fridge",
  other: "fridge",
};

/**
 * Days a thing keeps from the day it comes home, by kind and place: cautious household figures, not
 * a food-safety table. Meat and fish are short on purpose — a guess should err towards "use it".
 */
export const SHELF_DAYS: Record<Category, Record<Place, number>> = {
  produce: { fridge: 5, freezer: 240, cupboard: 5 },
  dairy: { fridge: 7, freezer: 90, cupboard: 1 },
  meat: { fridge: 2, freezer: 120, cupboard: 1 },
  fish: { fridge: 1, freezer: 90, cupboard: 1 },
  bakery: { fridge: 5, freezer: 90, cupboard: 3 },
  frozen: { fridge: 1, freezer: 90, cupboard: 1 },
  dry: { fridge: 180, freezer: 365, cupboard: 365 },
  drinks: { fridge: 5, freezer: 180, cupboard: 180 },
  leftovers: { fridge: 3, freezer: 60, cupboard: 1 },
  other: { fridge: 7, freezer: 90, cupboard: 30 },
};

/** A record as these functions read it: any fields, each read with care. */
export type Row = { readonly [field: string]: unknown };

const DAY = 86_400_000;

/** Local midnight of the day `d` falls on. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** A record's date as a Date, whatever form it crossed in (a Date, an ISO string, a number). */
export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" && v.trim()) {
    // "2026-10-18" is a calendar day, not midnight in London.
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
    if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v);
  return null;
}

/** Whole days from `today` to `day`, counted in midnights: tomorrow is 1, yesterday −1. */
export function daysBetween(today: Date, day: Date): number {
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const b = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  return Math.round((b - a) / DAY);
}

export const isCategory = (v: unknown): v is Category => (CATEGORIES as readonly unknown[]).includes(v);
export const isPlace = (v: unknown): v is Place => (PLACES as readonly unknown[]).includes(v);

/** The day a thing bought (or put away) on `from` is guessed to keep until. */
export function guessExpiry(category: Category, place: Place, from: Date): Date {
  return addDays(startOfDay(from), SHELF_DAYS[category][place]);
}

/**
 * A date read off a photo, if it can be believed. A printed date long past (more than two months) or
 * years ahead is far more likely a misread — a lot number, a "packed on" — than the truth, so it is
 * dropped and the app guesses instead. A date a few days past is kept: that is the useful news.
 */
export function plausiblePrinted(printed: Date | null, today: Date): Date | null {
  if (!printed) return null;
  const days = daysBetween(today, printed);
  return days < -60 || days > 5 * 366 ? null : startOfDay(printed);
}

/** How soon a thing should be eaten: the heading it sits under, and the colour of its urgency. */
export const FRESHNESS = ["expired", "today", "soon", "week", "later", "none"] as const;
export type Freshness = (typeof FRESHNESS)[number];

export function freshness(expires: Date | null, today: Date): Freshness {
  if (!expires) return "none";
  const left = daysBetween(today, expires);
  if (left < 0) return "expired";
  if (left === 0) return "today";
  if (left <= 3) return "soon";
  if (left <= 7) return "week";
  return "later";
}

/** Earliest first; things with no date at all last, then by name so the order is stable. */
export function byExpiry(a: Row, b: Row): number {
  const da = toDate(a.expires);
  const db = toDate(b.expires);
  if (da && db && da.getTime() !== db.getTime()) return da.getTime() - db.getTime();
  if (da && !db) return -1;
  if (!da && db) return 1;
  return String(a.name ?? "").localeCompare(String(b.name ?? ""));
}

/** The hour a reminder comes: a morning, when there is still a day to cook it. */
export const REMIND_HOUR = 9;

/**
 * When to remind about a thing: 9:00 the day before it expires. Added too late for that (it expires
 * today or tomorrow and the morning has gone), 9:00 on the day itself if that is still ahead; else
 * none. Nothing for something already used, thrown away, past its date, or without a date.
 */
export function remindAt(item: Row, now: Date): Date | null {
  if ((item.status ?? "in") !== "in") return null;
  const expires = toDate(item.expires);
  if (!expires) return null;
  const before = new Date(expires.getFullYear(), expires.getMonth(), expires.getDate() - 1, REMIND_HOUR);
  if (before.getTime() > now.getTime()) return before;
  const onTheDay = new Date(expires.getFullYear(), expires.getMonth(), expires.getDate(), REMIND_HOUR);
  return onTheDay.getTime() > now.getTime() ? onTheDay : null;
}

// ---- what was used and what was thrown away ----

type Finished = Row;

const monthKey = (d: Date) => d.getFullYear() * 12 + d.getMonth();

/** Items finished as `status` in the calendar month `back` months before `now` (0: this month). */
export function finishedIn(rows: readonly Finished[], status: Status, now: Date, back = 0): number {
  const want = monthKey(now) - back;
  const inMonth = (r: Finished): boolean => {
    const d = toDate(r.finished);
    return d !== null && monthKey(d) === want;
  };
  return rows.filter((r) => r.status === status && inMonth(r)).length;
}

/** Of what was finished in the last 30 days, the share thrown away (0–1), or null with nothing finished. */
export function wasteShare(rows: readonly Finished[], now: Date): number | null {
  const since = addDays(startOfDay(now), -29).getTime();
  const recent = rows.filter((r) => (r.status === "used" || r.status === "wasted") && (toDate(r.finished)?.getTime() ?? -Infinity) >= since);
  if (!recent.length) return null;
  return recent.filter((r) => r.status === "wasted").length / recent.length;
}

/** The first day of each of the last `n` months, oldest first: the chart's bars. */
export function lastMonths(now: Date, n: number): Date[] {
  return Array.from({ length: n }, (_, i) => new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1));
}
