// What the check-ins say: the 30-day series, the scatter by tag, and the one sentence worth reading.
// Plain functions over plain rows, so they are tested without a browser and the chart only draws.

export interface CheckinRow {
  id?: string;
  date?: string | Date | null;
  hours?: number | null;
  mood?: number | null;
  note?: string | null;
  tags?: string[] | null;
}

/** One check-in, normalised: a local calendar day and numbers or nulls. */
export interface Night {
  day: string; // YYYY-MM-DD
  hours: number | null;
  mood: number | null;
  tags: string[];
  note: string;
  id?: string;
}

export const TAGS = ["exercise", "coffee", "alcohol", "late screen", "nap", "stressed"] as const;
export const MOOD_FACES = ["", "😫", "😕", "😐", "🙂", "😄"] as const;
export const MOOD_WORDS = ["", "rough", "low", "okay", "good", "great"] as const;

/** Nights at or over this many hours are "long"; under SHORT are "short". */
export const LONG = 7;
export const SHORT = 6;
/** Fewer nights than this in a group and a comparison says nothing worth saying. */
export const MIN_GROUP = 3;

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * The calendar day a check-in is for. A date-only string is that day as written — reading it as a
 * Date would move it to the previous day west of Greenwich. A Date (or a full timestamp) is read
 * in local time, the day the person lived it.
 */
export function dayKey(v: string | Date): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = typeof v === "string" ? new Date(v) : v;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Day `key` moved by `n` days, as a key. Noon avoids daylight-saving edges. */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const t = new Date(y, m - 1, d, 12);
  t.setDate(t.getDate() + n);
  return dayKey(t);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Rows → nights, oldest first. Two check-ins for one day: the later row wins. Undated rows are skipped. */
