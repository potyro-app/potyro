// Where you are in the plan, and how you move. Pure functions over plain data: every change returns
// a new `Progress`, the app stores it in `ctx.storage`, and the tests run it without a browser.
//
// Progress is by GOAL, not by calendar: you stay on a week until you say its "done when" is met, and
// you can repeat it. The calendar decides only which day of the 7-day cycle it is (day 7 rests) and
// which weekday is the review day.

import type { BlockContent, ModuleWeek, Plan, PlanLink, PlanModule, PlanPhase, PlanWeek } from "./plan.js";
import { blocksForWeek, mainWeeks } from "./plan.js";

export const DAY_MS = 86_400_000;
export const DEFAULT_REVIEW_WEEKDAY = 6; // Saturday
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export interface ModuleState {
  id: string;
  weeksTotal: number;
  /** 0-based. Past the module's last defined week, the last one repeats. */
  weekIndex: number;
  startedAt: string;
  weekStartedAt: string;
}

export type ProgressEventKind = "started" | "goalMet" | "repeated" | "jumped" | "moduleStarted" | "moduleLeft" | "moduleFinished";

export interface ProgressEvent {
  at: string;
  kind: ProgressEventKind;
  weekId: string;
}

export interface Progress {
  /** Day 1 of week 1, as a local "YYYY-MM-DD". */
  startDate: string;
  /** 0 = Sunday … 6 = Saturday. */
  reviewWeekday: number;
  /** The current main-plan week — or, while a module runs, the week to come back to. */
  weekId: string;
  weekStartedAt: string;
  repeats: Record<string, number>;
  /** The last week's goal has been met. */
  completed: boolean;
  module: ModuleState | null;
  history: ProgressEvent[];
}

// ---- days ----

const pad = (n: number): string => String(n).padStart(2, "0");

/** A local calendar day as "YYYY-MM-DD". */
export const isoDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The local midnight of a "YYYY-MM-DD" (an invalid string reads as today). */
export function parseDay(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return startOfDay(new Date());
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * `n` calendar days after `d`, at its midnight. Never `+ n * DAY_MS`: across a clock change a day is
 * 23 or 25 hours, and 24 of them land on the evening before or an hour after midnight.
 */
export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Whole days from `a` to `b` (both taken at local midnight); negative when `b` is earlier. */
export const daysBetween = (a: Date, b: Date): number => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);

/** Which day of the 7-day cycle `today` is, 1–7. Before the start date, it is day 1. */
export function dayNumber(progress: Progress, today: Date): number {
  const since = daysBetween(parseDay(progress.startDate), today);
  if (since < 0) return 1;
  return (since % 7) + 1;
}

/** The date of day 1 of the cycle `today` falls in. */
export function cycleStart(progress: Progress, today: Date): Date {
  const start = parseDay(progress.startDate);
  const since = daysBetween(start, today);
  if (since < 0) return start;
  return addDays(start, Math.floor(since / 7) * 7);
}

export const isRestDay = (progress: Progress, today: Date): boolean => dayNumber(progress, today) === 7;
export const isReviewDay = (progress: Progress, today: Date): boolean => today.getDay() === progress.reviewWeekday;

/** Whole weeks since an ISO timestamp, floored at 0. */
export function weeksSince(iso: string, today: Date): number {
  const from = new Date(iso);
  if (Number.isNaN(from.getTime())) return 0;
  return Math.max(0, Math.floor(daysBetween(from, today) / 7));
}

// ---- state ----

export function defaultProgress(plan: Plan, today: Date): Progress {
  const first = mainWeeks(plan)[0];
  const now = today.toISOString();
  return {
    startDate: isoDay(today),
    reviewWeekday: DEFAULT_REVIEW_WEEKDAY,
    weekId: first ? first.week.id : "",
    weekStartedAt: now,
    repeats: {},
    completed: false,
    module: null,
    history: first ? [{ at: now, kind: "started", weekId: first.week.id }] : [],
  };
}

/**
 * A stored progress may name weeks a newer plan no longer has. Keep everything that still applies
 * and land on the first week otherwise, so replacing the plan never strands the app.
 */
export function reconcileProgress(plan: Plan, progress: Progress, today: Date): Progress {
  const weeks = mainWeeks(plan);
  let next = progress;
  if (!weeks.some((w) => w.week.id === progress.weekId)) {
    const first = weeks[0];
    next = { ...next, weekId: first ? first.week.id : "", weekStartedAt: today.toISOString(), completed: false };
  }
  if (next.module && !plan.modules.some((m) => m.id === next.module!.id)) next = { ...next, module: null };
  return next;
}

