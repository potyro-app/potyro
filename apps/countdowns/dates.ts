// Days, as the app counts them: whole calendar days between today and the event's day, in the
// person's own time zone — never hours, so "tomorrow" is 1 all day long and the number only changes
// at midnight. Plain functions, so the screen, the tile and the tests count the same way.

/** `2026-11-30` for a Date, in local time: what a `datetime` field with `precision: "day"` holds. */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The local midnight of a day key, or of whatever a stored value turns out to be. */
export function dayOf(value: unknown): Date | null {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const s = String(value ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole days from `today` to `date`: 0 today, 1 tomorrow, negative once it has passed. */
export function daysLeft(date: unknown, today: Date): number | null {
  const day = dayOf(date);
  if (!day) return null;
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((day.getTime() - from.getTime()) / 86_400_000);
}

/** A day `n` days from today, as a key — for the demo and the tests. */
export function daysFromNow(today: Date, n: number): string {
  return dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
}

/** Nine in the morning of an event's day: when a reminder of it should arrive. */
export function morningOf(date: unknown): Date | null {
  const day = dayOf(date);
  if (!day) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0, 0);
}

/** Upcoming events (today included) soonest first; past events most recent first. Reads each row's `date`. */
export function split<T extends Record<string, unknown>>(rows: T[], today: Date): { upcoming: Array<T & { left: number }>; past: Array<T & { left: number }> } {
  const dated = rows.map((r) => ({ ...r, left: daysLeft(r.date, today) })).filter((r): r is T & { left: number } => r.left !== null);
  const upcoming = dated.filter((r) => r.left >= 0).sort((a, b) => a.left - b.left);
  const past = dated.filter((r) => r.left < 0).sort((a, b) => b.left - a.left);
  return { upcoming, past };
}
