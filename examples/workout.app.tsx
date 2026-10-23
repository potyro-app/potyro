// workout.app.tsx — Workout: a lifting log that tells you what to do next.
//
// What it is for: open it at the gym and it already knows the plan — "Next up: Pull A, last done
// three days ago" — with every exercise showing what you lifted LAST time and what to try today. Log
// sets against that, rest, finish, and the summary says which records you just broke.
//
// What it stresses:
//  (a) ROUTINES AS RECORDS. A routine is a record with an ordered list of exercises; routines in the
//      same program take turns. PPL, Upper/Lower and 5×5 are all just data — nothing in the code
//      knows the word "push" (it used to: the days were a fixed enum, and v1 data still carries one,
//      which the Train screen turns into routines the first time it opens — see `adoptLegacyDays`).
//  (b) NESTED lists — session → entries → sets — in storage, the record form and the detail page.
//  (c) ASYNC computed that read history: an exercise's rolling best, its e1RM curve (the chart on its
//      page), a session's personal records. The computed runner awaits them and memoizes per pass.
//  (d) A progression rule you can read: double progression in `suggest` below — add weight once every
//      set reached the top of the rep range, otherwise beat last time's reps. Plain code, so changing
//      the rule is changing a function, not a setting.
//
// Written in English; its translations are catalogs, examples/files/workout/locales/<lang>.po
// (docs/30), every language but English a model's draft (#297). The live screen is a
// custom view and says its words through `runtime.ctx.t`. Exercises, routines and what you lifted are
// records, so they are never translated.
import { defineApp } from "potyro";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Ctx, Resolved, UiTimer, ViewProps } from "potyro";

// ─────────────────────────────────────────────────────────────────────────────
// The arithmetic: plain functions, the same in the Train screen, the computed values and the tile.
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const WEEK = 7 * DAY;
/** When an exercise does not say (an older record, or a hand-written one). */
const REST_SECONDS = 90;
const LOOKBACK = 5; // "best of the last N sessions"

type SetKind = "work" | "warmup" | "drop";
interface LoggedSet {
  kg?: number;
  reps?: number;
  kind?: SetKind;
}

// A relation inside a list row may be a raw id or a resolved record. A link to an exercise that was
// deleted resolves to null: that entry has no exercise any more, and says so.
const refId = (x: unknown): string | undefined => (typeof x === "string" ? x : ((x as { id?: string } | null)?.id ?? undefined));
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const dateOf = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v ?? 0)));
/** Warm-ups are for getting ready: they never count towards records or the next target. */
const working = (sets: readonly LoggedSet[]): LoggedSet[] => sets.filter((s) => s.kind !== "warmup" && num(s.reps) > 0);

/**
 * The picture for a kind of lifting, from the muscles it works: pressing (chest, shoulders, triceps),
 * pulling (back, biceps) or legs. A path in the app's own files; "" when the muscles do not say.
 */