export interface CurrentWeek {
  phase: PlanPhase;
  week: PlanWeek;
  /** 0-based position in the main plan, and how many rows there are. */
  index: number;
  total: number;
  /** For a row spanning several weeks: which of them you are in (1-based, capped at the span). */
  weekOfSpan: number;
  spanWeeks: number;
  repeats: number;
  module: PlanModule | null;
  moduleWeek: ModuleWeek | null;
  /** 1-based module week, and the total you chose. */
  moduleWeekNumber: number;
  moduleWeeksTotal: number;
  goal: string;
}

export function currentWeek(plan: Plan, progress: Progress, today: Date): CurrentWeek | null {
  const weeks = mainWeeks(plan);
  const hit = weeks.find((w) => w.week.id === progress.weekId);
  if (!hit) return null;
  const spanWeeks = hit.week.spanWeeks ?? 1;
  const module = progress.module ? (plan.modules.find((m) => m.id === progress.module!.id) ?? null) : null;
  const moduleWeek = module && progress.module ? (module.weeks[Math.min(progress.module.weekIndex, module.weeks.length - 1)] ?? null) : null;
  return {
    phase: hit.phase,
    week: hit.week,
    index: hit.index,
    total: weeks.length,
    weekOfSpan: Math.min(spanWeeks, weeksSince(progress.weekStartedAt, today) + 1),
    spanWeeks,
    repeats: progress.repeats[hit.week.id] ?? 0,
    module,
    moduleWeek,
    moduleWeekNumber: progress.module ? progress.module.weekIndex + 1 : 0,
    moduleWeeksTotal: progress.module?.weeksTotal ?? 0,
    goal: moduleWeek ? moduleWeek.doneWhen : hit.week.doneWhen,
  };
}

/** One block as today's session shows it. */
export interface DayBlock {
  id: string;
  label: string;
  minutes: number;
  text: string;
  links: PlanLink[];
  fromModule: boolean;
  review: boolean;
}

/** Today's five blocks, with the module's overrides and the review-day swap applied. Empty on a rest day. */
export function todayBlocks(plan: Plan, progress: Progress, today: Date, opts: { ignoreRest?: boolean } = {}): DayBlock[] {
  if (!opts.ignoreRest && isRestDay(progress, today)) return [];
  const cur = currentWeek(plan, progress, today);
  if (!cur) return [];
  const base = blocksForWeek(plan, cur.week.id);
  const overrides: Record<string, BlockContent> = cur.moduleWeek?.blocks ?? {};
  const review = isReviewDay(progress, today);
  const last = plan.blocks.length - 1;
  return plan.blocks.map((block, i) => {
    if (review && i === last) {
      return { id: block.id, label: plan.reviewDay.label, minutes: block.minutes, text: plan.reviewDay.text, links: [], fromModule: false, review: true };
    }
    const fromModule = block.id in overrides;
    const content = fromModule ? overrides[block.id]! : (base[block.id] ?? { text: block.source ?? "" });
    return { id: block.id, label: block.label, minutes: block.minutes, text: content.text, links: content.links ?? [], fromModule, review: false };
  });
}

// ---- moves ----

const event = (progress: Progress, kind: ProgressEventKind, weekId: string, now: Date): ProgressEvent[] => [
  ...progress.history,
  { at: now.toISOString(), kind, weekId },
];

/** The goal is met: next module week, or next main-plan week. The last one marks the plan complete. */
export function goalMet(plan: Plan, progress: Progress, now: Date): Progress {
  const iso = now.toISOString();
  if (progress.module) {
    const m = progress.module;
    const metId = moduleWeekId(plan, m);
    const nextIndex = m.weekIndex + 1;
    if (nextIndex >= m.weeksTotal) {
      const h = event({ ...progress, history: event(progress, "goalMet", metId, now) }, "moduleFinished", m.id, now);
      return { ...progress, module: null, weekStartedAt: iso, history: h };
    }
    return { ...progress, module: { ...m, weekIndex: nextIndex, weekStartedAt: iso }, history: event(progress, "goalMet", metId, now) };
  }
  const weeks = mainWeeks(plan);
  const i = weeks.findIndex((w) => w.week.id === progress.weekId);
  if (i < 0) return progress;
  const history = event(progress, "goalMet", progress.weekId, now);
  const next = weeks[i + 1];
  if (!next) return { ...progress, completed: true, history };
  return { ...progress, weekId: next.week.id, weekStartedAt: iso, completed: false, history: [...history, { at: iso, kind: "started", weekId: next.week.id }] };
}

