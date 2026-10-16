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
// In six languages (#303); every language but English is a model's draft (#297). The live screen is a
// custom view and says its words through `runtime.ctx.t`. Exercises, routines and what you lifted are
// records, so they are never translated.
import { defineApp } from "potyro";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Ctx, Resolved, ViewProps } from "potyro";

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
  if (d === "push") return ctx.t({ en: "Push", "pt-BR": "Empurrar", de: "Drücken", es: "Empuje", pl: "Pchanie", it: "Spinta" });
  if (d === "pull") return ctx.t({ en: "Pull", "pt-BR": "Puxar", de: "Ziehen", es: "Tracción", pl: "Ciągnięcie", it: "Trazione" });
  if (d === "legs") return ctx.t({ en: "Legs", "pt-BR": "Pernas", de: "Beine", es: "Pierna", pl: "Nogi", it: "Gambe" });
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
// The workout in progress lives in ctx.storage, rest clock included, so leaving the tab — or the app
// — and coming back finds it exactly where it was.
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
  /** When the rest in progress ends (ms since epoch), and how long it was. */
  restEnd?: number;
  restTotal?: number;
}

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
  const exercisesQ = runtime.useQuery("exercise");
  const sessionsQ = runtime.useQuery("session");

  const [active, setActive] = useState<Active | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const hydrated = useRef(false);
  const adopted = useRef(false);

  // v1 data: make its routines once (see adoptLegacyDays).
  useEffect(() => {
    if (adopted.current || routinesQ.loading || exercisesQ.loading) return;
    adopted.current = true;
    if (routinesQ.rows.length === 0 && exercisesQ.rows.some((e) => e.day)) void adoptLegacyDays(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routinesQ.loading, exercisesQ.loading]);

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
  // locked phone or a background tab comes back to the right numbers.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  const restLeft = active?.restEnd ? Math.ceil((active.restEnd - now) / 1000) : null;
  useEffect(() => {
    if (restLeft != null && restLeft <= 0 && active?.restEnd) {
      void ctx.caps.haptics?.vibrate([0, 250, 120, 250]); // rest over — get ready
      setActive((a) => (a ? { ...a, restEnd: undefined, restTotal: undefined } : a));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restLeft]);

  const exById = useMemo(() => new Map(exercisesQ.rows.map((e) => [e.id, e] as const)), [exercisesQ.rows]);
  const sessions = sessionsQ.rows;
  const next = useMemo(() => nextRoutine(routinesQ.rows, sessions), [routinesQ.rows, sessions]);
  const routine = routinesQ.rows.find((r) => r.id === chosen) ?? next;

  const say = {
    loading: ctx.t({ en: "Loading…", "pt-BR": "Carregando…", de: "Wird geladen…", es: "Cargando…", pl: "Wczytywanie…", it: "Caricamento…" }),
    reps: ctx.t({ en: "reps", "pt-BR": "reps", de: "Wdh.", es: "reps", pl: "powt.", it: "rip." }),
  };
  if (routinesQ.loading || exercisesQ.loading || sessionsQ.loading) return <div className="wk-load">{say.loading}</div>;

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
        <p className="wk-eyebrow">{ctx.t({ en: "Workout done", "pt-BR": "Treino concluído", de: "Training geschafft", es: "Entreno hecho", pl: "Trening zrobiony", it: "Allenamento fatto" })}</p>
        <h2 className="wk-huge">{summary.name}</h2>
        <dl className="wk-figures">
          <div>
            <dt>{ctx.t({ en: "Time", "pt-BR": "Tempo", de: "Zeit", es: "Tiempo", pl: "Czas", it: "Tempo" })}</dt>
            <dd>{mmss(summary.durationSec)}</dd>
          </div>
          <div>
            <dt>{ctx.t({ en: "Volume", "pt-BR": "Volume", de: "Volumen", es: "Volumen", pl: "Objętość", it: "Volume" })}</dt>
            <dd>
              {ctx.format.number(Math.round(summary.volume))}
              <small> kg</small>
            </dd>
          </div>
          <div>
            <dt>{ctx.t({ en: "Sets", "pt-BR": "Séries", de: "Sätze", es: "Series", pl: "Serie", it: "Serie" })}</dt>
            <dd>{summary.sets}</dd>
          </div>
        </dl>
        <h3 className="wk-label">
          {ctx.t(
            {
              en: "{n, plural, =0 {No new records} one {# personal record} other {# personal records}}",
              "pt-BR": "{n, plural, =0 {Nenhum recorde novo} one {# recorde pessoal} other {# recordes pessoais}}",
              de: "{n, plural, =0 {Keine neuen Bestwerte} one {# persönlicher Bestwert} other {# persönliche Bestwerte}}",
              es: "{n, plural, =0 {Ningún récord nuevo} one {# récord personal} other {# récords personales}}",
              pl: "{n, plural, =0 {Brak nowych rekordów} one {# rekord osobisty} few {# rekordy osobiste} many {# rekordów osobistych} other {# rekordu osobistego}}",
              it: "{n, plural, =0 {Nessun nuovo record} one {# record personale} other {# record personali}}",
            },
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
            {ctx.t({
              en: "Showing up is the part that counts. The numbers follow.",
              "pt-BR": "Aparecer é o que conta. Os números vêm depois.",
              de: "Dranbleiben ist, was zählt. Die Zahlen folgen.",
              es: "Lo que cuenta es venir. Los números llegan solos.",
              pl: "Liczy się to, że jesteś. Liczby przyjdą same.",
              it: "Quello che conta è esserci. I numeri arrivano.",
            })}
          </p>
        )}
        <div className="wk-row">
          <button type="button" className="wk-ghost" onClick={share}>
            {ctx.t({ en: "Share", "pt-BR": "Compartilhar", de: "Teilen", es: "Compartir", pl: "Udostępnij", it: "Condividi" })}
          </button>
          <button type="button" className="wk-go" onClick={done}>
            {ctx.t({ en: "Done", "pt-BR": "Pronto", de: "Fertig", es: "Listo", pl: "Gotowe", it: "Fatto" })}
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
                ? ctx.t({ en: "Next up", "pt-BR": "A seguir", de: "Als Nächstes", es: "Lo siguiente", pl: "Następny", it: "Prossimo" })
                : ctx.t({ en: "Your pick", "pt-BR": "Sua escolha", de: "Deine Wahl", es: "Tu elección", pl: "Twój wybór", it: "La tua scelta" })}
              {routine.program ? <span> · {String(routine.program)}</span> : null}
            </p>
            <h2 className="wk-huge" id="wk-next">
              {String(routine.name ?? "")}
            </h2>
            <p className="wk-meta">
              {last
                ? ctx.t(
                    { en: "Last done {when}", "pt-BR": "Feito {when}", de: "Zuletzt {when}", es: "Última vez {when}", pl: "Ostatnio {when}", it: "Ultima volta {when}" },
                    { when: ctx.format.relative(dateOf(last.date), { unit: "day" }) },
                  )
                : ctx.t({ en: "Not done yet", "pt-BR": "Ainda não feito", de: "Noch nie gemacht", es: "Aún sin hacer", pl: "Jeszcze nie robiony", it: "Mai fatto" })}
              {" · "}
              {ctx.t(
                {
                  en: "{n, plural, one {# exercise} other {# exercises}}, {sets, plural, one {# set} other {# sets}}",
                  "pt-BR": "{n, plural, one {# exercício} other {# exercícios}}, {sets, plural, one {# série} other {# séries}}",
                  de: "{n, plural, one {# Übung} other {# Übungen}}, {sets, plural, one {# Satz} other {# Sätze}}",
                  es: "{n, plural, one {# ejercicio} other {# ejercicios}}, {sets, plural, one {# serie} other {# series}}",
                  pl: "{n, plural, one {# ćwiczenie} few {# ćwiczenia} many {# ćwiczeń} other {# ćwiczenia}}, {sets, plural, one {# seria} few {# serie} many {# serii} other {# serii}}",
                  it: "{n, plural, one {# esercizio} other {# esercizi}}, {sets, plural, one {# serie} other {# serie}}",
                },
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
                { en: "Start {name}", "pt-BR": "Começar {name}", de: "{name} starten", es: "Empezar {name}", pl: "Zacznij: {name}", it: "Inizia {name}" },
                { name: String(routine.name ?? "") },
              )}
            </button>
          </section>
        ) : (
          <section className="wk-hero">
            <h2 className="wk-huge">{ctx.t({ en: "No routines yet", "pt-BR": "Nenhuma rotina ainda", de: "Noch keine Routinen", es: "Aún no hay rutinas", pl: "Jeszcze brak planów", it: "Ancora nessuna routine" })}</h2>
            <p className="wk-meta">
              {ctx.t({
                en: "A routine is a list of exercises you do together. Make one on the Program tab.",
                "pt-BR": "Uma rotina é uma lista de exercícios que você faz juntos. Crie uma na aba Programa.",
                de: "Eine Routine ist eine Liste von Übungen, die du zusammen machst. Leg eine im Tab Programm an.",
                es: "Una rutina es una lista de ejercicios que haces juntos. Crea una en la pestaña Programa.",
                pl: "Plan to lista ćwiczeń robionych razem. Utwórz go w zakładce Program.",
                it: "Una routine è un elenco di esercizi da fare insieme. Creane una nella scheda Programma.",
              })}
            </p>
            <button type="button" className="wk-go" onClick={() => navigate("program")}>
              {ctx.t({ en: "Open Program", "pt-BR": "Abrir Programa", de: "Programm öffnen", es: "Abrir Programa", pl: "Otwórz Program", it: "Apri Programma" })}
            </button>
          </section>
        )}

        <section className="wk-week" aria-label={ctx.t({ en: "This week", "pt-BR": "Esta semana", de: "Diese Woche", es: "Esta semana", pl: "Ten tydzień", it: "Questa settimana" })}>
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
                  {
                    en: "🔥 {n, plural, one {# week in a row} other {# weeks in a row}}",
                    "pt-BR": "🔥 {n, plural, one {# semana seguida} other {# semanas seguidas}}",
                    de: "🔥 {n, plural, one {# Woche am Stück} other {# Wochen am Stück}}",
                    es: "🔥 {n, plural, one {# semana seguida} other {# semanas seguidas}}",
                    pl: "🔥 {n, plural, one {# tydzień z rzędu} few {# tygodnie z rzędu} many {# tygodni z rzędu} other {# tygodnia z rzędu}}",
                    it: "🔥 {n, plural, one {# settimana di fila} other {# settimane di fila}}",
                  },
                  { n: weeks },
                )
              : ctx.t({ en: "Start a streak today", "pt-BR": "Comece uma sequência hoje", de: "Starte heute eine Serie", es: "Empieza una racha hoy", pl: "Zacznij dziś serię", it: "Inizia una serie oggi" })}
          </p>
        </section>

        {others.length ? (
          <section className="wk-others">
            <h3 className="wk-label">{ctx.t({ en: "Or train something else", "pt-BR": "Ou treine outra coisa", de: "Oder etwas anderes", es: "U otra cosa", pl: "Albo coś innego", it: "Oppure altro" })}</h3>
            <div className="wk-chips">
              {others.map((r) => (
                <button key={r.id} type="button" className="wk-chip" data-resting={r.active === false || undefined} onClick={() => setChosen(r.id)}>
                  {String(r.name ?? "")}
                  {r.program && turn.every((t) => t.program !== r.program) ? <small> · {String(r.program)}</small> : null}
                </button>
              ))}
              {chosen ? (
                <button type="button" className="wk-chip wk-chip-back" onClick={() => setChosen(null)}>
                  ↺ {ctx.t({ en: "Back to next up", "pt-BR": "Voltar ao próximo", de: "Zurück zum Nächsten", es: "Volver a lo siguiente", pl: "Wróć do następnego", it: "Torna al prossimo" })}
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

  const scheduleRest = async (seconds: number, nextLabel: string): Promise<void> => {
    // The phone may lock between sets: where the device can schedule exactly, it says so itself.
    const n = ctx.caps.notifications;
    if (!n) return;
    try {
      await n.cancel("rest");
      await n.schedule({
        id: "rest",
        at: new Date(Date.now() + seconds * 1000),
        title: ctx.t({ en: "Rest's over", "pt-BR": "Fim do descanso", de: "Pause vorbei", es: "Se acabó el descanso", pl: "Koniec przerwy", it: "Recupero finito" }),
        body: nextLabel,
      });
    } catch {
      // A reminder is a nicety; the clock on the screen is the real one.
    }
  };
  const cancelRest = (): void => {
    void ctx.caps.notifications?.cancel("rest").catch(() => undefined);
    setActive((a) => (a ? { ...a, restEnd: undefined, restTotal: undefined } : a));
  };

  const toggleDone = (exId: string, i: number): void => {
    const rows = (plan[exId] ?? []).map((r, ri) => (ri === i ? { ...r, done: !r.done } : r));
    const ticked = rows[i]!.done;
    let restEnd = active.restEnd;
    let restTotal = active.restTotal;
    if (ticked) {
      void ctx.caps.haptics?.vibrate(35); // set logged — quick tick
      // The rest this exercise asks for: a heavy squat and a cable fly do not want the same wait.
      const wait = rows[i]!.kind === "warmup" ? Math.min(60, restFor(exId)) : restFor(exId);
      restEnd = Date.now() + wait * 1000;
      restTotal = wait;
      const upcoming = rows.find((r) => !r.done) ? exById.get(exId) : exById.get(active.order.find((id) => id !== exId && !(plan[id] ?? []).every((r) => r.done)) ?? "");
      void scheduleRest(wait, upcoming ? String(upcoming.name ?? "") : "");
      if (rows.every((r) => r.done)) {
        const nextEx = active.order.find((id) => id !== exId && !(plan[id] ?? []).every((r) => r.done));
        if (nextEx) setOpenId(nextEx);
      }
    }
    setActive({ ...active, plan: { ...plan, [exId]: rows }, restEnd, restTotal });
  };

  const addSet = (exId: string): void => {
    const rows = plan[exId] ?? [];
    const last = rows[rows.length - 1];
    setActive({ ...active, plan: { ...plan, [exId]: [...rows, { kg: last?.kg ?? "", reps: last?.reps ?? "", done: false, kind: "work" }] } });
  };

  const stop = (): void => {
    void ctx.caps.notifications?.cancel("rest").catch(() => undefined);
    setActive(null);
    setOpenId(null);
  };

  const cancel = async (): Promise<void> => {
    const sure = await ctx.ui.confirm(
      ctx.t({ en: "Discard this workout?", "pt-BR": "Descartar este treino?", de: "Dieses Training verwerfen?", es: "¿Descartar este entreno?", pl: "Odrzucić ten trening?", it: "Scartare questo allenamento?" }),
      {
        detail: ctx.t({ en: "Nothing from it is saved.", "pt-BR": "Nada dele será salvo.", de: "Nichts davon wird gespeichert.", es: "No se guardará nada.", pl: "Nic z niego nie zostanie zapisane.", it: "Non verrà salvato niente." }),
        ok: ctx.t({ en: "Discard", "pt-BR": "Descartar", de: "Verwerfen", es: "Descartar", pl: "Odrzuć", it: "Scarta" }),
        destructive: true,
      },
    );
    if (sure) stop();
  };

  const finish = async (): Promise<void> => {
    // Finishing is a choice, not a reflex (#112): save it, keep going, or throw it away — the last
    // one set apart and in red by the sheet itself.
    const choice = await ctx.ui.sheet({
      title: ctx.t({ en: "Finish workout?", "pt-BR": "Terminar o treino?", de: "Training beenden?", es: "¿Terminar el entreno?", pl: "Zakończyć trening?", it: "Finire l'allenamento?" }),
      items: [
        {
          id: "save",
          label: ctx.t({ en: "Save and finish", "pt-BR": "Salvar e terminar", de: "Speichern und beenden", es: "Guardar y terminar", pl: "Zapisz i zakończ", it: "Salva e finisci" }),
          detail: ctx.t(
            {
              en: "{sets, plural, one {# set} other {# sets}} · {min} min",
              "pt-BR": "{sets, plural, one {# série} other {# séries}} · {min} min",
              de: "{sets, plural, one {# Satz} other {# Sätze}} · {min} Min.",
              es: "{sets, plural, one {# serie} other {# series}} · {min} min",
              pl: "{sets, plural, one {# seria} few {# serie} many {# serii} other {# serii}} · {min} min",
              it: "{sets, plural, one {# serie} other {# serie}} · {min} min",
            },
            { sets: setsDone, min: Math.max(1, Math.round(elapsed / 60)) },
          ),
          icon: "✓",
        },
        {
          id: "keep",
          label: ctx.t({ en: "Keep training", "pt-BR": "Continuar treinando", de: "Weiter trainieren", es: "Seguir entrenando", pl: "Trenuj dalej", it: "Continua ad allenarti" }),
          icon: "↺",
        },
        {
          id: "discard",
          label: ctx.t({ en: "Discard workout", "pt-BR": "Descartar treino", de: "Training verwerfen", es: "Descartar entreno", pl: "Odrzuć trening", it: "Scarta l'allenamento" }),
          detail: ctx.t({
            en: "Nothing from this workout is saved",
            "pt-BR": "Nada deste treino será salvo",
            de: "Nichts aus diesem Training wird gespeichert",
            es: "No se guardará nada de este entreno",
            pl: "Nic z tego treningu nie zostanie zapisane",
            it: "Non verrà salvato niente di questo allenamento",
          }),
          icon: "✕",
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
        ctx.t({
          en: "Complete a set first",
          "pt-BR": "Complete uma série primeiro",
          de: "Schließ zuerst einen Satz ab",
          es: "Completa una serie primero",
          pl: "Najpierw zrób serię",
          it: "Prima completa una serie",
        }),
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

  const restRatio = restLeft != null && active.restTotal ? Math.max(0, Math.min(1, restLeft / active.restTotal)) : 0;

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
            aria-label={ctx.t({ en: "Discard workout", "pt-BR": "Descartar treino", de: "Training verwerfen", es: "Descartar entreno", pl: "Odrzuć trening", it: "Scarta l'allenamento" })}
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
                    <span>{ctx.t({ en: "Set", "pt-BR": "Série", de: "Satz", es: "Serie", pl: "Seria", it: "Serie" })}</span>
                    <span>{ctx.t({ en: "Previous", "pt-BR": "Anterior", de: "Vorher", es: "Anterior", pl: "Poprzednio", it: "Precedente" })}</span>
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
                          aria-label={ctx.t({ en: "Complete set", "pt-BR": "Concluir série", de: "Satz abschließen", es: "Completar serie", pl: "Zalicz serię", it: "Completa la serie" })}
                        >
                          ✓
                        </button>
                      </div>
                    );
                  })}
                  <button type="button" className="wk-addset" onClick={() => addSet(id)}>
                    {ctx.t({ en: "+ Add set", "pt-BR": "+ Adicionar série", de: "+ Satz hinzufügen", es: "+ Añadir serie", pl: "+ Dodaj serię", it: "+ Aggiungi serie" })}
                  </button>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="wk-bar">
        {restLeft != null && restLeft > 0 ? (
          <div className="wk-rest" role="timer" aria-label={ctx.t({ en: "Rest", "pt-BR": "Descanso", de: "Pause", es: "Descanso", pl: "Przerwa", it: "Recupero" })}>
            <svg className="wk-ring" viewBox="0 0 44 44" aria-hidden="true">
              <circle cx="22" cy="22" r="19" />
              <circle cx="22" cy="22" r="19" style={{ strokeDashoffset: `${(1 - restRatio) * 119.4}` }} />
            </svg>
            <span className="wk-rest-n">{mmss(restLeft)}</span>
            <button type="button" onClick={() => setActive((a) => (a?.restEnd ? { ...a, restEnd: a.restEnd + 30_000, restTotal: (a.restTotal ?? 0) + 30 } : a))}>
              +30s
            </button>
            <button type="button" onClick={cancelRest}>
              {ctx.t({ en: "skip", "pt-BR": "pular", de: "überspringen", es: "saltar", pl: "pomiń", it: "salta" })}
            </button>
          </div>
        ) : (
          <span className="wk-bar-hint">
            {ctx.t({
              en: "Tap ✓ to log a set",
              "pt-BR": "Toque em ✓ para registrar uma série",
              de: "Tippe auf ✓, um einen Satz einzutragen",
              es: "Toca ✓ para anotar una serie",
              pl: "Stuknij ✓, by zapisać serię",
              it: "Tocca ✓ per segnare una serie",
            })}
          </span>
        )}
        <button type="button" className="wk-go wk-finish" onClick={() => void finish()}>
          {ctx.t({ en: "Finish", "pt-BR": "Terminar", de: "Beenden", es: "Terminar", pl: "Zakończ", it: "Fine" })}
        </button>
      </div>
    </div>
  );
}

/** "+2.5 kg — you hit 12, 12, 12" and its siblings: the rule, said in the person's words. */
function targetWords(s: Suggestion, ex: Resolved, ctx: Ctx): string {
  const hit = s.hit.join(", ");
  if (s.why === "first")
    return ctx.t({ en: "First time — find your weight", "pt-BR": "Primeira vez — encontre seu peso", de: "Erstes Mal — finde dein Gewicht", es: "Primera vez — encuentra tu peso", pl: "Pierwszy raz — dobierz ciężar", it: "Prima volta — trova il tuo peso" });
  if (s.why === "up")
    return ctx.t(
      {
        en: "{kg} kg today: +{step} kg, you hit {hit}",
        "pt-BR": "{kg} kg hoje: +{step} kg, você fez {hit}",
        de: "Heute {kg} kg: +{step} kg, du hast {hit} geschafft",
        es: "Hoy {kg} kg: +{step} kg, hiciste {hit}",
        pl: "Dziś {kg} kg: +{step} kg, zrobiłeś {hit}",
        it: "Oggi {kg} kg: +{step} kg, hai fatto {hit}",
      },
      { kg: kgText(ctx, s.kg), step: kgText(ctx, s.step), hit },
    );
  if (ex.bodyweight)
    return ctx.t(
      { en: "Aim for {reps}: last time {hit}", "pt-BR": "Tente {reps}: da última vez {hit}", de: "Ziel {reps}: letztes Mal {hit}", es: "Apunta a {reps}: la última vez {hit}", pl: "Celuj w {reps}: ostatnio {hit}", it: "Punta a {reps}: l'ultima volta {hit}" },
      { reps: s.reps, hit },
    );
  return ctx.t(
    {
      en: "{kg} kg × {reps}: beat {hit}",
      "pt-BR": "{kg} kg × {reps}: supere {hit}",
      de: "{kg} kg × {reps}: schlag {hit}",
      es: "{kg} kg × {reps}: supera {hit}",
      pl: "{kg} kg × {reps}: pobij {hit}",
      it: "{kg} kg × {reps}: batti {hit}",
    },
    { kg: kgText(ctx, s.kg), reps: s.reps, hit },
  );
}

function kindWords(kind: SetKind, ctx: Ctx): string {
  if (kind === "warmup") return ctx.t({ en: "Warm-up set: tap for a drop set", "pt-BR": "Aquecimento: toque para drop set", de: "Aufwärmsatz: tippen für Dropsatz", es: "Calentamiento: toca para serie descendente", pl: "Rozgrzewka: stuknij, by zmienić na serię zrzutową", it: "Riscaldamento: tocca per serie a scalare" });
  if (kind === "drop") return ctx.t({ en: "Drop set: tap for a work set", "pt-BR": "Drop set: toque para série normal", de: "Dropsatz: tippen für Arbeitssatz", es: "Serie descendente: toca para serie normal", pl: "Seria zrzutowa: stuknij, by zmienić na roboczą", it: "Serie a scalare: tocca per serie allenante" });
  return ctx.t({ en: "Work set: tap for a warm-up", "pt-BR": "Série normal: toque para aquecimento", de: "Arbeitssatz: tippen für Aufwärmsatz", es: "Serie normal: toca para calentamiento", pl: "Seria robocza: stuknij, by zmienić na rozgrzewkę", it: "Serie allenante: tocca per riscaldamento" });
}

function recordWords(r: Record_, ctx: Ctx): string {
  if (r.kind === "reps")
    return ctx.t(
      { en: "{n} reps, most ever", "pt-BR": "{n} reps, o máximo até hoje", de: "{n} Wdh., so viele wie nie", es: "{n} reps, tu máximo", pl: "{n} powt., najwięcej w historii", it: "{n} rip., il massimo di sempre" },
      { n: r.value },
    );
  if (r.kind === "heaviest")
    return ctx.t(
      { en: "{kg} kg, heaviest yet", "pt-BR": "{kg} kg, o mais pesado até hoje", de: "{kg} kg, so schwer wie nie", es: "{kg} kg, lo más pesado", pl: "{kg} kg, najciężej w historii", it: "{kg} kg, il più pesante di sempre" },
      { kg: kgText(ctx, r.value) },
    );
  return ctx.t(
    { en: "{kg} kg estimated 1RM", "pt-BR": "{kg} kg de 1RM estimado", de: "{kg} kg geschätztes 1RM", es: "{kg} kg de 1RM estimado", pl: "{kg} kg szacowanego 1RM", it: "{kg} kg di 1RM stimato" },
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
.wk-check { width:56px; height:48px; border-radius:12px; border:2px solid var(--wk-line); background:transparent; color:transparent; font-size:1.4rem; font-weight:900; cursor:pointer; transition:transform .12s ease, background-color .12s ease; }
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
  name: { en: "Workout", "pt-BR": "Treino", de: "Training", es: "Entreno", pl: "Trening", it: "Allenamento" },
  icon: "🏋",
  version: "2.0.0",
  // Routines became records and the training day an old field (2.0.0): the records change shape.
  schemaVersion: 2,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#B6E62E", background: { image: "art/plates.webp" } },
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
        ? ctx.t({ en: "{name} next", "pt-BR": "Próximo: {name}", de: "Als Nächstes: {name}", es: "Ahora toca {name}", pl: "Następny: {name}", it: "Prossimo: {name}" }, { name: String(next.name ?? "") })
        : "",
      lines: [
        last
          ? ctx.t({ en: "Last: {when}", "pt-BR": "Último: {when}", de: "Zuletzt: {when}", es: "Último: {when}", pl: "Ostatnio: {when}", it: "Ultimo: {when}" }, { when: ctx.format.relative(dateOf(last.date), { unit: "day" }) })
          : "",
        weeks > 0
          ? ctx.t(
              {
                en: "Streak: {n, plural, one {# week} other {# weeks}}",
                "pt-BR": "Sequência: {n, plural, one {# semana} other {# semanas}}",
                de: "Serie: {n, plural, one {# Woche} other {# Wochen}}",
                es: "Racha: {n, plural, one {# semana} other {# semanas}}",
                pl: "Seria: {n, plural, one {# tydzień} few {# tygodnie} many {# tygodni} other {# tygodnia}}",
                it: "Serie: {n, plural, one {# settimana} other {# settimane}}",
              },
              { n: weeks },
            )
          : "",
      ].filter(Boolean),
    };
  },
  // Buzz on a set and when a rest ends; a reminder when the rest is over where the device can
  // schedule one exactly (a phone, not a browser tab).
  permissions: { haptics: true, notifications: true },
  nav: "tabs",

  quickActions: [
    {
      id: "new-routine",
      label: { en: "New routine", "pt-BR": "Nova rotina", de: "Neue Routine", es: "Nueva rutina", pl: "Nowy plan", it: "Nuova routine" },
      icon: "＋",
      entity: "routine",
      mode: "form",
    },
    {
      id: "new-exercise",
      label: { en: "New exercise", "pt-BR": "Novo exercício", de: "Neue Übung", es: "Nuevo ejercicio", pl: "Nowe ćwiczenie", it: "Nuovo esercizio" },
      icon: "＋",
      entity: "exercise",
    },
  ],

  entities: {
    // ---- a ROUTINE: the exercises you do together, taking turns with the others in its program ----
    routine: {
      label: { en: "Routine", "pt-BR": "Rotina", de: "Routine", es: "Rutina", pl: "Plan", it: "Routine" },
      icon: "📋",
      displayField: "name",
      fields: {
        name: {
          type: "text",
          required: true,
          label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" },
          placeholder: { en: "Push A", "pt-BR": "Empurrar A", de: "Drücken A", es: "Empuje A", pl: "Pchanie A", it: "Spinta A" },
        },
        program: {
          type: "text",
          label: { en: "Program", "pt-BR": "Programa", de: "Programm", es: "Programa", pl: "Program", it: "Programma" },
          placeholder: "PPL",
          help: {
            en: "Routines in the same program take turns",
            "pt-BR": "Rotinas do mesmo programa se revezam",
            de: "Routinen im selben Programm wechseln sich ab",
            es: "Las rutinas del mismo programa se turnan",
            pl: "Plany z tego samego programu idą na zmianę",
            it: "Le routine dello stesso programma si alternano",
          },
          width: "half",
        },
        order: {
          type: "number",
          integer: true,
          default: 0,
          width: "half",
          label: { en: "Turn", "pt-BR": "Vez", de: "Reihenfolge", es: "Turno", pl: "Kolejność", it: "Turno" },
        },
        active: {
          type: "boolean",
          default: true,
          label: { en: "In rotation", "pt-BR": "No rodízio", de: "In der Rotation", es: "En rotación", pl: "W rotacji", it: "In rotazione" },
          help: {
            en: "Off: kept, but never suggested as next",
            "pt-BR": "Desligado: guardada, mas nunca sugerida",
            de: "Aus: bleibt, wird aber nie vorgeschlagen",
            es: "Apagado: se guarda, pero nunca se sugiere",
            pl: "Wyłączone: zostaje, ale nigdy nie jest proponowany",
            it: "Spento: resta, ma non viene mai proposta",
          },
        },
        exercises: {
          type: "list",
          ordered: true,
          label: { en: "Exercises", "pt-BR": "Exercícios", de: "Übungen", es: "Ejercicios", pl: "Ćwiczenia", it: "Esercizi" },
          of: {
            exercise: {
              type: "relation",
              to: "exercise",
              required: true,
              label: { en: "Exercise", "pt-BR": "Exercício", de: "Übung", es: "Ejercicio", pl: "Ćwiczenie", it: "Esercizio" },
            },
            sets: {
              type: "number",
              integer: true,
              min: 1,
              default: 3,
              label: { en: "Sets", "pt-BR": "Séries", de: "Sätze", es: "Series", pl: "Serie", it: "Serie" },
            },
            reps: {
              type: "text",
              default: "8–12",
              label: { en: "Reps", "pt-BR": "Repetições", de: "Wiederholungen", es: "Repeticiones", pl: "Powtórzenia", it: "Ripetizioni" },
            },
          },
        },
        note: { type: "text", multiline: true, label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" } },
      },
      groups: [
        { title: { en: "Routine", "pt-BR": "Rotina", de: "Routine", es: "Rutina", pl: "Plan", it: "Routine" }, fields: ["name", "program", "order", "active"] },
        { title: { en: "Exercises", "pt-BR": "Exercícios", de: "Übungen", es: "Ejercicios", pl: "Ćwiczenia", it: "Esercizi" }, fields: ["exercises"] },
        { title: { en: "More", "pt-BR": "Mais", de: "Mehr", es: "Más", pl: "Więcej", it: "Altro" }, fields: ["note"], collapsed: true },
      ],
      computed: {
        summary: {
          label: { en: "Plan", "pt-BR": "Plano", de: "Plan", es: "Plan", pl: "Plan", it: "Piano" },
          value: (r, ctx) => {
            const rows = rowsOf(r);
            return ctx.t(
              {
                en: "{n, plural, one {# exercise} other {# exercises}} · {sets, plural, one {# set} other {# sets}}",
                "pt-BR": "{n, plural, one {# exercício} other {# exercícios}} · {sets, plural, one {# série} other {# séries}}",
                de: "{n, plural, one {# Übung} other {# Übungen}} · {sets, plural, one {# Satz} other {# Sätze}}",
                es: "{n, plural, one {# ejercicio} other {# ejercicios}} · {sets, plural, one {# serie} other {# series}}",
                pl: "{n, plural, one {# ćwiczenie} few {# ćwiczenia} many {# ćwiczeń} other {# ćwiczenia}} · {sets, plural, one {# seria} few {# serie} many {# serii} other {# serii}}",
                it: "{n, plural, one {# esercizio} other {# esercizi}} · {sets, plural, one {# serie} other {# serie}}",
              },
              { n: rows.length, sets: rows.reduce((n, x) => n + x.sets, 0) },
            );
          },
        },
        lastDone: {
          label: { en: "Last done", "pt-BR": "Última vez", de: "Zuletzt", es: "Última vez", pl: "Ostatnio", it: "Ultima volta" },
          value: async (r, ctx) => {
            const last = lastOf(await ctx.query("session"), r.id);
            return last ? ctx.format.relative(dateOf(last.date), { unit: "day" }) : "—";
          },
        },
      },
    },

    // ---- an EXERCISE: the movement, and how you progress on it ----
    exercise: {
      label: { en: "Exercise", "pt-BR": "Exercício", de: "Übung", es: "Ejercicio", pl: "Ćwiczenie", it: "Esercizio" },
      icon: "💪",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" } },
        muscles: {
          type: "tags",
          options: [...MUSCLES],
          label: { en: "Muscles", "pt-BR": "Músculos", de: "Muskeln", es: "Músculos", pl: "Mięśnie", it: "Muscoli" },
          labels: {
            chest: { en: "chest", "pt-BR": "peito", de: "Brust", es: "pecho", pl: "klatka", it: "petto" },
            back: { en: "back", "pt-BR": "costas", de: "Rücken", es: "espalda", pl: "plecy", it: "schiena" },
            shoulders: { en: "shoulders", "pt-BR": "ombros", de: "Schultern", es: "hombros", pl: "barki", it: "spalle" },
            biceps: { en: "biceps", "pt-BR": "bíceps", de: "Bizeps", es: "bíceps", pl: "biceps", it: "bicipiti" },
            triceps: { en: "triceps", "pt-BR": "tríceps", de: "Trizeps", es: "tríceps", pl: "triceps", it: "tricipiti" },
            quads: { en: "quads", "pt-BR": "quadríceps", de: "Quadrizeps", es: "cuádriceps", pl: "czworogłowe", it: "quadricipiti" },
            hamstrings: { en: "hamstrings", "pt-BR": "posteriores", de: "Beinbeuger", es: "isquios", pl: "dwugłowe uda", it: "femorali" },
            glutes: { en: "glutes", "pt-BR": "glúteos", de: "Gesäß", es: "glúteos", pl: "pośladki", it: "glutei" },
            calves: { en: "calves", "pt-BR": "panturrilhas", de: "Waden", es: "gemelos", pl: "łydki", it: "polpacci" },
            core: { en: "core", "pt-BR": "core", de: "Rumpf", es: "core", pl: "core", it: "core" },
          },
        },
        repRange: {
          type: "text",
          default: "8–12",
          width: "half",
          label: { en: "Rep range", "pt-BR": "Faixa de repetições", de: "Wiederholungen", es: "Rango de repeticiones", pl: "Zakres powtórzeń", it: "Intervallo di ripetizioni" },
          help: {
            en: "Reach the top on every set and the weight goes up",
            "pt-BR": "Chegue ao topo em todas as séries e o peso sobe",
            de: "Schaffst du in jedem Satz das Maximum, steigt das Gewicht",
            es: "Llega arriba en todas las series y sube el peso",
            pl: "Zrób górę zakresu w każdej serii, a ciężar rośnie",
            it: "Arriva in cima in ogni serie e il peso sale",
          },
        },
        step: {
          type: "number",
          min: 0,
          default: 2.5,
          unit: "kg",
          width: "half",
          label: { en: "Add each time", "pt-BR": "Aumento", de: "Steigerung", es: "Aumento", pl: "Przyrost", it: "Incremento" },
        },
        restSec: {
          type: "duration",
          label: { en: "Rest", "pt-BR": "Descanso", de: "Pause", es: "Descanso", pl: "Przerwa", it: "Recupero" },
          unit: "s",
          default: 90,
          help: {
            en: "Counted down after each set; you can always skip it",
            "pt-BR": "Contagem regressiva depois de cada série; dá para pular quando quiser",
            de: "Läuft nach jedem Satz ab; du kannst sie jederzeit überspringen",
            es: "Cuenta atrás tras cada serie; siempre puedes saltarla",
            pl: "Odliczana po każdej serii; zawsze możesz ją pominąć",
            it: "Conto alla rovescia dopo ogni serie; puoi sempre saltarlo",
          },
        },
        bodyweight: {
          type: "boolean",
          default: false,
          label: { en: "Bodyweight", "pt-BR": "Peso corporal", de: "Eigengewicht", es: "Peso corporal", pl: "Masa ciała", it: "Corpo libero" },
          help: {
            en: "Progress on reps; kg is anything you add",
            "pt-BR": "Progride nas repetições; kg é o que você acrescenta",
            de: "Steigerung über Wiederholungen; kg ist Zusatzgewicht",
            es: "Progresa en repeticiones; kg es lo que añadas",
            pl: "Postęp w powtórzeniach; kg to obciążenie dodatkowe",
            it: "Progredisci nelle ripetizioni; i kg sono il sovraccarico",
          },
        },
        cue: {
          type: "text",
          multiline: true,
          label: { en: "Cue", "pt-BR": "Dica", de: "Hinweis", es: "Consejo", pl: "Wskazówka", it: "Suggerimento" },
          placeholder: {
            en: "Elbows 45°, bar to mid-chest",
            "pt-BR": "Cotovelos a 45°, barra no meio do peito",
            de: "Ellbogen 45°, Stange zur Brustmitte",
            es: "Codos a 45°, barra a media altura del pecho",
            pl: "Łokcie 45°, sztanga do połowy klatki",
            it: "Gomiti a 45°, bilanciere a metà petto",
          },
        },
        // ---- v1: the training day, its place in it, and its sets. Kept so old records read, hidden
        // because routines say all three now. `adoptLegacyDays` turns them into routines. ----
        day: {
          type: "enum",
          options: ["push", "pull", "legs"],
          hidden: true,
          label: { en: "Day", "pt-BR": "Dia", de: "Tag", es: "Día", pl: "Dzień", it: "Giorno" },
          labels: {
            push: { en: "push", "pt-BR": "empurrar", de: "Drücken", es: "empuje", pl: "pchanie", it: "spinta" },
            pull: { en: "pull", "pt-BR": "puxar", de: "Ziehen", es: "tracción", pl: "ciągnięcie", it: "trazione" },
            legs: { en: "legs", "pt-BR": "pernas", de: "Beine", es: "pierna", pl: "nogi", it: "gambe" },
          },
        },
        order: { type: "number", integer: true, hidden: true, label: { en: "Order", "pt-BR": "Ordem", de: "Reihenfolge", es: "Orden", pl: "Kolejność", it: "Ordine" } },
        targetSets: { type: "number", integer: true, hidden: true, label: { en: "Target sets", "pt-BR": "Séries previstas", de: "Sätze (Ziel)", es: "Series objetivo", pl: "Docelowe serie", it: "Serie previste" } },
      },
      groups: [
        { title: { en: "Exercise", "pt-BR": "Exercício", de: "Übung", es: "Ejercicio", pl: "Ćwiczenie", it: "Esercizio" }, fields: ["name", "muscles", "bodyweight"] },
        { title: { en: "Progression", "pt-BR": "Progressão", de: "Steigerung", es: "Progresión", pl: "Progresja", it: "Progressione" }, fields: ["repRange", "step", "restSec"] },
        { title: { en: "Notes", "pt-BR": "Anotações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" }, fields: ["cue"] },
      ],
      computed: {
        // ASYNC computed that reads history, ONCE: every session this exercise was in, newest first,
        // as its date and working sets. The values below are worked out from it, so an exercise
        // costs one query rather than one per figure.
        history: async (e, ctx) =>
          newestFirst(await ctx.query("session"))
            .map((s) => ({ date: dateOf(s.date).toISOString(), sets: working(setsIn(s, e.id) ?? []).map((x) => ({ kg: num(x.kg), reps: num(x.reps) })) }))
            .filter((h) => h.sets.length > 0),
        // The best set of the last N sessions that had this exercise.
        lastBest: {
          label: { en: "Rolling best", "pt-BR": "Melhor recente", de: "Aktueller Bestwert", es: "Mejor reciente", pl: "Ostatni rekord", it: "Record recente" },
          // The best set is an object (the Train screen reads it), so the page says it through a
          // message over its kg and reps; a bodyweight set has no weight (0).
          format: {
            en: "{kg, plural, =0 {{reps} reps} other {{kg, number} kg × {reps}}}",
            "pt-BR": "{kg, plural, =0 {{reps} reps} other {{kg, number} kg × {reps}}}",
            de: "{kg, plural, =0 {{reps} Wdh.} other {{kg, number} kg × {reps}}}",
            es: "{kg, plural, =0 {{reps} reps} other {{kg, number} kg × {reps}}}",
            pl: "{kg, plural, =0 {{reps} powt.} other {{kg, number} kg × {reps}}}",
            it: "{kg, plural, =0 {{reps} rip.} other {{kg, number} kg × {reps}}}",
          },
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
        progress: (e) =>
          [...((e.history as History | undefined) ?? [])]
            .reverse()
            .map((h) => ({ date: h.date, value: Math.max(0, ...h.sets.map((x) => (e.bodyweight ? x.reps : e1rm(x.kg, x.reps)))) }))
            .filter((p) => p.value > 0),
        best: {
          label: { en: "Best estimated 1RM", "pt-BR": "Melhor 1RM estimado", de: "Bestes geschätztes 1RM", es: "Mejor 1RM estimado", pl: "Najlepszy szacowany 1RM", it: "Miglior 1RM stimato" },
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
      label: { en: "Session", "pt-BR": "Treino", de: "Training", es: "Sesión", pl: "Trening", it: "Sessione" },
      icon: "🏋",
      displayField: "label",
      fields: {
        routine: {
          type: "relation",
          to: "routine",
          label: { en: "Routine", "pt-BR": "Rotina", de: "Routine", es: "Rutina", pl: "Plan", it: "Routine" },
        },
        date: {
          type: "datetime",
          precision: "minute",
          required: true,
          default: (ctx) => ctx.now(),
          label: { en: "Date", "pt-BR": "Data", de: "Datum", es: "Fecha", pl: "Data", it: "Data" },
        },
        durationSec: { type: "number", hidden: true },
        entries: {
          type: "list",
          label: { en: "Entries", "pt-BR": "Exercícios", de: "Übungen", es: "Ejercicios", pl: "Ćwiczenia", it: "Esercizi" },
          of: {
            exercise: {
              type: "relation",
              to: "exercise",
              required: true,
              label: { en: "Exercise", "pt-BR": "Exercício", de: "Übung", es: "Ejercicio", pl: "Ćwiczenie", it: "Esercizio" },
            },
            sets: {
              // NESTED list: a list field whose rows contain another list field
              type: "list",
              ordered: true,
              label: { en: "Sets", "pt-BR": "Séries", de: "Sätze", es: "Series", pl: "Serie", it: "Serie" },
              of: {
                kg: { type: "number", unit: "kg", min: 0, label: "Kg" }, // a unit, the same in every language
                reps: {
                  type: "number",
                  min: 0,
                  integer: true,
                  label: { en: "Reps", "pt-BR": "Repetições", de: "Wiederholungen", es: "Repeticiones", pl: "Powtórzenia", it: "Ripetizioni" },
                },
                kind: {
                  type: "enum",
                  options: ["warmup", "drop"],
                  label: { en: "Kind", "pt-BR": "Tipo", de: "Art", es: "Tipo", pl: "Rodzaj", it: "Tipo" },
                  labels: {
                    warmup: { en: "warm-up", "pt-BR": "aquecimento", de: "Aufwärmen", es: "calentamiento", pl: "rozgrzewka", it: "riscaldamento" },
                    drop: { en: "drop", "pt-BR": "drop", de: "Dropsatz", es: "descendente", pl: "zrzutowa", it: "a scalare" },
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
          label: { en: "Personal records", "pt-BR": "Recordes pessoais", de: "Persönliche Bestwerte", es: "Récords personales", pl: "Rekordy osobiste", it: "Record personali" },
          of: {
            exercise: { type: "relation", to: "exercise", label: { en: "Exercise", "pt-BR": "Exercício", de: "Übung", es: "Ejercicio", pl: "Ćwiczenie", it: "Esercizio" } },
            kind: {
              type: "enum",
              options: ["heaviest", "e1rm", "reps"],
              label: { en: "Record", "pt-BR": "Recorde", de: "Bestwert", es: "Récord", pl: "Rekord", it: "Record" },
              labels: {
                heaviest: { en: "heaviest", "pt-BR": "mais pesado", de: "schwerster", es: "más pesado", pl: "najcięższy", it: "più pesante" },
                e1rm: { en: "estimated 1RM", "pt-BR": "1RM estimado", de: "geschätztes 1RM", es: "1RM estimado", pl: "szacowany 1RM", it: "1RM stimato" },
                reps: { en: "most reps", "pt-BR": "mais repetições", de: "meiste Wdh.", es: "más repeticiones", pl: "najwięcej powtórzeń", it: "più ripetizioni" },
              },
            },
            value: { type: "number", min: 0, label: { en: "Value", "pt-BR": "Valor", de: "Wert", es: "Valor", pl: "Wartość", it: "Valore" } },
          },
        },
        note: { type: "text", multiline: true, label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" } },
        // ---- v1: which training day it was. Kept so old sessions still say "Push"; the Train
        // screen points them at their routine the first time it opens (`adoptLegacyDays`). ----
        day: {
          type: "enum",
          options: ["push", "pull", "legs"],
          hidden: true,
          colors: { push: "red", pull: "blue", legs: "green" },
          label: { en: "Day", "pt-BR": "Dia", de: "Tag", es: "Día", pl: "Dzień", it: "Giorno" },
          labels: {
            push: { en: "push", "pt-BR": "empurrar", de: "Drücken", es: "empuje", pl: "pchanie", it: "spinta" },
            pull: { en: "pull", "pt-BR": "puxar", de: "Ziehen", es: "tracción", pl: "ciągnięcie", it: "trazione" },
            legs: { en: "legs", "pt-BR": "pernas", de: "Beine", es: "pierna", pl: "nogi", it: "gambe" },
          },
        },
      },
      computed: {
        // The routine's name; an old session that has none yet says its day; the date as the person's calendar writes it.
        title: {
          label: { en: "Routine", "pt-BR": "Rotina", de: "Routine", es: "Rutina", pl: "Plan", it: "Routine" },
          value: (s, ctx) => String(s.routine?.name ?? "") || dayName(s.day, ctx) || ctx.t({ en: "Workout", "pt-BR": "Treino", de: "Training", es: "Entreno", pl: "Trening", it: "Allenamento" }),
        },
        label: (s, ctx) =>
          `${String(s.routine?.name ?? "") || dayName(s.day, ctx) || ctx.t({ en: "Workout", "pt-BR": "Treino", de: "Training", es: "Entreno", pl: "Trening", it: "Allenamento" })} · ${ctx.format.date(dateOf(s.date), { weekday: "short", day: "numeric", month: "short" })}`,
        duration: {
          label: { en: "Duration", "pt-BR": "Duração", de: "Dauer", es: "Duración", pl: "Czas trwania", it: "Durata" },
          value: (s, ctx) => (num(s.durationSec) ? ctx.format.number(Math.round(num(s.durationSec) / 60), { style: "unit", unit: "minute" }) : "—"),
        },
        totalSets: {
          label: { en: "Total sets", "pt-BR": "Total de séries", de: "Sätze gesamt", es: "Series totales", pl: "Serie łącznie", it: "Serie totali" },
          value: (s) => ((s.entries as { sets?: unknown[] }[] | undefined) ?? []).reduce((n, e) => n + (e.sets?.length ?? 0), 0),
        },
        totalVolume: {
          label: { en: "Total volume (kg)", "pt-BR": "Volume total (kg)", de: "Gesamtvolumen (kg)", es: "Volumen total (kg)", pl: "Objętość łącznie (kg)", it: "Volume totale (kg)" },
          value: (s) =>
            ((s.entries as { sets?: LoggedSet[] }[] | undefined) ?? []).reduce((v, e) => v + working(e.sets ?? []).reduce((a, x) => a + num(x.kg) * num(x.reps), 0), 0),
        },
        /** The records it broke, as the summary said them: "🏆 Bench Press: 67.5 kg, heaviest yet". */
        prs: {
          label: { en: "Personal records", "pt-BR": "Recordes pessoais", de: "Persönliche Bestwerte", es: "Récords personales", pl: "Rekordy osobiste", it: "Record personali" },
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
          label: { en: "Log Set", "pt-BR": "Registrar série", de: "Satz eintragen", es: "Anotar serie", pl: "Zapisz serię", it: "Segna serie" },
          icon: "＋",
          run: async (s, ctx) => {
            // An entry whose exercise was deleted cannot be written back (its exercise is required);
            // the session keeps the rest.
            const entries = ((s.entries as { exercise?: unknown; sets?: LoggedSet[] }[] | undefined) ?? [])
              .map((e) => ({ exercise: refId(e.exercise), sets: [...(e.sets ?? [])] }))
              .filter((e) => e.exercise !== undefined);
            const last = entries[entries.length - 1];
            const lastSet = last?.sets[last.sets.length - 1];
            const logSet = ctx.t({ en: "Log set", "pt-BR": "Registrar série", de: "Satz eintragen", es: "Anotar serie", pl: "Zapisz serię", it: "Segna serie" });
            const set = await ctx.ui.form<{ exercise: string; kg: number; reps: number }>({
              title: logSet,
              submit: logSet,
              fields: {
                exercise: {
                  type: "relation",
                  to: "exercise",
                  required: true,
                  label: ctx.t({ en: "Exercise", "pt-BR": "Exercício", de: "Übung", es: "Ejercicio", pl: "Ćwiczenie", it: "Esercizio" }),
                },
                kg: { type: "number", label: ctx.t({ en: "Weight", "pt-BR": "Peso", de: "Gewicht", es: "Peso", pl: "Ciężar", it: "Peso" }), unit: "kg", min: 0 },
                reps: {
                  type: "number",
                  integer: true,
                  min: 0,
                  required: true,
                  label: ctx.t({ en: "Reps", "pt-BR": "Repetições", de: "Wiederholungen", es: "Repeticiones", pl: "Powtórzenia", it: "Ripetizioni" }),
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
                {
                  en: "Logged {kg} kg × {reps}",
                  "pt-BR": "Registrado: {kg} kg × {reps}",
                  de: "Eingetragen: {kg} kg × {reps}",
                  es: "Anotado: {kg} kg × {reps}",
                  pl: "Zapisano: {kg} kg × {reps}",
                  it: "Segnato: {kg} kg × {reps}",
                },
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
      title: { en: "Train", "pt-BR": "Treinar", de: "Trainieren", es: "Entrenar", pl: "Trenuj", it: "Allenamento" },
      icon: "🏋",
      view: {
        type: "custom",
        entity: "session",
        render: (props) => <Train {...props} />,
      },
    },
    {
      id: "history",
      title: { en: "History", "pt-BR": "Histórico", de: "Verlauf", es: "Historial", pl: "Historia", it: "Cronologia" },
      icon: "🗓",
      view: {
        type: "timeline",
        entity: "session",
        date: "date",
        groupBy: "week",
        display: {
          primary: "title",
          secondary: (s, ctx) => {
            const line = ctx.t(
              {
                en: "{sets, plural, one {# set} other {# sets}} · {volume} kg · {duration}",
                "pt-BR": "{sets, plural, one {# série} other {# séries}} · {volume} kg · {duration}",
                de: "{sets, plural, one {# Satz} other {# Sätze}} · {volume} kg · {duration}",
                es: "{sets, plural, one {# serie} other {# series}} · {volume} kg · {duration}",
                pl: "{sets, plural, one {# seria} few {# serie} many {# serii} other {# serii}} · {volume} kg · {duration}",
                it: "{sets, plural, one {# serie} other {# serie}} · {volume} kg · {duration}",
              },
              // "1,410" in English, "1410" in Polish: the person's own way of writing a number.
              { sets: num(s.totalSets), volume: ctx.format.number(Math.round(num(s.totalVolume))), duration: String(s.duration) },
            );
            const prs = ((s.records as unknown[] | undefined) ?? []).length;
            return prs
              ? `${line} · ${ctx.t({ en: "🏆 {n}", "pt-BR": "🏆 {n}", de: "🏆 {n}", es: "🏆 {n}", pl: "🏆 {n}", it: "🏆 {n}" }, { n: prs })}`
              : line;
          },
        },
        onOpen: { page: "session", param: { sessionId: "id" } },
        emptyText: {
          en: "No sessions logged yet. Hit Train to start one.",
          "pt-BR": "Nenhum treino registrado ainda. Toque em Treinar para começar.",
          de: "Noch keine Trainings eingetragen. Tippe auf Trainieren, um eins zu starten.",
          es: "Aún no hay sesiones. Pulsa Entrenar para empezar una.",
          pl: "Brak zapisanych treningów. Stuknij Trenuj, by zacząć.",
          it: "Ancora nessuna sessione. Tocca Allenamento per iniziarne una.",
        },
      },
    },
    {
      id: "progress",
      title: { en: "Progress", "pt-BR": "Progresso", de: "Fortschritt", es: "Progreso", pl: "Postępy", it: "Progressi" },
      icon: "📈",
      layout: {
        type: "stack",
        items: [
          {
            view: {
              type: "stats",
              entity: "session",
              items: [
                {
                  label: {
                    en: "Sessions this week",
                    "pt-BR": "Treinos nesta semana",
                    de: "Trainings diese Woche",
                    es: "Sesiones esta semana",
                    pl: "Treningi w tym tygodniu",
                    it: "Sessioni questa settimana",
                  },
                  value: (rows, ctx) => inWeek(rows, ctx.now(), 0).length,
                  compare: {
                    value: (rows, ctx) => inWeek(rows, ctx.now(), 1).length,
                    label: { en: "last week", "pt-BR": "na semana passada", de: "letzte Woche", es: "la semana pasada", pl: "w zeszłym tygodniu", it: "la settimana scorsa" },
                  },
                },
                {
                  label: {
                    en: "Volume this week",
                    "pt-BR": "Volume nesta semana",
                    de: "Volumen diese Woche",
                    es: "Volumen esta semana",
                    pl: "Objętość w tym tygodniu",
                    it: "Volume questa settimana",
                  },
                  unit: "kg",
                  value: (rows, ctx) => volume(inWeek(rows, ctx.now(), 0)),
                  compare: {
                    value: (rows, ctx) => volume(inWeek(rows, ctx.now(), 1)),
                    label: { en: "last week", "pt-BR": "na semana passada", de: "letzte Woche", es: "la semana pasada", pl: "w zeszłym tygodniu", it: "la settimana scorsa" },
                    as: "percent",
                  },
                },
                {
                  label: { en: "Average session", "pt-BR": "Treino médio", de: "Ø Trainingsdauer", es: "Sesión media", pl: "Średni trening", it: "Sessione media" },
                  unit: "min",
                  value: (rows, ctx) => avgMinutes(inWeek(rows, ctx.now(), 0)),
                  compare: {
                    value: (rows, ctx) => avgMinutes(inWeek(rows, ctx.now(), 1)),
                    label: { en: "last week", "pt-BR": "na semana passada", de: "letzte Woche", es: "la semana pasada", pl: "w zeszłym tygodniu", it: "la settimana scorsa" },
                  },
                },
                {
                  label: { en: "Weeks in a row", "pt-BR": "Semanas seguidas", de: "Wochen am Stück", es: "Semanas seguidas", pl: "Tygodnie z rzędu", it: "Settimane di fila" },
                  value: (rows, ctx) => streak(rows, ctx.now()),
                },
              ],
            },
          },
          {
            view: {
              type: "chart",
              entity: "session",
              title: { en: "Sessions per week", "pt-BR": "Treinos por semana", de: "Trainings pro Woche", es: "Sesiones por semana", pl: "Treningi w tygodniu", it: "Sessioni a settimana" },
              subtitle: { en: "Last 8 weeks", "pt-BR": "Últimas 8 semanas", de: "Letzte 8 Wochen", es: "Últimas 8 semanas", pl: "Ostatnie 8 tygodni", it: "Ultime 8 settimane" },
              series: (rows, ctx) =>
                [7, 6, 5, 4, 3, 2, 1, 0].map((back) => {
                  const d = new Date(weekStart(ctx.now()) - back * WEEK);
                  const n = inWeek(rows, ctx.now(), back).length;
                  return {
                    // "Jul 20" in American English, "20 lip" in Polish: the person's calendar.
                    label: ctx.format.date(d, { day: "numeric", month: "short" }),
                    value: n,
                    text: ctx.t(
                      {
                        en: "{n, plural, one {# session} other {# sessions}}",
                        "pt-BR": "{n, plural, one {# treino} other {# treinos}}",
                        de: "{n, plural, one {# Training} other {# Trainings}}",
                        es: "{n, plural, one {# sesión} other {# sesiones}}",
                        pl: "{n, plural, one {# trening} few {# treningi} many {# treningów} other {# treningu}}",
                        it: "{n, plural, one {# sessione} other {# sessioni}}",
                      },
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
              title: { en: "Sets per muscle", "pt-BR": "Séries por músculo", de: "Sätze pro Muskel", es: "Series por músculo", pl: "Serie na mięsień", it: "Serie per muscolo" },
              subtitle: { en: "This week", "pt-BR": "Esta semana", de: "Diese Woche", es: "Esta semana", pl: "Ten tydzień", it: "Questa settimana" },
              series: async (rows, ctx) => {
                const exercises = new Map((await ctx.query("exercise")).map((e) => [e.id, e] as const));
                const count = new Map<string, number>(MUSCLES.map((m) => [m, 0]));
                for (const s of inWeek(rows, ctx.now(), 0))
                  for (const entry of (s.entries as { exercise?: unknown; sets?: LoggedSet[] }[] | undefined) ?? []) {
                    const ex = exercises.get(refId(entry.exercise) ?? "");
                    const n = working(entry.sets ?? []).length;
                    for (const m of (ex?.muscles as string[] | undefined) ?? []) count.set(m, (count.get(m) ?? 0) + n);
                  }
                const words = ctx.t;
                const name: Record<string, string> = {
                  chest: words({ en: "chest", "pt-BR": "peito", de: "Brust", es: "pecho", pl: "klatka", it: "petto" }),
                  back: words({ en: "back", "pt-BR": "costas", de: "Rücken", es: "espalda", pl: "plecy", it: "schiena" }),
                  shoulders: words({ en: "shoulders", "pt-BR": "ombros", de: "Schultern", es: "hombros", pl: "barki", it: "spalle" }),
                  biceps: words({ en: "biceps", "pt-BR": "bíceps", de: "Bizeps", es: "bíceps", pl: "biceps", it: "bicipiti" }),
                  triceps: words({ en: "triceps", "pt-BR": "tríceps", de: "Trizeps", es: "tríceps", pl: "triceps", it: "tricipiti" }),
                  quads: words({ en: "quads", "pt-BR": "quadríceps", de: "Quadrizeps", es: "cuádriceps", pl: "czworogłowe", it: "quadricipiti" }),
                  hamstrings: words({ en: "hamstrings", "pt-BR": "posteriores", de: "Beinbeuger", es: "isquios", pl: "dwugłowe", it: "femorali" }),
                  glutes: words({ en: "glutes", "pt-BR": "glúteos", de: "Gesäß", es: "glúteos", pl: "pośladki", it: "glutei" }),
                  calves: words({ en: "calves", "pt-BR": "panturrilhas", de: "Waden", es: "gemelos", pl: "łydki", it: "polpacci" }),
                  core: words({ en: "core", "pt-BR": "core", de: "Rumpf", es: "core", pl: "core", it: "core" }),
                };
                return MUSCLES.map((m) => ({
                  label: name[m]!,
                  value: count.get(m) ?? 0,
                  text: ctx.t(
                    {
                      en: "{n, plural, one {# set} other {# sets}}",
                      "pt-BR": "{n, plural, one {# série} other {# séries}}",
                      de: "{n, plural, one {# Satz} other {# Sätze}}",
                      es: "{n, plural, one {# serie} other {# series}}",
                      pl: "{n, plural, one {# seria} few {# serie} many {# serii} other {# serii}}",
                      it: "{n, plural, one {# serie} other {# serie}}",
                    },
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
      title: { en: "Program", "pt-BR": "Programa", de: "Programm", es: "Programa", pl: "Program", it: "Programma" },
      icon: "📋",
      description: {
        en: "Routines take turns in the order you give them. Tap one to change its exercises.",
        "pt-BR": "As rotinas se revezam na ordem que você define. Toque numa para mudar os exercícios.",
        de: "Routinen wechseln sich in deiner Reihenfolge ab. Tippe eine an, um ihre Übungen zu ändern.",
        es: "Las rutinas se turnan en el orden que les des. Toca una para cambiar sus ejercicios.",
        pl: "Plany idą na zmianę w ustalonej kolejności. Stuknij plan, by zmienić ćwiczenia.",
        it: "Le routine si alternano nell'ordine che scegli. Toccane una per cambiarne gli esercizi.",
      },
      layout: {
        type: "stack",
        items: [
          {
            title: { en: "Routines", "pt-BR": "Rotinas", de: "Routinen", es: "Rutinas", pl: "Plany", it: "Routine" },
            view: {
              type: "list",
              entity: "routine",
              sort: (a, b) => Number(b.active !== false) - Number(a.active !== false) || String(a.program ?? "").localeCompare(String(b.program ?? "")) || num(a.order) - num(b.order),
              display: {
                primary: "name",
                secondary: (r, ctx) =>
                  [r.program ? String(r.program) : "", String(r.summary ?? ""), r.active === false ? ctx.t({ en: "resting", "pt-BR": "em pausa", de: "pausiert", es: "en pausa", pl: "wstrzymany", it: "in pausa" }) : ""]
                    .filter(Boolean)
                    .join(" · "),
                lead: "icon",
              },
              onOpen: { page: "routine", param: { routineId: "id" } },
            },
          },
          {
            title: { en: "Exercises", "pt-BR": "Exercícios", de: "Übungen", es: "Ejercicios", pl: "Ćwiczenia", it: "Esercizi" },
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
                    ? ctx.t({ en: "bodyweight", "pt-BR": "peso corporal", de: "Eigengewicht", es: "peso corporal", pl: "masa ciała", it: "corpo libero" })
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
      title: { en: "Routine", "pt-BR": "Rotina", de: "Routine", es: "Rutina", pl: "Plan", it: "Routine" },
      hidden: true,
      view: {
        type: "detail",
        entity: "routine",
        param: "routineId",
        facts: ["program"],
        sections: [
          { title: { en: "Routine", "pt-BR": "Rotina", de: "Routine", es: "Rutina", pl: "Plan", it: "Routine" }, fields: ["summary", "lastDone", "active", "order"] },
          { title: { en: "Exercises", "pt-BR": "Exercícios", de: "Übungen", es: "Ejercicios", pl: "Ćwiczenia", it: "Esercizi" }, fields: ["exercises"] },
          { title: { en: "Notes", "pt-BR": "Anotações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" }, fields: ["note"] },
        ],
      },
    },
    {
      // An exercise: what it is, how it progresses, and the curve of its estimated 1RM — the chart is
      // the exercise records filtered to this one, so it follows the page's own `exerciseId`.
      id: "exercise",
      title: { en: "Exercise", "pt-BR": "Exercício", de: "Übung", es: "Ejercicio", pl: "Ćwiczenie", it: "Esercizio" },
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
              sections: [
                {
                  title: { en: "Your numbers", "pt-BR": "Seus números", de: "Deine Zahlen", es: "Tus números", pl: "Twoje liczby", it: "I tuoi numeri" },
                  fields: ["lastBest", "best"],
                },
                {
                  title: { en: "Progression", "pt-BR": "Progressão", de: "Steigerung", es: "Progresión", pl: "Progresja", it: "Progressione" },
                  fields: ["repRange", "step", "restSec", "bodyweight"],
                },
                { title: { en: "Notes", "pt-BR": "Anotações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" }, fields: ["cue"] },
              ],
            },
          },
          {
            view: {
              type: "chart",
              entity: "exercise",
              filter: (e, ctx) => e.id === ctx.params.exerciseId,
              title: { en: "Estimated 1RM", "pt-BR": "1RM estimado", de: "Geschätztes 1RM", es: "1RM estimado", pl: "Szacowany 1RM", it: "1RM stimato" },
              subtitle: { en: "Every session, oldest first", "pt-BR": "Cada treino, do mais antigo", de: "Jedes Training, älteste zuerst", es: "Cada sesión, la más antigua primero", pl: "Każdy trening, od najstarszego", it: "Ogni sessione, dalla più vecchia" },
              emptyText: {
                en: "Log this exercise and its curve starts here.",
                "pt-BR": "Registre este exercício e a curva começa aqui.",
                de: "Trag diese Übung ein, und hier beginnt ihre Kurve.",
                es: "Anota este ejercicio y aquí empieza su curva.",
                pl: "Zapisz to ćwiczenie, a tu zacznie się jego krzywa.",
                it: "Registra questo esercizio e qui inizia la sua curva.",
              },
              series: (rows, ctx) =>
                ((rows[0]?.progress as { date: string; value: number }[] | undefined) ?? []).slice(-12).map((p) => ({
                  label: ctx.format.date(p.date, { day: "numeric", month: "short" }),
                  value: p.value,
                  text: rows[0]?.bodyweight
                    ? ctx.t({ en: "{n} reps", "pt-BR": "{n} reps", de: "{n} Wdh.", es: "{n} reps", pl: "{n} powt.", it: "{n} rip." }, { n: p.value })
                    : `${kgText(ctx, p.value)} kg`,
                })),
            },
          },
        ],
      },
    },
    {
      id: "session",
      title: { en: "Session", "pt-BR": "Treino", de: "Training", es: "Sesión", pl: "Trening", it: "Sessione" },
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
            title: { en: "Overview", "pt-BR": "Visão geral", de: "Überblick", es: "Resumen", pl: "Przegląd", it: "Panoramica" },
            fields: ["title", "date", "duration", "totalSets", "totalVolume"],
          },
          { title: { en: "Personal records", "pt-BR": "Recordes pessoais", de: "Persönliche Bestwerte", es: "Récords personales", pl: "Rekordy osobiste", it: "Record personali" }, fields: ["prs"] },
          // nested list rendered in the detail view
          { title: { en: "Entries", "pt-BR": "Exercícios", de: "Übungen", es: "Ejercicios", pl: "Ćwiczenia", it: "Esercizi" }, fields: ["entries"] },
          { title: { en: "Notes", "pt-BR": "Anotações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" }, fields: ["note"] },
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