const ART: Record<string, string> = { press: "art/press.webp", pull: "art/pull.webp", legs: "art/plates.webp" };
const KIND_OF: Record<string, string> = { chest: "press", shoulders: "press", triceps: "press", back: "pull", biceps: "pull", quads: "legs", hamstrings: "legs", glutes: "legs", calves: "legs" };
function artFor(muscles: readonly unknown[]): string {
  const count = new Map<string, number>();
  for (const m of muscles) {
    const kind = KIND_OF[String(m)];
    if (kind) count.set(kind, (count.get(kind) ?? 0) + 1);
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? ART[top[0]]! : "";
}

/** An exercise's sessions, newest first, as `exercise.history` keeps them. */
type History = { date: string; sets: { kg: number; reps: number }[] }[];

// scoring: bodyweight lifts progress on reps; loaded lifts on volume (kg × reps)
const setScore = (bw: boolean, s: LoggedSet): number => (bw ? num(s.reps) : num(s.kg) * num(s.reps));

/** Estimated one-rep max (Epley), to the half kilo: 80 × 5 → 93.5. */
const e1rm = (kg: number, reps: number): number => (reps <= 0 || kg <= 0 ? 0 : reps === 1 ? kg : Math.round(kg * (1 + reps / 30) * 2) / 2);

/** "8–12" → 8..12; "5" → 5..5; "AMRAP" or nothing → null (no target, just more than last time). */
function repRange(text: unknown): { lo: number; hi: number } | null {
  const m = /(\d+)\s*(?:[-–—to]+\s*(\d+))?/.exec(String(text ?? ""));
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  return lo > 0 ? { lo: Math.min(lo, hi), hi: Math.max(lo, hi) } : null;
}

/** Sessions newest first. */
const newestFirst = (rows: readonly Resolved[]): Resolved[] => [...rows].sort((a, b) => dateOf(b.date).getTime() - dateOf(a.date).getTime());

/** The sets an exercise got in one session, or undefined when it was not in it. */
function setsIn(session: Resolved, exerciseId: string): LoggedSet[] | undefined {
  const entry = ((session.entries as { exercise?: unknown; sets?: LoggedSet[] }[] | undefined) ?? []).find((e) => refId(e.exercise) === exerciseId);
  return entry ? (entry.sets ?? []) : undefined;
}

/** The last time this exercise was done: its date and working sets. */
function previous(sessions: readonly Resolved[], exerciseId: string, before?: Date): { date: Date; sets: LoggedSet[] } | null {
  for (const s of newestFirst(sessions)) {
    if (before && dateOf(s.date).getTime() >= before.getTime()) continue;
    const sets = setsIn(s, exerciseId);
    if (sets && working(sets).length) return { date: dateOf(s.date), sets: working(sets) };
  }
  return null;
}

/** What to try today, and why — in words the person can check against their own log. */
interface Suggestion {
  kg: number;
  reps: number;
  /** up: add weight; reps: same weight, more reps; same: nothing to go on beyond last time; first: never done. */
  why: "up" | "reps" | "first" | "same";
  /** Last time's reps, set by set: "12, 12, 12". */
  hit: number[];
  step: number;
}

/**
 * Double progression. Every working set reached the top of the rep range last time → add the
 * exercise's step and start again at the bottom. Otherwise keep the weight and aim for one more rep
 * than last time's best set. A bodyweight lift only ever asks for reps.
 */
function suggest(exercise: Resolved, last: { sets: LoggedSet[] } | null, range: { lo: number; hi: number } | null): Suggestion {
  const step = num(exercise.step) > 0 ? num(exercise.step) : 2.5;
  if (!last || last.sets.length === 0) return { kg: 0, reps: range?.lo ?? 0, why: "first", hit: [], step };
  const sets = working(last.sets);
  const hit = sets.map((s) => num(s.reps));
  const kg = Math.max(...sets.map((s) => num(s.kg)));
  const best = Math.max(...hit);
  if (range && sets.every((s) => num(s.reps) >= range.hi)) {
    return exercise.bodyweight ? { kg, reps: best + 1, why: "reps", hit, step } : { kg: kg + step, reps: range.lo, why: "up", hit, step };
  }
  if (!range) return { kg, reps: best + 1, why: "same", hit, step };
  return { kg, reps: Math.min(range.hi, best + 1), why: "reps", hit, step };
}

/** One broken record: which, and the number that broke it. */
interface Record_ {
  exercise: string;
  name: string;
  kind: "heaviest" | "e1rm" | "reps";
  value: number;
}

/**
 * The personal records in one workout's entries, against every earlier session. A loaded lift breaks
 * a record with its heaviest working set or its best estimated 1RM; a bodyweight lift with its most
 * reps. A first time is not a record: there is nothing to beat yet.
 */
function recordsIn(entries: readonly { exercise?: unknown; sets?: LoggedSet[] }[], earlier: readonly Resolved[], exercises: ReadonlyMap<string, Resolved>): Record_[] {
  const out: Record_[] = [];
  for (const entry of entries) {
    const id = refId(entry.exercise);
    const ex = id ? exercises.get(id) : undefined;
    if (!id || !ex) continue;
    const now = working(entry.sets ?? []);
    if (!now.length) continue;
    const before = earlier.flatMap((s) => working(setsIn(s, id) ?? []));
    if (!before.length) continue;
    const name = String(ex.name ?? "");
    if (ex.bodyweight) {
      const reps = Math.max(...now.map((s) => num(s.reps)));
      if (reps > Math.max(...before.map((s) => num(s.reps)))) out.push({ exercise: id, name, kind: "reps", value: reps });
      continue;
    }
    const heaviest = Math.max(...now.map((s) => num(s.kg)));
    if (heaviest > Math.max(...before.map((s) => num(s.kg)))) out.push({ exercise: id, name, kind: "heaviest", value: heaviest });
    const best = Math.max(...now.map((s) => e1rm(num(s.kg), num(s.reps))));
    if (best > Math.max(...before.map((s) => e1rm(num(s.kg), num(s.reps))))) out.push({ exercise: id, name, kind: "e1rm", value: best });
  }
  return out;
}

// ---- weeks start on Monday; a session belongs to the week its date falls in ----
const weekStart = (d: Date): number => {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return day.getTime() - ((day.getDay() + 6) % 7) * DAY;
};
/** The sessions of the week `back` weeks before this one. */
const inWeek = (rows: readonly Resolved[], now: Date, back: number): Resolved[] => {
  const from = weekStart(now) - back * WEEK;
  return rows.filter((s) => dateOf(s.date).getTime() >= from && dateOf(s.date).getTime() < from + WEEK);
};
const volume = (rows: readonly Resolved[]): number => rows.reduce((v, s) => v + num(s.totalVolume), 0);
const avgMinutes = (rows: readonly Resolved[]): number | null => {
  const timed = rows.filter((s) => num(s.durationSec) > 0);
  return timed.length ? Math.round(timed.reduce((n, s) => n + num(s.durationSec), 0) / timed.length / 60) : null;
};

/**
 * Weeks in a row with at least one session, counting back from this week — or from last week, so a
 * streak is not "broken" on a Monday morning before you have had the chance to train.
 */
function streak(sessions: readonly Resolved[], now: Date): number {
  let back = inWeek(sessions, now, 0).length ? 0 : 1;
  let n = 0;
  while (inWeek(sessions, now, back).length) {
    n += 1;
    back += 1;
  }
  return n;
}

/** Routines that take turns, in their order. A routine is "resting" when it is not in rotation. */
const rotationOf = (routines: readonly Resolved[]): Resolved[] =>
  routines
    .filter((r) => r.active !== false)
    .sort((a, b) => String(a.program ?? "").localeCompare(String(b.program ?? "")) || num(a.order) - num(b.order) || String(a.name).localeCompare(String(b.name)));

/**
 * What comes next: the routine after the one you did last, within its program. Nothing done yet →
 * the first one. A last routine that has since left the rotation → the first of the rotation.
 */
function nextRoutine(routines: readonly Resolved[], sessions: readonly Resolved[]): Resolved | undefined {
  const turn = rotationOf(routines);
  if (!turn.length) return undefined;
  const last = newestFirst(sessions).find((s) => refId(s.routine));
  const at = last ? turn.findIndex((r) => r.id === refId(last.routine)) : -1;
  if (at < 0) return turn[0];
  const program = String(turn[at]!.program ?? "");
  const same = turn.filter((r) => String(r.program ?? "") === program);
  return same[(same.findIndex((r) => r.id === turn[at]!.id) + 1) % same.length];
}

/** The last session of a routine. */
const lastOf = (sessions: readonly Resolved[], routineId: string): Resolved | undefined => newestFirst(sessions).find((s) => refId(s.routine) === routineId);

/** A routine's rows: exercise id, sets, rep range. */
const rowsOf = (routine: Resolved | undefined): { exercise: string; sets: number; reps: string }[] =>
  ((routine?.exercises as { exercise?: unknown; sets?: unknown; reps?: unknown }[] | undefined) ?? [])
    .map((r) => ({ exercise: refId(r.exercise) ?? "", sets: Math.max(1, num(r.sets) || 3), reps: String(r.reps ?? "") }))
    .filter((r) => r.exercise);

/** A training day of v1 in words: the same as the legacy `day` field's labels. */
const dayName = (d: unknown, ctx: Ctx): string => {
  if (d === "push") return ctx.t("Push");
  if (d === "pull") return ctx.t("Pull");
  if (d === "legs") return ctx.t("Legs");
  return String(d ?? "");
};
const LEGACY_DAYS = ["push", "pull", "legs"] as const;

/**
 * v1 kept the training day as an option on each exercise ("push"). v2 keeps routines as records. A
 * migration step works one record at a time and cannot make new ones, so the routines are made here,
 * by the app, the first time the Train screen opens on v1 data: one per day that has exercises, in
 * their old order, and every old session pointed at its day's routine. Nothing happens when there is
 * already a routine — so it runs once, and never on a device that started on v2.
 */
async function adoptLegacyDays(ctx: Ctx): Promise<boolean> {
  if ((await ctx.query("routine")).length > 0) return false;
  const exercises = (await ctx.query("exercise")).filter((e) => (LEGACY_DAYS as readonly string[]).includes(String(e.day)));
  if (!exercises.length) return false;
  const made = new Map<string, string>();
  let order = 0;
  for (const day of LEGACY_DAYS) {
    const mine = exercises.filter((e) => e.day === day).sort((a, b) => num(a.order) - num(b.order));
    if (!mine.length) continue;
    const routine = await ctx.create("routine", {
      name: dayName(day, ctx),
      program: "PPL",
      order: order++,
      active: true,
      exercises: mine.map((e) => ({ exercise: e.id, sets: num(e.targetSets) || 3, reps: String(e.repRange ?? "8–12") })),
    });
    made.set(day, routine.id);
  }
  for (const s of await ctx.query("session")) {
    const to = made.get(String(s.day));
    if (to && !refId(s.routine)) await ctx.patch("session", s.id, { routine: to });
  }
  return true;
}

const mmss = (total: number): string => `${Math.floor(Math.max(0, total) / 60)}:${String(Math.max(0, Math.round(total) % 60)).padStart(2, "0")}`;
const kgText = (ctx: Ctx, kg: number): string => ctx.format.number(kg, { maximumFractionDigits: 2 });

// ─────────────────────────────────────────────────────────────────────────────
// The Train screen — a custom view (full React). Three states: the plan (what is next), the workout
// (log sets against last time, rest between them), and the summary (what you just did, and broke).
// The workout in progress lives in ctx.storage, so leaving the tab — or the app — and coming back
// finds it exactly where it was. The rest between sets is a timer the SHELL keeps (`ctx.ui.timer`):
// its chip stays in sight on every page, it rings at the end with the phone locked, and this screen
// only draws it. While a workout is under way the screen stays on (`ctx.ui.keepAwake`).
// ─────────────────────────────────────────────────────────────────────────────

interface SetRow {
  kg: string;
  reps: string;
  done: boolean;
  kind: SetKind;
}

interface Active {
  routine: string;
  name: string;
  startedAt: string; // ISO
  order: string[]; // exercise ids, in the routine's order when it started
  plan: Record<string, SetRow[]>;
}

/** The rest timer's one id: a new rest restarts it rather than stacking a second (docs/04 §Timers). */
const REST_ID = "rest";

/** Milliseconds until a running timer's whole seconds change: the screen draws again exactly then. */
const toNextSecond = (t: UiTimer, now: number): number | null => {
  if (!t.endsAt) return null;
  const left = t.endsAt.getTime() - now;
  return left > 0 ? left % 1000 || 1000 : null;
};

interface Summary {
  name: string;
  durationSec: number;
  volume: number;
  sets: number;
  records: Record_[];
}

const KIND_NEXT: Record<SetKind, SetKind> = { work: "warmup", warmup: "drop", drop: "work" };

function Train(props: ViewProps) {
  const { runtime, navigate } = props;
  const ctx = runtime.ctx;
  const routinesQ = runtime.useQuery("routine");
  const sessionsQ = runtime.useQuery("session");

  const [active, setActive] = useState<Active | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // The shell's rest timer as last read: the shell keeps it, so this is only what to draw.
  const [rest, setRest] = useState<UiTimer | null>(null);
  const reading = useRef(false);
  const hydrated = useRef(false);
  const adopted = useRef(false);

  // v1 data: make its routines once (see adoptLegacyDays). Only asked when there are none at all.
  useEffect(() => {
    if (adopted.current || routinesQ.loading) return;
    adopted.current = true;
    if (routinesQ.rows.length === 0) void adoptLegacyDays(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routinesQ.loading]);

  // Rehydrate a workout in progress (survives tab switches and reloads).
  useEffect(() => {
    void Promise.all([ctx.storage.get<Active>("active"), ctx.storage.get<Summary>("summary")]).then(([saved, done]) => {
      if (saved?.startedAt && saved.plan) {
        setActive(saved);
        setOpenId(saved.order.find((id) => !(saved.plan[id] ?? []).every((r) => r.done)) ?? saved.order[0] ?? null);
      } else if (done) setSummary(done);
      hydrated.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    if (active) void ctx.storage.set("active", active);
    else void ctx.storage.delete("active");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // One clock for the workout and the rest: both are "now minus a moment", never a counter, so a
  // locked phone or a background tab comes back to the right numbers. The rest is read back from the
  // shell on each tick: paused, stopped or rung on its chip, this screen follows.
  const readRest = (): void => {
    if (reading.current) return;
    reading.current = true;
    void ctx.ui
      .timers()
      .then((all) => setRest(all.find((t) => t.id === REST_ID) ?? null))
      .catch(() => undefined)
      .finally(() => {
        reading.current = false;
      });
  };
  useEffect(() => {
    if (!active) return;
    readRest();
    const id = setInterval(() => {
      setNow(Date.now());
      readRest();
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  // The phone is on the bench between sets: while a workout is under way the screen stays on.
  const underWay = active != null;
  useEffect(() => {
    if (!underWay) return;
    const awake = ctx.ui.keepAwake();
    return () => awake.release();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [underWay]);
  // `secondsLeft` is the chip's own count, so the bar and the chip on History say the same second.
  const restLeft = rest ? rest.secondsLeft(now) : null;
  const restShown = rest != null && restLeft != null && restLeft > 0;
  // …and drawn again the moment that second changes, not on the 500 ms beat's own phase.
  const restTick = rest ? toNextSecond(rest, now) : null;
  useEffect(() => {
    if (restTick === null) return;
    const id = setTimeout(() => setNow(Date.now()), restTick + 4);
    return () => clearTimeout(id);
  }, [restTick, now]);
  // While a workout is under way this screen draws the rest itself (the bar, with +30s and skip), so
  // the shell's chip for it stays out of the way here — said before the rest starts, so the chip never
  // flashes up under the bar. It is back on History, and when the rest rings (its Done is the chip's).
  useEffect(() => {
    if (!underWay) return;
    const drawn = ctx.ui.drawsTimer(REST_ID);
    return () => drawn.release();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [underWay]);

  // The exercises this screen needs are the ones in routines and in sessions, which arrive with them
  // (a relation is read with its record): no third query, and none of an exercise's own figures,
  // which read its whole history and are for its page, not for this one.
  const exById = useMemo(() => {
    const m = new Map<string, Resolved>();
    const keep = (e: unknown): void => {
      if (e && typeof e === "object" && typeof (e as Resolved).id === "string") m.set((e as Resolved).id, e as Resolved);
    };
    for (const s of sessionsQ.rows) for (const entry of (s.entries as { exercise?: unknown }[] | undefined) ?? []) keep(entry.exercise);
    for (const r of routinesQ.rows) for (const row of (r.exercises as { exercise?: unknown }[] | undefined) ?? []) keep(row.exercise);
    return m;
  }, [routinesQ.rows, sessionsQ.rows]);
  const sessions = sessionsQ.rows;
  const next = useMemo(() => nextRoutine(routinesQ.rows, sessions), [routinesQ.rows, sessions]);
  const routine = routinesQ.rows.find((r) => r.id === chosen) ?? next;

  const say = {
    loading: ctx.t("Loading…"),
    reps: ctx.t("reps"),
  };
  if (routinesQ.loading || sessionsQ.loading) return <div className="wk-load">{say.loading}</div>;

  // ---------- SUMMARY ----------
  if (summary) {
    const done = (): void => {
      setSummary(null);
      void ctx.storage.delete("summary");
    };
    const share = (): void => {
      const lines = [
        `${summary.name} — ${ctx.format.number(Math.round(summary.durationSec / 60), { style: "unit", unit: "minute" })} · ${ctx.format.number(Math.round(summary.volume))} kg`,
        ...summary.records.map((r) => `🏆 ${r.name}: ${recordWords(r, ctx)}`),
      ];
      void ctx.ui.share({ title: summary.name, text: lines.join("\n") });
    };
    return (
      <div className="wk wk-summary">
        <style>{CSS}</style>
        <p className="wk-eyebrow">{ctx.t("Workout done")}</p>
        <h2 className="wk-huge">{summary.name}</h2>
        <dl className="wk-figures">
          <div>
            <dt>{ctx.t("Time")}</dt>
            <dd>{mmss(summary.durationSec)}</dd>
          </div>
          <div>
            <dt>{ctx.t("Volume")}</dt>
            <dd>
              {ctx.format.number(Math.round(summary.volume))}
              <small> kg</small>
            </dd>
          </div>
          <div>
            <dt>{ctx.t("Sets")}</dt>
            <dd>{summary.sets}</dd>
          </div>
        </dl>
        <h3 className="wk-label">
          {ctx.t(
            "{n, plural, =0 {No new records} one {# personal record} other {# personal records}}",
            { n: summary.records.length },
          )}
        </h3>
        {summary.records.length ? (
          <ul className="wk-prs">
            {summary.records.map((r, i) => (
              <li key={`${r.exercise}-${r.kind}`} style={{ animationDelay: `${120 + i * 90}ms` }}>
                <span aria-hidden="true">🏆</span>
                <strong>{r.name}</strong>
                <span>{recordWords(r, ctx)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="wk-quiet">
            {ctx.t("Showing up is the part that counts. The numbers follow.")}
          </p>
        )}
        <div className="wk-row">
          <button type="button" className="wk-ghost" onClick={share}>
            {ctx.t("Share")}
          </button>
          <button type="button" className="wk-go" onClick={done}>
            {ctx.t("Done")}
          </button>
        </div>
      </div>
    );
  }

  // ---------- PLAN ----------
  if (!active) {
    const turn = rotationOf(routinesQ.rows);
    const others = routinesQ.rows.filter((r) => r.id !== routine?.id).sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || num(a.order) - num(b.order));
    const rows = rowsOf(routine);
    const last = routine ? lastOf(sessions, routine.id) : undefined;
    const today = new Date(now);
    const monday = weekStart(today);
    const weekDays = Array.from({ length: 7 }, (_, i) => new Date(monday + i * DAY));
    const doneOn = new Set(inWeek(sessions, today, 0).map((s) => new Date(dateOf(s.date).getFullYear(), dateOf(s.date).getMonth(), dateOf(s.date).getDate()).getTime()));
    const weeks = streak(sessions, today);
    const totalSets = rows.reduce((n, r) => n + r.sets, 0);

    const start = (): void => {
      if (!routine) return;
      const plan: Record<string, SetRow[]> = {};
      for (const row of rows) {
        const ex = exById.get(row.exercise);
        if (!ex) continue;
        const s = suggest(ex, previous(sessions, row.exercise), repRange(row.reps || ex.repRange));
        plan[row.exercise] = Array.from({ length: row.sets }, () => ({
          kg: s.kg > 0 && !ex.bodyweight ? String(s.kg) : "",
          reps: s.reps > 0 ? String(s.reps) : "",
          done: false,
          kind: "work" as SetKind,
        }));
      }
      const order = rows.map((r) => r.exercise).filter((id) => plan[id]);
      setActive({ routine: routine.id, name: String(routine.name ?? ""), startedAt: new Date().toISOString(), order, plan });
      setOpenId(order[0] ?? null);
      setNow(Date.now());
    };

    return (
      <div className="wk wk-plan">
        <style>{CSS}</style>
        {routine ? (
          <section className="wk-hero" aria-labelledby="wk-next">
            <p className="wk-eyebrow">
              {routine.id === next?.id
                ? ctx.t("Next up")
                : ctx.t("Your pick")}
              {routine.program ? <span> · {String(routine.program)}</span> : null}
            </p>
            <h2 className="wk-huge" id="wk-next">
              {String(routine.name ?? "")}
            </h2>
            <p className="wk-meta">
              {last
                ? ctx.t(
                    "Last done {when}",
                    { when: ctx.format.relative(dateOf(last.date), { unit: "day" }) },
                  )
                : ctx.t("Not done yet")}
              {" · "}
              {ctx.t(
                "{n, plural, one {# exercise} other {# exercises}}, {sets, plural, one {# set} other {# sets}}",
                { n: rows.length, sets: totalSets },
              )}
            </p>
            <ol className="wk-preview">
              {rows.map((row) => {
                const ex = exById.get(row.exercise);
                if (!ex) return null;
                const prev = previous(sessions, row.exercise);
                const s = suggest(ex, prev, repRange(row.reps || ex.repRange));
                return (
                  <li key={row.exercise}>
                    <span className="wk-preview-name">{String(ex.name ?? "")}</span>
                    <span className="wk-preview-plan">
                      {row.sets} × {row.reps || String(ex.repRange ?? "")}
                    </span>
                    <span className="wk-preview-next" data-why={s.why}>
                      {targetWords(s, ex, ctx)}
                    </span>
                  </li>
                );
              })}
            </ol>
            <button type="button" className="wk-go wk-start-btn" onClick={start} disabled={rows.length === 0}>
              {ctx.t(
                "Start {name}",
                { name: String(routine.name ?? "") },
              )}
            </button>
          </section>
        ) : (
          <section className="wk-hero">
            <h2 className="wk-huge">{ctx.t("No routines yet")}</h2>
            <p className="wk-meta">
              {ctx.t("A routine is a list of exercises you do together. Make one on the Program tab.")}
            </p>
            <button type="button" className="wk-go" onClick={() => navigate("program")}>
              {ctx.t("Open Program")}
            </button>
          </section>
        )}

        <section className="wk-week" aria-label={ctx.t("This week")}>
          <ol className="wk-days">
            {weekDays.map((d) => (
              <li key={d.getTime()} data-done={doneOn.has(d.getTime()) || undefined} data-today={d.getTime() === new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() || undefined}>
                <span>{ctx.format.date(d, { weekday: "short" }).slice(0, 2)}</span>
                <i aria-hidden="true" />
              </li>
            ))}
          </ol>
          <p className="wk-streak">
            {weeks > 0
              ? ctx.t(
                  "🔥 {n, plural, one {# week in a row} other {# weeks in a row}}",
                  { n: weeks },
                )
              : ctx.t("Start a streak today")}
          </p>
        </section>

        {others.length ? (
          <section className="wk-others">
            <h3 className="wk-label">{ctx.t("Or train something else")}</h3>
            <div className="wk-chips">
              {others.map((r) => (
                <button key={r.id} type="button" className="wk-chip" data-resting={r.active === false || undefined} onClick={() => setChosen(r.id)}>
                  {String(r.name ?? "")}
                  {r.program && turn.every((t) => t.program !== r.program) ? <small> · {String(r.program)}</small> : null}
                </button>
              ))}
              {chosen ? (
                <button type="button" className="wk-chip wk-chip-back" onClick={() => setChosen(null)}>
                  ↺ {ctx.t("Back to next up")}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  // ---------- WORKOUT ----------
  const plan = active.plan;
  const elapsed = Math.floor((now - new Date(active.startedAt).getTime()) / 1000);
  const allRows = active.order.flatMap((id) => plan[id] ?? []);
  const setsDone = allRows.filter((r) => r.done).length;
  const setsTotal = allRows.length;

  const change = (exId: string, i: number, patch: Partial<SetRow>): void =>
    setActive((a) => (a ? { ...a, plan: { ...a.plan, [exId]: (a.plan[exId] ?? []).map((r, ri) => (ri === i ? { ...r, ...patch } : r)) } } : a));

  const restFor = (exId: string): number => {
    const ex = exById.get(exId);
    return num(ex?.restSec) > 0 ? Math.round(num(ex?.restSec)) : REST_SECONDS;
  };

  // The rest is the shell's timer: it rings at the end — with the phone locked too — so this screen
  // neither buzzes nor schedules a reminder of its own (one ring, not two). The same id restarts it.
  const startRest = (seconds: number): void => {
    void ctx.ui
      .timer({ label: ctx.t("Rest"), seconds, id: REST_ID })
      .then(setRest)
      .catch(() => undefined);
  };
  const cancelRest = (): void => {
    void rest?.cancel().catch(() => undefined);
    setRest(null);
  };

  const toggleDone = (exId: string, i: number): void => {
    const rows = (plan[exId] ?? []).map((r, ri) => (ri === i ? { ...r, done: !r.done } : r));
    const ticked = rows[i]!.done;
    if (ticked) {
      void ctx.caps.haptics?.vibrate(35); // set logged — quick tick
      // The rest this exercise asks for: a heavy squat and a cable fly do not want the same wait.
      const wait = rows[i]!.kind === "warmup" ? Math.min(60, restFor(exId)) : restFor(exId);
      startRest(wait);
      if (rows.every((r) => r.done)) {
        const nextEx = active.order.find((id) => id !== exId && !(plan[id] ?? []).every((r) => r.done));
        if (nextEx) setOpenId(nextEx);
      }
    }
    setActive({ ...active, plan: { ...plan, [exId]: rows } });
  };

  const addSet = (exId: string): void => {
    const rows = plan[exId] ?? [];
    const last = rows[rows.length - 1];
    setActive({ ...active, plan: { ...plan, [exId]: [...rows, { kg: last?.kg ?? "", reps: last?.reps ?? "", done: false, kind: "work" }] } });
  };

  const stop = (): void => {
    cancelRest();
    setActive(null);
    setOpenId(null);
  };

  const cancel = async (): Promise<void> => {
    const sure = await ctx.ui.confirm(
      ctx.t("Discard this workout?"),
      {
        detail: ctx.t("Nothing from it is saved."),
        ok: ctx.t("Discard"),
        destructive: true,
      },
    );
    if (sure) stop();
  };

  const finish = async (): Promise<void> => {
    // Finishing is a choice, not a reflex (#112): save it, keep going, or throw it away — the last
    // one set apart and in red by the sheet itself.
    const choice = await ctx.ui.sheet({
      title: ctx.t("Finish workout?"),
      items: [
        {
          id: "save",
          label: ctx.t("Save and finish"),
          detail: ctx.t(
            "{sets, plural, one {# set} other {# sets}} · {min} min",
            { sets: setsDone, min: Math.max(1, Math.round(elapsed / 60)) },
          ),
          icon: "check",
        },
        {
          id: "keep",
          label: ctx.t("Keep training"),
          icon: "rotate-ccw",
        },
        {
          id: "discard",
          label: ctx.t("Discard workout"),
          detail: ctx.t("Nothing from this workout is saved"),
          icon: "x",
          destructive: true,
        },
      ],
    });
    if (choice === "discard") return stop();
    if (choice !== "save") return;
    const entries = active.order
      .map((id) => ({
        exercise: id,
        sets: (plan[id] ?? [])
          .filter((r) => r.done && Number(r.reps) > 0)
          .map((r) => ({ kg: Number(r.kg) || 0, reps: Number(r.reps) || 0, ...(r.kind === "work" ? {} : { kind: r.kind }) })),
      }))
      .filter((en) => en.sets.length > 0);
    if (entries.length === 0) {
      ctx.ui.toast(
        ctx.t("Complete a set first"),
      );
      return;
    }
    const records = recordsIn(entries, sessions, exById);
    await runtime.create("session", { routine: active.routine, date: new Date(active.startedAt), durationSec: elapsed, entries, records: records.map((r) => ({ exercise: r.exercise, kind: r.kind, value: r.value })) });
    const done: Summary = {
      name: active.name,
      durationSec: elapsed,
      volume: entries.reduce((v, e) => v + working(e.sets).reduce((a, s) => a + num(s.kg) * num(s.reps), 0), 0),
      sets: entries.reduce((n, e) => n + e.sets.length, 0),
      records,
    };
    if (records.length) void ctx.caps.haptics?.vibrate([0, 60, 60, 60, 60, 160]);
    void ctx.storage.set("summary", done);
    stop();
    setChosen(null);
    setSummary(done);
  };

  const restRatio = restLeft != null && rest?.seconds ? Math.max(0, Math.min(1, restLeft / rest.seconds)) : 0;

  return (
    <div className="wk wk-active">
      <style>{CSS}</style>

      <header className="wk-top">
        <div className="wk-top-l">
          <span className="wk-top-name">{active.name}</span>
          <span className="wk-clock" role="timer">
            {mmss(elapsed)}
          </span>
        </div>
        <div className="wk-top-r">
          <span className="wk-top-prog">
            {setsDone}/{setsTotal}
          </span>
          <button
            type="button"
            className="wk-cancel"
            onClick={() => void cancel()}
            aria-label={ctx.t("Discard workout")}
          >
            ✕
          </button>
        </div>
        <i className="wk-top-bar" style={{ transform: `scaleX(${setsTotal ? setsDone / setsTotal : 0})` }} aria-hidden="true" />
      </header>

      <div className="wk-scroll">
        {active.order.map((id) => {
          const ex = exById.get(id);
          const rows = plan[id] ?? [];
          if (!ex) return null;
          const done = rows.length > 0 && rows.every((r) => r.done);
          const open = openId === id;
          const prev = previous(sessions, id, new Date(active.startedAt));
          const range = repRange(rowsOf(routinesQ.rows.find((r) => r.id === active.routine)).find((r) => r.exercise === id)?.reps || ex.repRange);
          const s = suggest(ex, prev, range);
          return (
            <section key={id} className="wk-ex" data-done={done || undefined} data-open={open || undefined}>
              <button type="button" className="wk-ex-head" aria-expanded={open} onClick={() => setOpenId(open ? null : id)}>
                <span className="wk-ex-name">{String(ex.name ?? "")}</span>
                <span className="wk-ex-meta">
                  {rows.filter((r) => r.done).length}/{rows.length}
                </span>
              </button>
              {open ? (
                <div className="wk-sets">
                  {s.why !== "first" ? <p className="wk-why" data-why={s.why}>{targetWords(s, ex, ctx)}</p> : null}
                  {ex.cue ? <p className="wk-cue">{String(ex.cue)}</p> : null}
                  <div className="wk-grid wk-grid-head" aria-hidden="true">
                    <span>{ctx.t("Set")}</span>
                    <span>{ctx.t("Previous")}</span>
                    <span>{ex.bodyweight ? "+kg" : "kg"}</span>
                    <span>{say.reps}</span>
                    <span />
                  </div>
                  {rows.map((r, i) => {
                    const p = prev?.sets[i];
                    const workIndex = rows.slice(0, i + 1).filter((x) => x.kind === "work").length;
                    return (
                      <div key={i} className="wk-grid wk-set" data-done={r.done || undefined} data-kind={r.kind}>
                        <button
                          type="button"
                          className="wk-set-n"
                          onClick={() => change(id, i, { kind: KIND_NEXT[r.kind] })}
                          aria-label={kindWords(r.kind, ctx)}
                          title={kindWords(r.kind, ctx)}
                        >
                          {r.kind === "warmup" ? "W" : r.kind === "drop" ? "D" : workIndex}
                        </button>
                        <span className="wk-prev">{p ? (ex.bodyweight && !num(p.kg) ? `${num(p.reps)}` : `${kgText(ctx, num(p.kg))} × ${num(p.reps)}`) : "—"}</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          aria-label={`${String(ex.name ?? "")} ${i + 1} kg`}
                          value={r.kg}
                          placeholder={p && !ex.bodyweight ? String(num(p.kg)) : ""}
                          onChange={(ev) => change(id, i, { kg: ev.target.value })}
                        />
                        <input
                          type="number"
                          inputMode="numeric"
                          aria-label={`${String(ex.name ?? "")} ${i + 1} ${say.reps}`}
                          value={r.reps}
                          placeholder={p ? String(num(p.reps)) : ""}
                          onChange={(ev) => change(id, i, { reps: ev.target.value })}
                        />
                        <button
                          type="button"
                          className="wk-check"
                          data-on={r.done || undefined}
                          onClick={() => toggleDone(id, i)}
                          aria-pressed={r.done}
                          aria-label={ctx.t("Complete set")}
                        >
                          ✓
                        </button>
                      </div>
                    );
                  })}
                  <button type="button" className="wk-addset" onClick={() => addSet(id)}>
                    {ctx.t("+ Add set")}
                  </button>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="wk-bar">
        {rest && restLeft != null && restShown ? (
          <div className="wk-rest" data-paused={rest.paused || undefined} role="timer" aria-label={ctx.t("Rest")}>
            <svg className="wk-ring" viewBox="0 0 44 44" aria-hidden="true">
              <circle cx="22" cy="22" r="19" />
              <circle cx="22" cy="22" r="19" style={{ strokeDashoffset: `${(1 - restRatio) * 119.4}` }} />
            </svg>
            <span className="wk-rest-n">{mmss(restLeft)}</span>
            <button type="button" onClick={() => startRest(restLeft + 30)}>
              +30s
            </button>
            <button type="button" onClick={cancelRest}>
              {ctx.t("skip")}
            </button>
          </div>
        ) : (
          <span className="wk-bar-hint">
            {ctx.t("Tap ✓ to log a set")}
          </span>
        )}
        <button type="button" className="wk-go wk-finish" onClick={() => void finish()}>
          {ctx.t("Finish")}
        </button>
      </div>
    </div>
  );
}

/** "+2.5 kg — you hit 12, 12, 12" and its siblings: the rule, said in the person's words. */
function targetWords(s: Suggestion, ex: Resolved, ctx: Ctx): string {
  const hit = s.hit.join(", ");
  if (s.why === "first")
    return ctx.t("First time — find your weight");
  if (s.why === "up")
    return ctx.t(
      "{kg} kg today: +{step} kg, you hit {hit}",
      { kg: kgText(ctx, s.kg), step: kgText(ctx, s.step), hit },
    );
  if (ex.bodyweight)
    return ctx.t(
      "Aim for {reps}: last time {hit}",
      { reps: s.reps, hit },
    );
  return ctx.t(
    "{kg} kg × {reps}: beat {hit}",
    { kg: kgText(ctx, s.kg), reps: s.reps, hit },
  );
}

function kindWords(kind: SetKind, ctx: Ctx): string {
  if (kind === "warmup") return ctx.t("Warm-up set: tap for a drop set");
  if (kind === "drop") return ctx.t("Drop set: tap for a work set");
  return ctx.t("Work set: tap for a warm-up");
}

function recordWords(r: Record_, ctx: Ctx): string {
  if (r.kind === "reps")
    return ctx.t(
      "{n} reps, most ever",
      { n: r.value },
    );
  if (r.kind === "heaviest")
    return ctx.t(
      "{kg} kg, heaviest yet",
      { kg: kgText(ctx, r.value) },
    );
  return ctx.t(
    "{kg} kg estimated 1RM",
    { kg: kgText(ctx, r.value) },
  );
}

// Athletic dark: the screen you read between sets, from a metre away, with chalk on your hands. A
// near-black surface in either theme, one electric accent, numbers big and tabular, every control a
// thumb's width. Motion only on transform/opacity, and none at all when the person asks for less.
const CSS = `
.wk { --wk-bg:#0d0f12; --wk-raised:#171a1f; --wk-line:#2a2f37; --wk-ink:#f2f4f0; --wk-soft:#9aa3ad; --wk-hot:#c4f23a; --wk-hot-ink:#0d0f12; --wk-gold:#f5c443; --wk-ok:#3ddc84;
  color:var(--wk-ink); font-variant-numeric: tabular-nums; }
.wk, .wk * { box-sizing:border-box; }
.wk input, .wk button { font:inherit; font-size:16px; } /* 16px prevents iOS zoom */
.wk-load { padding:2rem; color:var(--ink-soft,#888); }
.wk-plan, .wk-summary { display:flex; flex-direction:column; gap:14px; max-width:560px; margin:0 auto; }
.wk-hero, .wk-week, .wk-others, .wk-summary { background:var(--wk-bg); border-radius:22px; padding:22px 20px; box-shadow:0 18px 40px -24px rgba(0,0,0,.55); }
.wk-hero { position:relative; overflow:hidden; background:
  radial-gradient(120% 80% at 100% 0%, color-mix(in oklab, var(--wk-hot) 22%, transparent), transparent 60%), var(--wk-bg); }
.wk-eyebrow { margin:0; text-transform:uppercase; letter-spacing:.14em; font-size:.75rem; font-weight:700; color:var(--wk-hot); }
.wk-eyebrow span { color:var(--wk-soft); }
.wk-huge { margin:.2rem 0 .3rem; font-family:var(--font-ui, system-ui); font-stretch:condensed; font-weight:850; text-transform:uppercase; letter-spacing:-.02em; line-height:.95; font-size:clamp(2.6rem, 11vw, 3.6rem); }
.wk-meta { margin:0 0 14px; color:var(--wk-soft); font-size:.95rem; }
.wk-label { margin:0 0 10px; font-size:.75rem; text-transform:uppercase; letter-spacing:.14em; color:var(--wk-soft); font-weight:700; }
.wk-preview { list-style:none; margin:0 0 18px; padding:0; display:grid; gap:2px; }
.wk-preview li { display:grid; grid-template-columns:1fr auto; gap:2px 12px; padding:10px 0; border-top:1px solid var(--wk-line); }
.wk-preview-name { font-weight:700; }
.wk-preview-plan { color:var(--wk-soft); text-align:right; }
.wk-preview-next { grid-column:1 / -1; font-size:.85rem; color:var(--wk-soft); }
.wk-preview-next[data-why="up"] { color:var(--wk-hot); }
.wk-go { min-height:56px; padding:0 1.6rem; border:0; border-radius:16px; background:var(--wk-hot); color:var(--wk-hot-ink); font-weight:850; font-size:1.05rem; letter-spacing:.01em; cursor:pointer;
  transition: transform .12s ease, filter .12s ease; }
.wk-go:hover { filter:brightness(1.06); }
.wk-go:active { transform:scale(.97); }
.wk-go:focus-visible, .wk-ghost:focus-visible, .wk-chip:focus-visible, .wk-check:focus-visible, .wk-set-n:focus-visible { outline:3px solid color-mix(in oklab, var(--wk-hot) 70%, white); outline-offset:2px; }
.wk-go:disabled { opacity:.4; }
.wk-start-btn { width:100%; }
.wk-ghost { min-height:56px; padding:0 1.4rem; border-radius:16px; border:1px solid var(--wk-line); background:transparent; color:var(--wk-ink); font-weight:700; cursor:pointer; }
.wk-row { display:flex; gap:10px; justify-content:flex-end; }
.wk-row .wk-go { flex:1; }
.wk-week { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; padding:16px 18px; }
.wk-days { list-style:none; margin:0; padding:0; display:flex; gap:10px; }
.wk-days li { display:flex; flex-direction:column; align-items:center; gap:6px; font-size:.72rem; color:var(--wk-soft); text-transform:uppercase; }
.wk-days i { width:12px; height:12px; border-radius:50%; border:2px solid var(--wk-line); }
.wk-days li[data-done] i { background:var(--wk-hot); border-color:var(--wk-hot); }
.wk-days li[data-today] span { color:var(--wk-ink); font-weight:800; }
.wk-streak { margin:0; font-weight:800; }
.wk-chips { display:flex; flex-wrap:wrap; gap:8px; }
.wk-chip { min-height:44px; padding:0 16px; border-radius:999px; border:1px solid var(--wk-line); background:var(--wk-raised); color:var(--wk-ink); font-weight:700; cursor:pointer; }
.wk-chip:hover { border-color:var(--wk-hot); }
.wk-chip[data-resting] { color:var(--wk-soft); }
.wk-chip small { font-weight:500; color:var(--wk-soft); }
.wk-chip-back { background:transparent; }

/* ---- the workout ---- */
.wk-active { background:var(--wk-bg); border-radius:22px; padding:0 12px 120px; min-height:70vh; }
.wk-top { position:sticky; top:0; z-index:5; display:flex; align-items:center; justify-content:space-between; padding:14px 6px; background:color-mix(in oklab, var(--wk-bg) 92%, transparent); backdrop-filter:blur(8px); }
.wk-top-l { display:flex; align-items:baseline; gap:12px; min-width:0; }
.wk-top-name { font-stretch:condensed; font-weight:850; text-transform:uppercase; font-size:1.25rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.wk-clock { color:var(--wk-hot); font-weight:800; font-size:1.25rem; }
.wk-top-r { display:flex; align-items:center; gap:10px; }
.wk-top-prog { color:var(--wk-soft); font-weight:700; }
.wk-cancel { width:40px; height:40px; border-radius:999px; border:1px solid var(--wk-line); background:transparent; color:var(--wk-soft); cursor:pointer; }
.wk-top-bar { position:absolute; left:0; right:0; bottom:0; height:3px; background:var(--wk-hot); transform-origin:left; transition:transform .3s ease; }
.wk-scroll { display:flex; flex-direction:column; gap:10px; padding-top:8px; }
.wk-ex { border-radius:16px; background:var(--wk-raised); border:1px solid var(--wk-line); overflow:hidden; }
.wk-ex[data-done] { border-color:color-mix(in oklab, var(--wk-ok) 50%, var(--wk-line)); }
.wk-ex[data-done] .wk-ex-name::before { content:"✓ "; color:var(--wk-ok); }
.wk-ex-head { width:100%; display:flex; justify-content:space-between; align-items:center; gap:8px; padding:16px; min-height:56px; border:0; background:transparent; color:inherit; text-align:left; cursor:pointer; }
.wk-ex-name { font-stretch:condensed; font-weight:850; text-transform:uppercase; letter-spacing:.01em; font-size:1.1rem; }
.wk-ex-meta { color:var(--wk-soft); font-weight:700; }
.wk-sets { display:flex; flex-direction:column; gap:6px; padding:0 12px 14px; }
.wk-why { margin:0 4px 4px; font-size:.9rem; color:var(--wk-soft); }
.wk-why[data-why="up"] { color:var(--wk-hot); font-weight:700; }
.wk-cue { margin:0 4px 6px; font-size:.85rem; color:var(--wk-soft); font-style:italic; }
.wk-grid { display:grid; grid-template-columns:40px minmax(64px, 1fr) minmax(56px, 1fr) minmax(52px, .9fr) 56px; align-items:center; gap:8px; }
.wk-grid-head { padding:0 4px; font-size:.7rem; text-transform:uppercase; letter-spacing:.1em; color:var(--wk-soft); }
.wk-grid-head span:nth-child(n+3) { text-align:center; }
.wk-set { padding:4px; border-radius:12px; transition:background-color .2s ease; }
.wk-set[data-done] { background:color-mix(in oklab, var(--wk-ok) 16%, transparent); }
.wk-set-n { height:40px; border-radius:10px; border:0; background:transparent; color:var(--wk-soft); font-weight:800; cursor:pointer; }
.wk-set[data-kind="warmup"] .wk-set-n { color:var(--wk-gold); }
.wk-set[data-kind="drop"] .wk-set-n { color:#ff8a6b; }
.wk-prev { color:var(--wk-soft); font-size:.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.wk-set input { width:100%; min-width:0; height:48px; text-align:center; border:1px solid var(--wk-line); border-radius:12px; background:var(--wk-bg); color:var(--wk-ink); font-weight:800; font-size:1.1rem; }
.wk-set input::placeholder { color:color-mix(in oklab, var(--wk-soft) 55%, transparent); }
.wk-set input:focus { outline:2px solid var(--wk-hot); outline-offset:0; }
.wk-check { width:56px; height:48px; border-radius:12px; border:2px solid var(--wk-line); background:transparent; color:color-mix(in oklab, var(--wk-soft) 45%, transparent); font-size:1.4rem; font-weight:900; cursor:pointer; transition:transform .12s ease, background-color .12s ease; }
.wk-check:active { transform:scale(.92); }
.wk-check[data-on] { background:var(--wk-ok); border-color:var(--wk-ok); color:var(--wk-hot-ink); }
.wk-addset { align-self:flex-start; margin-top:4px; min-height:40px; border:1px dashed var(--wk-line); background:transparent; color:var(--wk-soft); border-radius:12px; padding:0 14px; cursor:pointer; }
.wk-bar { position:fixed; left:50%; transform:translateX(-50%); bottom:var(--k-chrome-bottom, 0px); width:min(860px, 100%); display:flex; align-items:center; gap:10px; padding:12px 16px calc(12px + var(--k-safe-bottom, env(safe-area-inset-bottom))); background:var(--wk-bg); border-top:1px solid var(--wk-line); z-index:20; color:var(--wk-ink); }
.wk-bar-hint { color:var(--wk-soft); font-size:.9rem; }
.wk-rest { display:flex; align-items:center; gap:10px; }
.wk-ring { width:44px; height:44px; transform:rotate(-90deg); }
.wk-ring circle { fill:none; stroke-width:4; stroke:var(--wk-line); }
.wk-ring circle + circle { stroke:var(--wk-hot); stroke-dasharray:119.4; stroke-linecap:round; transition:stroke-dashoffset .5s linear; }
.wk-rest-n { font-size:1.5rem; font-weight:850; color:var(--wk-hot); min-width:3.2ch; }
.wk-rest button { min-height:40px; border:1px solid var(--wk-line); background:transparent; color:var(--wk-ink); border-radius:10px; padding:0 .7rem; cursor:pointer; }
.wk-finish { margin-left:auto; }

/* ---- the summary ---- */
.wk-summary { background:
  radial-gradient(90% 60% at 0% 0%, color-mix(in oklab, var(--wk-gold) 20%, transparent), transparent 65%), var(--wk-bg); }
.wk-figures { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin:6px 0 10px; }
.wk-figures div { background:var(--wk-raised); border-radius:14px; padding:12px; }
.wk-figures dt { font-size:.7rem; text-transform:uppercase; letter-spacing:.12em; color:var(--wk-soft); }
.wk-figures dd { margin:4px 0 0; font-size:1.6rem; font-weight:850; }
.wk-figures small { font-size:.9rem; color:var(--wk-soft); }
.wk-prs { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
.wk-prs li { display:grid; grid-template-columns:auto 1fr; gap:2px 12px; align-items:center; padding:12px 14px; border-radius:14px; background:color-mix(in oklab, var(--wk-gold) 14%, var(--wk-raised)); border:1px solid color-mix(in oklab, var(--wk-gold) 45%, transparent);
  animation: wk-pr .7s cubic-bezier(.16,1,.3,1) both; }
.wk-prs li > span:first-child { grid-row:span 2; font-size:1.6rem; }
.wk-prs li span:last-child { color:var(--wk-gold); font-weight:700; }
.wk-quiet { margin:0; color:var(--wk-soft); }
@keyframes wk-pr { 0% { opacity:0; transform:translateY(10px) scale(.96); } 60% { opacity:1; transform:translateY(0) scale(1.02); } 100% { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce) { .wk-prs li { animation:none; } .wk-go, .wk-check, .wk-top-bar, .wk-ring circle + circle { transition:none; } }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Words shared by several places.
// ─────────────────────────────────────────────────────────────────────────────

const MUSCLES = ["chest", "back", "shoulders", "biceps", "triceps", "quads", "hamstrings", "glutes", "calves", "core"] as const;

export default defineApp({
  id: "workout",
  name: "Workout",
  icon: "dumbbell",
  version: "2.0.0",
  // Routines became records and the training day an old field (2.0.0): the records change shape.
  schemaVersion: 2,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  // No picture behind the pages: the gym photos are for a record that is about a kind of lifting
  // (an exercise, a routine), each by what it works. Train has its own dark panel.
  theme: { accent: "#B6E62E" },
  category: "everyday",
  // The launcher tile (docs/04 §Tile): what is next, when you last trained, and the streak.
  tile: async (ctx) => {
    const sessions = await ctx.query("session");
    const next = nextRoutine(await ctx.query("routine"), sessions);
    const last = newestFirst(sessions)[0];
    const weeks = streak(sessions, ctx.now());
    if (!next && !last) return {};
    return {
      count: inWeek(sessions, ctx.now(), 0).length,
      title: next
        ? ctx.t("{name} next", { name: String(next.name ?? "") })
        : "",
      lines: [
        last
          ? ctx.t("Last: {when}", { when: ctx.format.relative(dateOf(last.date), { unit: "day" }) })
          : "",
        weeks > 0
          ? ctx.t(
              "Streak: {n, plural, one {# week} other {# weeks}}",
              { n: weeks },
            )
          : "",
      ].filter(Boolean),
    };
  },
  // Buzz on a set and on a record. The rest's ring is the shell's timer, which needs no permission.
  permissions: { haptics: true },
  nav: "tabs",

  quickActions: [
    {
      id: "new-routine",
      label: "New routine",
      icon: "plus",
      entity: "routine",
      mode: "form",
    },
    {
      id: "new-exercise",
      label: "New exercise",
      icon: "plus",
      entity: "exercise",
    },
  ],

  entities: {
    // ---- a ROUTINE: the exercises you do together, taking turns with the others in its program ----
    routine: {
      label: "Routine",
      icon: "clipboard-list",
      displayField: "name",
      fields: {
        name: {
          type: "text",
          required: true,
          label: "Name",
          placeholder: "Push A",
        },
        program: {
          type: "text",
          label: "Program",
          placeholder: "PPL",
          help: "Routines in the same program take turns",
          width: "half",
        },
        order: {
          type: "number",
          integer: true,
          default: 0,
          width: "half",
          label: "Turn",
        },
        active: {
          type: "boolean",
          default: true,
          label: "In rotation",
          help: "Off: kept, but never suggested as next",
        },
        exercises: {
          type: "list",
          ordered: true,
          label: "Exercises",
          of: {
            exercise: {
              type: "relation",
              to: "exercise",
              required: true,
              label: "Exercise",
            },
            sets: {
              type: "number",
              integer: true,
              min: 1,
              default: 3,
              label: "Sets",
            },
            reps: {
              type: "text",
              default: "8–12",
              label: "Reps",
            },
          },
        },
        note: { type: "text", multiline: true, label: "Note" },
      },
      groups: [
        { title: "Routine", fields: ["name", "program", "order", "active"] },
        { title: "Exercises", fields: ["exercises"] },
        { title: "More", fields: ["note"], collapsed: true },
      ],
      computed: {
        /** The picture on its page: what most of its exercises work — pressing, pulling or legs. */
        art: {
          label: "Picture",
          value: (r) =>
          artFor(
            ((r.exercises as { exercise?: { muscles?: unknown[] } | string | null }[] | undefined) ?? []).flatMap((row) =>
              row.exercise && typeof row.exercise === "object" ? (row.exercise.muscles ?? []) : [],
            ),
          ),
        },
        summary: {
          label: "Plan",
          value: (r, ctx) => {
            const rows = rowsOf(r);
            return ctx.t(
              "{n, plural, one {# exercise} other {# exercises}} · {sets, plural, one {# set} other {# sets}}",
              { n: rows.length, sets: rows.reduce((n, x) => n + x.sets, 0) },
            );
          },
        },
        lastDone: {
          label: "Last done",
          value: async (r, ctx) => {
            const last = lastOf(await ctx.query("session"), r.id);
            return last ? ctx.format.relative(dateOf(last.date), { unit: "day" }) : "—";
          },
        },
      },
    },

    // ---- an EXERCISE: the movement, and how you progress on it ----
    exercise: {
      label: "Exercise",
      icon: "biceps-flexed",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: "Name" },
        muscles: {
          type: "tags",
          options: ["chest", "back", "shoulders", "biceps", "triceps", "quads", "hamstrings", "glutes", "calves", "core"],
          label: "Muscles",
          labels: {
            chest: "chest",
            back: "back",
            shoulders: "shoulders",
            biceps: "biceps",
            triceps: "triceps",
            quads: "quads",
            hamstrings: "hamstrings",
            glutes: "glutes",
            calves: "calves",
            core: "core",
          },
        },
        repRange: {
          type: "text",
          default: "8–12",
          width: "half",
          label: "Rep range",
          help: "Reach the top on every set and the weight goes up",
        },
        step: {
          type: "number",
          min: 0,
          default: 2.5,
          step: 0.5,
          unit: "kg",
          width: "half",
          label: "Add each time",
        },
        restSec: {
          type: "duration",
          label: "Rest",
          unit: "s",
          default: 90,
          help: "Counted down after each set; you can always skip it",
        },
        bodyweight: {
          type: "boolean",
          default: false,
          label: "Bodyweight",
          help: "Progress on reps; kg is anything you add",
        },
        cue: {
          type: "text",
          multiline: true,
          label: "Cue",
          placeholder: "Elbows 45°, bar to mid-chest",
        },
        // ---- v1: the training day, its place in it, and its sets. Kept so old records read, hidden
        // because routines say all three now. `adoptLegacyDays` turns them into routines. ----
        day: {
          type: "enum",
          options: ["push", "pull", "legs"],
          hidden: true,
          label: "Day",
          labels: {
            push: "push",
            pull: "pull",
            legs: "legs",
          },
        },
        order: { type: "number", integer: true, hidden: true, label: "Order" },
        targetSets: { type: "number", integer: true, hidden: true, label: "Target sets" },
      },
      groups: [
        { title: "Exercise", fields: ["name", "muscles", "bodyweight"] },
        { title: "Progression", fields: ["repRange", "step", "restSec"] },
        { title: "Notes", fields: ["cue"] },
      ],
      computed: {
        /** The picture on its page: pressing, pulling or legs, from its muscles. */
        art: { label: "Picture", value: (e) => artFor((e.muscles as unknown[] | undefined) ?? []) },
        // ASYNC computed that reads history, ONCE: every session this exercise was in, newest first,
        // as its date and working sets. The values below are worked out from it, so an exercise
        // costs one query rather than one per figure.
        history: {
          label: "History",
          value: async (e, ctx) =>
          newestFirst(await ctx.query("session"))
            .map((s) => ({ date: dateOf(s.date).toISOString(), sets: working(setsIn(s, e.id) ?? []).map((x) => ({ kg: num(x.kg), reps: num(x.reps) })) }))
            .filter((h) => h.sets.length > 0),
        },
        // The best set of the last N sessions that had this exercise.
        lastBest: {
          label: "Rolling best",
          // The best set is an object (the Train screen reads it), so the page says it through a
          // message over its kg and reps; a bodyweight set has no weight (0).
          format: "{kg, plural, =0 {{reps} reps} other {{kg, number} kg × {reps}}}",
          value: (e) => {
            let best: { kg: number; reps: number; score: number } | null = null;
            for (const h of ((e.history as History | undefined) ?? []).slice(0, LOOKBACK)) {
              for (const set of h.sets) {
                const score = setScore(Boolean(e.bodyweight), set);
                if (score > 0 && (!best || score > best.score)) best = { kg: set.kg, reps: set.reps, score };
              }
            }
            return best;
          },
        },
        // Estimated 1RM per session (reps, for a bodyweight lift), oldest first: the chart on its page.
        progress: {
          label: "Estimated 1RM per session",
          value: (e) =>
          [...((e.history as History | undefined) ?? [])]
            .reverse()
            .map((h) => ({ date: h.date, value: Math.max(0, ...h.sets.map((x) => (e.bodyweight ? x.reps : e1rm(x.kg, x.reps)))) }))
            .filter((p) => p.value > 0),
        },
        best: {
          label: "Best estimated 1RM",
          value: (e, ctx) => {
            if (e.bodyweight) return "—";
            const top = Math.max(0, ...((e.history as History | undefined) ?? []).flatMap((h) => h.sets.map((x) => e1rm(x.kg, x.reps))));
            return top > 0 ? `${kgText(ctx, top)} kg` : "—";
          },
        },
      },
    },

    // ---- HISTORY: each finished workout is one record, with nested lists inside ----
    session: {
      label: "Session",
      icon: "dumbbell",
      displayField: "label",
      fields: {
        routine: {
          type: "relation",
          to: "routine",
          label: "Routine",
        },
        date: {
          type: "datetime",
          precision: "minute",
          required: true,
          default: (ctx) => ctx.now(),
          label: "Date",
        },
        durationSec: { type: "number", hidden: true, label: "Duration (seconds)" },
        entries: {
          type: "list",
          label: "Entries",
          of: {
            exercise: {
              type: "relation",
              to: "exercise",
              required: true,
              label: "Exercise",
            },
            sets: {
              // NESTED list: a list field whose rows contain another list field
              type: "list",
              ordered: true,
              label: "Sets",
              of: {
                kg: { type: "number", unit: "kg", min: 0, label: "Kg" }, // a unit, the same in every language
                reps: {
                  type: "number",
                  min: 0,
                  integer: true,
                  label: "Reps",
                },
                kind: {
                  type: "enum",
                  options: ["warmup", "drop"],
                  label: "Kind",
                  labels: {
                    warmup: "warm-up",
                    drop: "drop",
                  },
                },
              },
            },
          },
        },
        // The personal records it broke, worked out when it was finished — a fact about that day, so a
        // later edit to an older session does not quietly rewrite it.
        records: {
          type: "list",
          hidden: true,
          label: "Personal records",
          of: {
            exercise: { type: "relation", to: "exercise", label: "Exercise" },
            kind: {
              type: "enum",
              options: ["heaviest", "e1rm", "reps"],
              label: "Record",
              labels: {
                heaviest: "heaviest",
                e1rm: "estimated 1RM",
                reps: "most reps",
              },
            },
            value: { type: "number", min: 0, label: "Value" },
          },
        },
        note: { type: "text", multiline: true, label: "Note" },
        // ---- v1: which training day it was. Kept so old sessions still say "Push"; the Train
        // screen points them at their routine the first time it opens (`adoptLegacyDays`). ----
        day: {
          type: "enum",
          options: ["push", "pull", "legs"],
          hidden: true,
          colors: { push: "red", pull: "blue", legs: "green" },
          label: "Day",
          labels: {
            push: "push",
            pull: "pull",
            legs: "legs",
          },
        },
      },
      computed: {
        // The routine's name; an old session that has none yet says its day; the date as the person's calendar writes it.
        title: {
          label: "Routine",
          value: (s, ctx) => String(s.routine?.name ?? "") || dayName(s.day, ctx) || ctx.t("Workout"),
        },
        label: {
          label: "Session",
          value: (s, ctx) =>
          `${String(s.routine?.name ?? "") || dayName(s.day, ctx) || ctx.t("Workout")} · ${ctx.format.date(dateOf(s.date), { weekday: "short", day: "numeric", month: "short" })}`,
        },
        duration: {
          label: "Duration",
          value: (s, ctx) => (num(s.durationSec) ? ctx.format.number(Math.round(num(s.durationSec) / 60), { style: "unit", unit: "minute" }) : "—"),
        },
        totalSets: {
          label: "Total sets",
          value: (s) => ((s.entries as { sets?: unknown[] }[] | undefined) ?? []).reduce((n, e) => n + (e.sets?.length ?? 0), 0),
        },
        totalVolume: {
          label: "Total volume (kg)",
          value: (s) =>
            ((s.entries as { sets?: LoggedSet[] }[] | undefined) ?? []).reduce((v, e) => v + working(e.sets ?? []).reduce((a, x) => a + num(x.kg) * num(x.reps), 0), 0),
        },
        /** The records it broke, as the summary said them: "🏆 Bench Press: 67.5 kg, heaviest yet". */
        prs: {
          label: "Personal records",
          value: (s, ctx) =>
            ((s.records as { exercise?: { name?: string } | string | null; kind?: Record_["kind"]; value?: number }[] | undefined) ?? [])
              .map((r) => {
                const name = typeof r.exercise === "object" && r.exercise ? String(r.exercise.name ?? "") : "";
                return name ? `🏆 ${name}: ${recordWords({ exercise: "", name, kind: r.kind ?? "heaviest", value: num(r.value) }, ctx)}` : "";
              })
              .filter(Boolean)
              .join(" · ") || "—",
        },
      },
      actions: {
        // One set, asked for in one form (#112): which exercise, how heavy, how many. It starts from
        // this session's last set, so the common case — the same again — is one tap.
        logSet: {
          label: "Log Set",
          icon: "plus",
          run: async (s, ctx) => {
            // An entry whose exercise was deleted cannot be written back (its exercise is required);
            // the session keeps the rest.
            const entries = ((s.entries as { exercise?: unknown; sets?: LoggedSet[] }[] | undefined) ?? [])
              .map((e) => ({ exercise: refId(e.exercise), sets: [...(e.sets ?? [])] }))
              .filter((e) => e.exercise !== undefined);
            const last = entries[entries.length - 1];
            const lastSet = last?.sets[last.sets.length - 1];
            const logSet = ctx.t("Log set");
            const set = await ctx.ui.form<{ exercise: string; kg: number; reps: number }>({
              title: logSet,
              submit: logSet,
              fields: {
                exercise: {
                  type: "relation",
                  to: "exercise",
                  required: true,
                  label: ctx.t("Exercise"),
                },
                kg: { type: "number", label: ctx.t("Weight"), unit: "kg", min: 0 },
                reps: {
                  type: "number",
                  integer: true,
                  min: 0,
                  required: true,
                  label: ctx.t("Reps"),
                },
              },
              initial: { exercise: last?.exercise, kg: lastSet?.kg, reps: lastSet?.reps },
            });
            if (!set) return;
            const entry = entries.find((e) => e.exercise === set.exercise);
            const row = { kg: set.kg ?? 0, reps: set.reps };
            if (entry) entry.sets.push(row);
            else entries.push({ exercise: set.exercise, sets: [row] });
            await ctx.patch("session", s.id, { entries });
            ctx.ui.toast(
              ctx.t(
                "Logged {kg} kg × {reps}",
                { kg: row.kg, reps: row.reps },
              ),
            );
          },
        },
      },
    },
  },

  pages: [
    {
      // The live workout screen — bespoke logic, so it's a custom view (full React component).
      id: "train",
      title: "Train",
      icon: "dumbbell",
      view: {
        type: "custom",
        entity: "session",
        render: (props) => <Train {...props} />,
      },
    },
    {
      id: "history",
      title: "History",
      icon: "calendar",
      view: {
        type: "timeline",
        entity: "session",
        date: "date",
        groupBy: "week",
        display: {
          primary: "title",
          secondary: (s, ctx) => {
            const line = ctx.t(
              "{sets, plural, one {# set} other {# sets}} · {volume} kg · {duration}",
              // "1,410" in English, "1410" in Polish: the person's own way of writing a number.
              { sets: num(s.totalSets), volume: ctx.format.number(Math.round(num(s.totalVolume))), duration: String(s.duration) },
            );
            const prs = ((s.records as unknown[] | undefined) ?? []).length;
            return prs
              ? `${line} · ${ctx.t("🏆 {n}", { n: prs })}`
              : line;
          },
        },
        onOpen: { page: "session", param: { sessionId: "id" } },
        emptyText: "No sessions logged yet. Hit Train to start one.",
      },
    },
    {
      id: "progress",
      title: "Progress",
      icon: "trending-up",
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "stats",
              entity: "session",
              items: [
                {
                  label: "Sessions this week",
                  value: (rows, ctx) => inWeek(rows, ctx.now(), 0).length,
                  compare: {
                    value: (rows, ctx) => inWeek(rows, ctx.now(), 1).length,
                    label: "last week",
                  },
                },
                {
                  label: "Volume this week",
                  unit: "kg",
                  value: (rows, ctx) => volume(inWeek(rows, ctx.now(), 0)),
                  compare: {
                    value: (rows, ctx) => volume(inWeek(rows, ctx.now(), 1)),
                    label: "last week",
                    as: "percent",
                  },
                },
                {
                  label: "Average session",
                  unit: "min",
                  value: (rows, ctx) => avgMinutes(inWeek(rows, ctx.now(), 0)),
                  compare: {
                    value: (rows, ctx) => avgMinutes(inWeek(rows, ctx.now(), 1)),
                    label: "last week",
                  },
                },
                {
                  label: "Weeks in a row",
                  value: (rows, ctx) => streak(rows, ctx.now()),
                },
              ],
            },
          },
          {
            view: {
              type: "chart",
              entity: "session",
              title: "Sessions per week",
              subtitle: "Last 8 weeks",
              series: (rows, ctx) =>
                [7, 6, 5, 4, 3, 2, 1, 0].map((back) => {
                  const d = new Date(weekStart(ctx.now()) - back * WEEK);
                  const n = inWeek(rows, ctx.now(), back).length;
                  return {
                    // "Jul 20" in American English, "20 lip" in Polish: the person's calendar.
                    label: ctx.format.date(d, { day: "numeric", month: "short" }),
                    value: n,
                    text: ctx.t(
                      "{n, plural, one {# session} other {# sessions}}",
                      { n },
                    ),
                  };
                }),
            },
          },
          {
            // Sets per muscle this week: which parts of you the week has worked, and which it has not.
            // A count, not a recovery score: nobody can read fatigue off a log.
            view: {
              type: "chart",
              entity: "session",
              title: "Sets per muscle",
              subtitle: "This week",
              series: async (rows, ctx) => {
                const exercises = new Map((await ctx.query("exercise")).map((e) => [e.id, e] as const));
                const count = new Map<string, number>(MUSCLES.map((m) => [m, 0]));
                for (const s of inWeek(rows, ctx.now(), 0))
                  for (const entry of (s.entries as { exercise?: unknown; sets?: LoggedSet[] }[] | undefined) ?? []) {
                    const ex = exercises.get(refId(entry.exercise) ?? "");
                    const n = working(entry.sets ?? []).length;
                    for (const m of (ex?.muscles as string[] | undefined) ?? []) count.set(m, (count.get(m) ?? 0) + n);
                  }
                const name: Record<string, string> = {
                  chest: ctx.t("chest"),
                  back: ctx.t("back"),
                  shoulders: ctx.t("shoulders"),
                  biceps: ctx.t("biceps"),
                  triceps: ctx.t("triceps"),
                  quads: ctx.t("quads"),
                  hamstrings: ctx.t({ text: "hamstrings", context: "series hamstrings" }),
                  glutes: ctx.t("glutes"),
                  calves: ctx.t("calves"),
                  core: ctx.t("core"),
                };
                return MUSCLES.map((m) => ({
                  label: name[m]!,
                  value: count.get(m) ?? 0,
                  text: ctx.t(
                    "{n, plural, one {# set} other {# sets}}",
                    { n: count.get(m) ?? 0 },
                  ),
                }));
              },
            },
          },
        ],
      },
    },
    {
      id: "program",
      title: "Program",
      icon: "clipboard-list",
      description: "Routines take turns in the order you give them. Tap one to change its exercises.",
      layout: {
        type: "stack",
        items: [
          {
            title: "Routines",
            view: {
              type: "list",
              entity: "routine",
              sort: (a, b) => Number(b.active !== false) - Number(a.active !== false) || String(a.program ?? "").localeCompare(String(b.program ?? "")) || num(a.order) - num(b.order),
              display: {
                primary: "name",
                secondary: (r, ctx) =>
                  [r.program ? String(r.program) : "", String(r.summary ?? ""), r.active === false ? ctx.t("resting") : ""]
                    .filter(Boolean)
                    .join(" · "),
                lead: "icon",
              },
              onOpen: { page: "routine", param: { routineId: "id" } },
            },
          },
          {
            title: "Exercises",
            collapsible: true,
            view: {
              type: "list",
              entity: "exercise",
              sort: (a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")),
              display: {
                primary: (e) => String(e.name ?? ""),
                secondary: (e, ctx) => {
                  const best = e.lastBest as { kg?: number; reps?: number } | null;
                  const bodyweight = e.bodyweight
                    ? ctx.t("bodyweight")
                    : "";
                  const top = best ? (e.bodyweight ? `${num(best.reps)}` : `${kgText(ctx, num(best.kg))} kg × ${num(best.reps)}`) : "";
                  return [String(e.repRange ?? ""), bodyweight, top].filter(Boolean).join(" · ");
                },
              },
              onOpen: { page: "exercise", param: { exerciseId: "id" } },
            },
          },
        ],
      },
    },
    {
      id: "routine",
      title: "Routine",
      hidden: true,
      view: {
        type: "detail",
        entity: "routine",
        param: "routineId",
        facts: ["program"],
        media: "art",
        sections: [
          { title: "Routine", fields: ["summary", "lastDone", "active", "order"] },
          { title: "Exercises", fields: ["exercises"] },
          // Every time it was done, newest first: the sessions that point at this routine.
          {
            title: { text: "Done", context: "a routine's sessions" },
            related: { entity: "session", via: "routine", view: "timeline", date: "date", display: { primary: "title", secondary: "duration" }, limit: 8, onOpen: { page: "session", param: { sessionId: "id" } } },
          },
          { title: "Notes", fields: ["note"] },
        ],
      },
    },
    {
      // An exercise: what it is, how it progresses, and the curve of its estimated 1RM — the chart is
      // the exercise records filtered to this one, so it follows the page's own `exerciseId`.
      id: "exercise",
      title: "Exercise",
      hidden: true,
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "detail",
              entity: "exercise",
              param: "exerciseId",
              facts: ["muscles"],
              media: "art",
              sections: [
                {
                  title: "Your numbers",
                  fields: ["lastBest", "best"],
                },
                {
                  title: "Progression",
                  fields: ["repRange", "step", "restSec", "bodyweight"],
                },
                { title: "Notes", fields: ["cue"] },
              ],
            },
          },
          {
            view: {
              type: "chart",
              entity: "exercise",
              filter: (e, ctx) => e.id === ctx.params.exerciseId,
              title: "Estimated 1RM",
              subtitle: "Every session, oldest first",
              emptyText: "Log this exercise and its curve starts here.",
              series: (rows, ctx) =>
                ((rows[0]?.progress as { date: string; value: number }[] | undefined) ?? []).slice(-12).map((p) => ({
                  label: ctx.format.date(p.date, { day: "numeric", month: "short" }),
                  value: p.value,
                  text: rows[0]?.bodyweight
                    ? ctx.t("{n} reps", { n: p.value })
                    : `${kgText(ctx, p.value)} kg`,
                })),
            },
          },
        ],
      },
    },
    {
      id: "session",
      title: "Session",
      hidden: true,
      view: {
        type: "detail",
        entity: "session",
        param: "sessionId",
        actions: ["logSet"],
        facts: [],
        cover: "band",
        sections: [
          {
            title: "Overview",
            fields: ["title", "date", "duration", "totalSets", "totalVolume"],
          },
          { title: "Personal records", fields: ["prs"] },
          // nested list rendered in the detail view
          { title: "Entries", fields: ["entries"] },
          { title: "Notes", fields: ["note"] },
        ],
      },
    },
  ],

  migrations: [
    // Devices that last opened an older 1.x: nothing changed in their records until 2.0.0, so each
    // hops straight to 1.3.0 and walks on from there. (The chain matches on the version the data was
    // written under, so every version that ever shipped needs a way in.)
    { from: "1.0.0", to: "1.3.0", steps: [] },
    { from: "1.1.0", to: "1.3.0", steps: [] },
    { from: "1.1.1", to: "1.3.0", steps: [] },
    { from: "1.2.0", to: "1.3.0", steps: [] },
    {
      from: "1.3.0",
      to: "2.0.0",
      // Routines are records now. A session gets a link to its routine (empty until the Train screen
      // makes the routines from the old days, `adoptLegacyDays`) and no records yet; an exercise gets
      // muscles and a weight step. A set with no kind is a working set, which is what every v1 set
      // was, so the sets stay as they are. The old `day` stays on both, hidden, so nothing is lost.
      steps: [
        { op: "addField", entity: "session", field: "routine", default: null },
        { op: "addField", entity: "session", field: "records", default: [] },
        { op: "addField", entity: "exercise", field: "muscles", default: [] },
        { op: "addField", entity: "exercise", field: "step", default: 2.5 },
      ],
    },
  ],

  reminders: [],
});