export function toNights(rows: readonly CheckinRow[]): Night[] {
  const byDay = new Map<string, Night>();
  for (const r of rows) {
    if (r.date == null || r.date === "") continue;
    const day = dayKey(r.date);
    if (day.includes("NaN")) continue;
    byDay.set(day, {
      day,
      hours: num(r.hours),
      mood: num(r.mood),
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
      note: typeof r.note === "string" ? r.note : "",
      id: r.id,
    });
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

export interface Window {
  /** Every calendar day in the window, oldest first. */
  days: string[];
  /** The check-ins inside it. */
  nights: Night[];
}

/**
 * Up to `size` days ending on the latest check-in, starting no earlier than the first one. Ending
 * there rather than on today keeps a chart full when the last weeks were not logged (and keeps sample
 * data alive whenever the app is opened); starting at the first check-in keeps a new log from being
 * drawn as a month of nothing.
 */
export function lastDays(nights: readonly Night[], size = 30): Window {
  const last = nights[nights.length - 1];
  if (!last) return { days: [], nights: [] };
  const earliest = addDays(last.day, -(size - 1));
  const first = nights[0]!.day > earliest ? nights[0]!.day : earliest;
  const days: string[] = [];
  for (let d = first; d <= last.day; d = addDays(d, 1)) days.push(d);
  return { days, nights: nights.filter((n) => n.day >= first) };
}

/** One value per calendar day, null where nothing was logged: the chart leaves a gap there. */
export function dailySeries(w: Window): { hours: Array<number | null>; mood: Array<number | null> } {
  const at = new Map(w.nights.map((n) => [n.day, n]));
  return { hours: w.days.map((d) => at.get(d)?.hours ?? null), mood: w.days.map((d) => at.get(d)?.mood ?? null) };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 12" — short enough for thirty ticks on a phone. */
export function shortDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return `${WEEKDAYS[new Date(y, m - 1, d, 12).getDay()]} ${d}`;
}

/** "Oct 11" */
export function monthDay(key: string): string {
  const [, m, d] = key.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}`;
}

export function mean(xs: readonly number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** One decimal, without a trailing ".0" doing nothing: 4.1, 3, 7.5. */
export function one(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function hoursText(h: number): string {
  return `${one(h)}h`;
}

/** Nights with both numbers: the only ones a comparison can use. */
const complete = (nights: readonly Night[]) => nights.filter((n): n is Night & { hours: number; mood: number } => n.hours != null && n.mood != null);

/**
 * A sentence, the numbers in it (so the view can colour them), and how much it matters: the gap it
 * reports as a share of the scale it is on, so a mood gap and a sleep gap can be ranked together.
 */
export interface Insight {
  kind: "sleep" | "tag" | "none";
  parts: Array<string | { value: string; series: "sleep" | "mood" }>;
  strength: number;
}

export const insightText = (i: Insight): string => i.parts.map((p) => (typeof p === "string" ? p : p.value)).join("");

/** "On nights of 7 hours or more your mood averages 4.1. Under 6 hours, it's 2.8." */
export function sleepInsight(nights: readonly Night[]): Insight | null {
  const all = complete(nights);
  const long = all.filter((n) => n.hours >= LONG).map((n) => n.mood);
  const short = all.filter((n) => n.hours < SHORT).map((n) => n.mood);
  if (long.length < MIN_GROUP || short.length < MIN_GROUP) return null;
  const a = mean(long)!;
  const b = mean(short)!;
  if (Math.abs(a - b) < 0.3) {
    return {
      kind: "sleep",
      parts: ["Long nights or short, your mood stays close to ", { value: one((a + b) / 2), series: "mood" }, ". Sleep is not what moves it."],
      strength: 0.05,
    };
  }
  return {
    kind: "sleep",
    parts: [
      "On nights of ",
      { value: `${LONG} hours`, series: "sleep" },
      " or more your mood averages ",
      { value: one(a), series: "mood" },
      ". Under ",
      { value: `${SHORT} hours`, series: "sleep" },
      ", it's ",
      { value: one(b), series: "mood" },
      ".",
    ],
    strength: Math.abs(a - b) / 4,
  };
}

const TAG_PHRASE: Record<string, string> = {
  exercise: "On days you exercise",
  coffee: "On coffee days",
  alcohol: "After a drink",
  "late screen": "After late screens",
  nap: "On days with a nap",
  stressed: "On stressful days",
};

/**
 * The tag that makes the biggest difference, to mood or to sleep: "On days you exercise your mood
 * averages 4.3, against 3.1 without." Only tags with enough nights both with and without them.
 */
export function tagInsight(nights: readonly Night[]): Insight | null {
  const all = complete(nights);
  let best: Insight | null = null;
  const tags = [...new Set(all.flatMap((n) => n.tags))];
  for (const tag of tags) {
    const withIt = all.filter((n) => n.tags.includes(tag));
    const without = all.filter((n) => !n.tags.includes(tag));
    if (withIt.length < MIN_GROUP || without.length < MIN_GROUP) continue;
    const lead = TAG_PHRASE[tag] ?? `On days tagged “${tag}”`;
    const moodGap = mean(withIt.map((n) => n.mood))! - mean(without.map((n) => n.mood))!;
    const sleepGap = mean(withIt.map((n) => n.hours))! - mean(without.map((n) => n.hours))!;
    const byMood = Math.abs(moodGap) / 4;
    const bySleep = Math.abs(sleepGap) / 4;
    const candidate: Insight =
      byMood >= bySleep
        ? {
            kind: "tag",
            parts: [`${lead} your mood averages `, { value: one(mean(withIt.map((n) => n.mood))!), series: "mood" }, ", against ", { value: one(mean(without.map((n) => n.mood))!), series: "mood" }, " without."],
            strength: byMood,
          }
        : {
            kind: "tag",
            parts: [`${lead} you sleep `, { value: hoursText(mean(withIt.map((n) => n.hours))!), series: "sleep" }, " on average, against ", { value: hoursText(mean(without.map((n) => n.hours))!), series: "sleep" }, " without."],
            strength: bySleep,
          };
    if (!best || candidate.strength > best.strength) best = candidate;
  }
  return best;
}

/**
 * What to say, most telling first. Always at least one line: with too little logged yet it says how
 * many more check-ins it needs, rather than inventing a pattern from three nights.
 */
export function insights(nights: readonly Night[]): Insight[] {
  const found = [sleepInsight(nights), tagInsight(nights)].filter((x): x is Insight => x !== null).sort((a, b) => b.strength - a.strength);
  if (found.length) return found;
  const have = complete(nights).length;
  const need = Math.max(1, 2 * MIN_GROUP - have);
  return [
    {
      kind: "none",
      parts: have
        ? [`${have} check-in${have === 1 ? "" : "s"} so far. A few more nights — about ${need} — and a pattern starts to show.`]
        : ["Log how you slept tonight. After a week or so, this is where the pattern shows up."],
      strength: 0,
    },
  ];
}

export interface Stats {
  nights: number;
  avgHours: number | null;
  avgMood: number | null;
  /** Share of logged nights at or over LONG hours, 0–1. */
  longShare: number | null;
}

export function stats(nights: readonly Night[]): Stats {
  const hours = nights.map((n) => n.hours).filter((h): h is number => h != null);
  const moods = nights.map((n) => n.mood).filter((m): m is number => m != null);
  return {
    nights: nights.length,
    avgHours: mean(hours),
    avgMood: mean(moods),
    longShare: hours.length ? hours.filter((h) => h >= LONG).length / hours.length : null,
  };
}

/** A small, stable offset per day, so nights with the same mood do not sit on top of each other. */
export function jitter(day: string, spread = 0.14): number {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 16777619);
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 2 * spread;
}

export interface ScatterGroup {
  tag: string; // a tag, or "" for nights with none
  points: Array<{ x: number; y: number; day: string; note: string }>;
}

/** One group per tag in `order` that has nights, then the untagged ones. A night with two tags is in both. */
export function scatterGroups(nights: readonly Night[], order: readonly string[] = TAGS): ScatterGroup[] {
  const all = complete(nights);
  const point = (n: Night & { hours: number; mood: number }) => ({ x: n.hours, y: n.mood + jitter(n.day), day: n.day, note: n.note });
  const known = new Set(order);
  const extra = [...new Set(all.flatMap((n) => n.tags).filter((t) => !known.has(t)))].sort();
  const groups: ScatterGroup[] = [...order, ...extra].map((tag) => ({ tag, points: all.filter((n) => n.tags.includes(tag)).map(point) }));
  groups.push({ tag: "", points: all.filter((n) => n.tags.length === 0).map(point) });
  return groups.filter((g) => g.points.length > 0);
}

/** Least-squares line through (hours, mood), as its two ends over the hours logged; null when flat or too few. */
export function trend(nights: readonly Night[]): { from: { x: number; y: number }; to: { x: number; y: number }; slope: number } | null {
  const all = complete(nights);
  if (all.length < 4) return null;
  const mx = mean(all.map((n) => n.hours))!;
  const my = mean(all.map((n) => n.mood))!;
  let sxy = 0;
  let sxx = 0;
  for (const n of all) {
    sxy += (n.hours - mx) * (n.mood - my);
    sxx += (n.hours - mx) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const lo = Math.min(...all.map((n) => n.hours));
  const hi = Math.max(...all.map((n) => n.hours));
  const at = (x: number) => Math.min(5.4, Math.max(0.6, my + slope * (x - mx)));
  return { from: { x: lo, y: at(lo) }, to: { x: hi, y: at(hi) }, slope };
}