/** Stay on this week (or module week) and count the repeat. */
export function repeatWeek(plan: Plan, progress: Progress, now: Date): Progress {
  const iso = now.toISOString();
  const id = progress.module ? moduleWeekId(plan, progress.module) : progress.weekId;
  const repeats = { ...progress.repeats, [id]: (progress.repeats[id] ?? 0) + 1 };
  const module = progress.module ? { ...progress.module, weekStartedAt: iso } : null;
  return { ...progress, repeats, module, weekStartedAt: progress.module ? progress.weekStartedAt : iso, history: event(progress, "repeated", id, now) };
}

/** Go to any main-plan week. Leaves a running module. */
export function jumpTo(plan: Plan, progress: Progress, weekId: string, now: Date): Progress {
  if (!mainWeeks(plan).some((w) => w.week.id === weekId)) return progress;
  if (weekId === progress.weekId && !progress.module) return progress;
  let next = progress.module ? leaveModule(plan, progress, now) : progress;
  next = { ...next, weekId, weekStartedAt: now.toISOString(), completed: false, history: event(next, "jumped", weekId, now) };
  return next;
}

export function startModule(plan: Plan, progress: Progress, moduleId: string, weeks: number, now: Date): Progress {
  const m = plan.modules.find((x) => x.id === moduleId);
  if (!m || !(Number.isInteger(weeks) && weeks >= 1)) return progress;
  const iso = now.toISOString();
  const base = progress.module ? leaveModule(plan, progress, now) : progress;
  return {
    ...base,
    module: { id: m.id, weeksTotal: weeks, weekIndex: 0, startedAt: iso, weekStartedAt: iso },
    history: event(base, "moduleStarted", m.id, now),
  };
}

/** Back to the main plan where you left it. */
export function leaveModule(plan: Plan, progress: Progress, now: Date): Progress {
  if (!progress.module) return progress;
  return { ...progress, module: null, weekStartedAt: now.toISOString(), history: event(progress, "moduleLeft", progress.module.id, now) };
}

export function setStartDate(progress: Progress, day: string): Progress {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? { ...progress, startDate: day } : progress;
}

export function setReviewWeekday(progress: Progress, weekday: number): Progress {
  return Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? { ...progress, reviewWeekday: weekday } : progress;
}

/** The id of the module week in progress (the last defined one repeats past the end). */
export function moduleWeekId(plan: Plan, m: ModuleState): string {
  const mod = plan.modules.find((x) => x.id === m.id);
  if (!mod) return m.id;
  const w = mod.weeks[Math.min(m.weekIndex, mod.weeks.length - 1)];
  return w ? w.id : m.id;
}

/** What a module warning names, for the app to put into words. */
export interface ModuleWarning {
  module: string;
  from: string;
  phase: string;
  here: string;
}

const englishWarning = (v: ModuleWarning): string => `The plan suggests ${v.module} from ${v.from} (${v.phase}); you are on ${v.here}.`;

/**
 * Why starting this module now is early, or null when it is not. `say` words it — the app passes
 * one in the person's language (#303); without one it is English.
 */
export function moduleWarning(plan: Plan, progress: Progress, module: PlanModule, say: (v: ModuleWarning) => string = englishWarning): string | null {
  if (!module.availableFrom) return null;
  const weeks = mainWeeks(plan);
  const from = weeks.find((w) => w.week.id === module.availableFrom);
  const here = weeks.find((w) => w.week.id === progress.weekId);
  if (!from || !here || here.index >= from.index) return null;
  return say({ module: module.title.toLowerCase(), from: from.week.label, phase: from.phase.title, here: here.week.label });
}

// ---- what the sessions say ----

/** The sessions that fall in the 7-day cycle `today` is in. */
/** A session row as the store hands it back: the fields are checked here, not trusted. */
export interface SessionLike {
  id?: string;
  date?: unknown;
  blocksDone?: unknown;
  rest?: unknown;
}

export function sessionsInCycle<T extends SessionLike>(sessions: T[], progress: Progress, today: Date): (T & { date: Date })[] {
  const start = cycleStart(progress, today);
  const from = start.getTime();
  const to = addDays(start, 7).getTime();
  return sessions.filter((s): s is T & { date: Date } => s.date instanceof Date && s.date.getTime() >= from && s.date.getTime() < to);
}

/** Days with at least one block done this cycle (a rest day taken does not count as practice). */
export function daysPractised(sessions: SessionLike[], progress: Progress, today: Date): number {
  const days = new Set<string>();
  for (const s of sessionsInCycle(sessions, progress, today)) {
    if (Array.isArray(s.blocksDone) && s.blocksDone.length > 0) days.add(isoDay(s.date));
  }
  return days.size;
}
