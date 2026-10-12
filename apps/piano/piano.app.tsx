// piano.app.tsx — a personal piano practice app.
//
// The lesson content lives in `plan.json`, never here: this file only knows that a plan has phases,
// weeks, five daily blocks, "done when" goals and optional modules (see `plan.ts`). Where you are in
// the plan is `progress.ts`, stored in `ctx.storage`; what you did each day is a `session` record;
// the weekly review is a `weekLog` record.
//
// It imports `plan.ts`, `progress.ts` and `styles.ts` directly: `pnpm pack:app` packs them as the
// package's `src/`, and the shell resolves `./plan.js` from there (#258). This file stays the one the
// Studio, History and Ask edit; plan.json ships beside it as data.
import { defineApp } from "potyro";
import type { Ctx, Resolved, ViewProps } from "potyro";
import { useCallback, useEffect, useRef, useState } from "react";
import { blocksForWeek, mainWeeks, resolveLink, startingWeekNumber, validatePlan } from "./plan.js";
import type { Plan, PlanLink, PlanModule } from "./plan.js";
import {
  WEEKDAYS,
  currentWeek,
  cycleStart,
  dayNumber,
  daysPractised,
  defaultProgress,
  goalMet,
  isReviewDay,
  isRestDay,
  isoDay,
  jumpTo,
  parseDay,
  leaveModule,
  moduleWarning,
  reconcileProgress,
  repeatWeek,
  sessionsInCycle,
  setReviewWeekday,
  setStartDate,
  startModule,
  todayBlocks,
} from "./progress.js";
import type { DayBlock, Progress } from "./progress.js";
import { CSS } from "./styles.js";

// ---- the built-in plan ships WITH the app, as `plan.json` in its own folder (#253) ----
// Read through ctx.files rather than inlined: the plan can change without rebuilding the app, and a
// new version of the app replaces it unless you edited it. Checked on every read; a broken plan says
// so on the Plan page rather than silently falling back.
async function builtInPlan(ctx: Ctx): Promise<Plan> {
  const raw = await ctx.files.json("plan.json");
  if (raw == null) throw new Error("plan.json has not reached this device yet");
  const checked = validatePlan(raw);
  if (!checked.ok) throw new Error(`plan.json is not a valid plan:\n${checked.errors.join("\n")}`);
  return checked.plan;
}

const PLAN_KEY = "plan";
const PLAN_SOURCE_KEY = "planSource";
const PROGRESS_KEY = "progress";
const TICK_MS = 250;

// ---- shared state: every custom view reads the same plan + progress and hears every change ----

interface State {
  plan: Plan;
  planSource: string;
  progress: Progress;
}

const listeners = new Set<() => void>();
const announce = (): void => listeners.forEach((l) => l());

async function loadState(ctx: Ctx): Promise<State> {
  const today = ctx.today();
  const stored = await ctx.storage.get<unknown>(PLAN_KEY);
  const checked = stored ? validatePlan(stored) : null;
  const plan = checked && checked.ok ? checked.plan : await builtInPlan(ctx);
  const planSource = (checked && checked.ok && (await ctx.storage.get<string>(PLAN_SOURCE_KEY))) || "built-in";
  const saved = await ctx.storage.get<Progress>(PROGRESS_KEY);
  const progress = reconcileProgress(plan, saved ?? defaultProgress(plan, today), today);
  return { plan, planSource, progress };
}

function usePianoState(ctx: Ctx): { state: State | null; error: string | null; update: (fn: (p: Progress) => Progress) => Promise<void>; reload: () => Promise<void> } {
  const [state, setState] = useState<State | null>(null);
  // A plan that cannot be read says why, instead of "Loading…" forever.
  const [error, setError] = useState<string | null>(null);
  // `runtime.ctx` is a fresh object on every access, so it must never be a hook dependency: read
  // the latest one through a ref and keep the callbacks stable for the life of the view.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const reload = useCallback(async () => {
    try {
      setState(await loadState(ctxRef.current));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void reload();
    listeners.add(reload);
    return () => {
      listeners.delete(reload);
    };
  }, [reload]);
  const update = useCallback(async (fn: (p: Progress) => Progress) => {
    const current = await loadState(ctxRef.current);
    const next = fn(current.progress);
    if (next === current.progress) return;
    await ctxRef.current.storage.set(PROGRESS_KEY, next);
    announce();
  }, []);
  return { state, error, update, reload };
}

const mmss = (totalSec: number): string => `${Math.floor(totalSec / 60)}:${String(Math.max(0, totalSec % 60)).padStart(2, "0")}`;
const longDate = (d: Date): string => d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

function Links({ plan, links }: { plan: Plan; links: PlanLink[] }) {
  const resolved = links.map((l) => resolveLink(plan, l)).filter((l): l is { title: string; url: string } => l !== null);
  if (resolved.length === 0) return null;
  return (
    <ul className="pn-links">
      {resolved.map((l) => (
        <li key={l.url}>
          <a href={l.url} target="_blank" rel="noreferrer noopener">
            {l.title} ↗
          </a>
        </li>
      ))}
    </ul>
  );
}

// ---- Today ----

interface Timer {
  blockId: string;
  label: string;
  endsAt: number | null; // running: when it hits zero
  remaining: number; // seconds, meaningful when paused
}

function Today(props: ViewProps) {
  const { runtime, navigate } = props;
  const ctx = runtime.ctx;
  const { state, error, update } = usePianoState(ctx);
  const today = ctx.today();
  const todayKey = isoDay(today);
  const { rows: sessions, loading } = runtime.useQuery("session");
  const session = sessions.find((s: Resolved) => s.date instanceof Date && isoDay(s.date) === todayKey) ?? null;
  const [showAnyway, setShowAnyway] = useState(false);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [, setNow] = useState(0);
  const timerRef = useRef<Timer | null>(null);
  timerRef.current = timer;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  // Today's session, written through one queue so two quick taps cannot create two records for the
  // same day: each write re-reads the record it is about to change, and a create remembers its id
  // before the query watcher has caught up.
  const sessionIdRef = useRef<string | null>(null);
  const writesRef = useRef<Promise<void>>(Promise.resolve());

  // One clock for the running timer. When it reaches zero it says so once, buzzes, and stops.
  useEffect(() => {
    if (!timer?.endsAt) return;
    const id = setInterval(() => {
      const t = timerRef.current;
      if (!t?.endsAt) return;
      if (t.endsAt - Date.now() > 0) {
        setNow(Date.now());
        return;
      }
      void ctxRef.current.caps.haptics?.vibrate([0, 300, 150, 300]);
      ctxRef.current.ui.toast(`${t.label}: time's up`);
      setTimer({ ...t, endsAt: null, remaining: 0 });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [timer?.endsAt]);

  if (!state) return <div className="pn-load">{error ?? "Loading…"}</div>;
  const { plan, progress } = state;
  const cur = currentWeek(plan, progress, today);
  if (!cur) return <div className="pn-load">This plan has no weeks. Load one on the Modules tab.</div>;

  const day = dayNumber(progress, today);
  const rest = isRestDay(progress, today);
  const review = isReviewDay(progress, today);
  const blocks = rest && !showAnyway ? [] : todayBlocks(plan, progress, today, { ignoreRest: showAnyway });
  const done = new Set<string>(Array.isArray(session?.blocksDone) ? (session!.blocksDone as string[]) : []);
  const restTaken = Boolean(session?.rest);
  const beforeStart = today.getTime() < parseDay(progress.startDate).getTime();

  const remainingFor = (b: DayBlock): number => {
    if (!timer || timer.blockId !== b.id) return b.minutes * 60;
    if (timer.endsAt == null) return timer.remaining;
    return Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
  };
  const start = (b: DayBlock): void => {
    const remaining = timer?.blockId === b.id && timer.endsAt == null && timer.remaining > 0 ? timer.remaining : b.minutes * 60;
    setTimer({ blockId: b.id, label: b.label, endsAt: Date.now() + remaining * 1000, remaining });
  };
  const pause = (b: DayBlock): void => setTimer({ blockId: b.id, label: b.label, endsAt: null, remaining: remainingFor(b) });
  const reset = (): void => setTimer(null);

  if (session && sessionIdRef.current !== session.id) sessionIdRef.current = session.id;
  type SessionState = { blocksDone: string[]; rest: boolean };
  const writeSession = (change: (cur: SessionState) => Partial<SessionState>): Promise<void> => {
    const run = async (): Promise<void> => {
      const id = sessionIdRef.current;
      const rec = id ? await runtime.ctx.get("session", id) : null;
      const cur: SessionState = { blocksDone: Array.isArray(rec?.blocksDone) ? (rec!.blocksDone as string[]) : [], rest: Boolean(rec?.rest) };
      const patch = change(cur);
      if (rec) {
        await runtime.patch("session", rec.id, patch);
        return;
      }
      const weekId = progress.module ? `${progress.weekId}+${progress.module.id}` : progress.weekId;
      const created = await runtime.create("session", { date: today, weekId, blocksDone: [], rest: false, ...patch });
      sessionIdRef.current = created.id;
    };
    const next = writesRef.current.then(run, run);
    writesRef.current = next.catch(() => undefined);
    return next;
  };
  const order = plan.blocks.map((x) => x.id);
  const toggle = async (b: DayBlock): Promise<void> => {
    if (loading) return;
    const turningOn = !done.has(b.id);
    if (turningOn) {
      void ctx.caps.haptics?.vibrate(30);
      if (timer?.blockId === b.id) setTimer(null);
    }
    await writeSession((cur) => {
      const set = new Set(cur.blocksDone);
      if (set.has(b.id)) set.delete(b.id);
      else set.add(b.id);
      return { blocksDone: order.filter((id) => set.has(id)) };
    });
  };
  const toggleRest = async (): Promise<void> => {
    if (loading) return;
    await writeSession((cur) => ({ rest: !cur.rest }));
  };

  const logWeek = async (): Promise<void> => {
    const practised = daysPractised(sessions, progress, today);
    const label = cur.module ? `${cur.week.label} · ${cur.module.title} week ${cur.moduleWeekNumber}` : cur.week.label;
    const values = await ctx.ui.form<{ week: string; daysPractised: number; recorded: string; tempoBpm: number; fix: string; notes: string }>({
      title: "Log this week",
      submit: "Save log",
      fields: {
        week: { type: "text", required: true },
        daysPractised: { type: "number", label: "Days practised", integer: true, min: 0, max: 7, required: true },
        recorded: { type: "text", label: "Piece / exercise recorded" },
        tempoBpm: { type: "number", label: "Tempo reached", unit: "bpm", integer: true, min: 0 },
        fix: { type: "text", label: "One thing to fix", multiline: true },
        notes: { type: "text", multiline: true },
      },
      initial: { week: label, daysPractised: practised },
    });
    if (!values) return;
    await runtime.create("weekLog", { ...values, date: today, weekId: progress.weekId });
    ctx.ui.toast("Week logged");
    navigate("log");
  };

  const met = async (): Promise<void> => {
    const last = !cur.module && cur.index === cur.total - 1;
    const ok = await ctx.ui.confirm(cur.module ? `Module week ${cur.moduleWeekNumber} of ${cur.moduleWeeksTotal} done?` : `${cur.week.label} done?`, {
      detail: last ? "This is the last week of the plan." : `Done when: ${cur.goal}`,
      ok: "Goal met",
    });
    if (!ok) return;
    await update((p) => goalMet(plan, p, ctx.now()));
    void ctx.caps.haptics?.vibrate([0, 80, 60, 80]);
  };
  const again = async (): Promise<void> => {
    const ok = await ctx.ui.confirm(`Repeat ${cur.module ? "this module week" : cur.week.label}?`, { detail: "Repeating a week is normal.", ok: "Repeat" });
    if (!ok) return;
    await update((p) => repeatWeek(plan, p, ctx.now()));
  };

  const cycle = sessionsInCycle(sessions, progress, today);
  const cycleFrom = cycleStart(progress, today);
  const dots = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(cycleFrom.getTime() + i * 86_400_000);
    const key = isoDay(d);
    const s = cycle.find((x) => isoDay(x.date) === key);
    const practised = Array.isArray(s?.blocksDone) && (s!.blocksDone as unknown[]).length > 0;
    return { key, practised, rest: Boolean(s?.rest), today: key === todayKey, future: d.getTime() > today.getTime() };
  });

  const doneCount = blocks.filter((b) => done.has(b.id)).length;

  return (
    <div className="pn">
      <style>{CSS}</style>
      <header className="pn-head">
        <p className="pn-eyebrow">
          {cur.phase.title} · {cur.phase.span ?? ""}
        </p>
        <h1 className="pn-title">
          {cur.week.label}
          {cur.spanWeeks > 1 ? <span className="pn-title-sub"> · week {cur.weekOfSpan} of {cur.spanWeeks}</span> : null}
        </h1>
        <p className="pn-meta">
          <span>{longDate(today)}</span>
          <span className="pn-pill" data-tone={rest ? "rest" : review ? "review" : "day"}>
            {rest ? "Day 7 · rest" : `Day ${day} of 7`}
            {review && !rest ? " · review day" : ""}
          </span>
          {cur.module ? (
            <span className="pn-pill" data-tone="module">
              {cur.module.title} · week {cur.moduleWeekNumber} of {cur.moduleWeeksTotal}
            </span>
          ) : null}
          {cur.repeats > 0 ? <span className="pn-pill">repeat {cur.repeats}</span> : null}
        </p>
        {beforeStart ? <p className="pn-note">The plan starts on {parseDay(progress.startDate).toLocaleDateString()}. Change it on the Modules tab.</p> : null}
        <ol className="pn-dots" aria-label="This week">
          {dots.map((d, i) => (
            <li key={d.key} data-on={d.practised} data-rest={d.rest} data-today={d.today} data-future={d.future} title={d.key}>
              {i + 1}
            </li>
          ))}
        </ol>
      </header>

      {rest && !showAnyway ? (
        <section className="pn-rest">
          <h2>Rest day</h2>
          <p>{plan.restDay.text}</p>
          <div className="pn-row">
            <button className="pn-btn" data-on={restTaken} onClick={() => void toggleRest()}>
              {restTaken ? "✓ Rested" : "Mark as rested"}
            </button>
            <button className="pn-btn pn-btn-quiet" onClick={() => setShowAnyway(true)}>
              Practise anyway
            </button>
          </div>
        </section>
      ) : (
        <ol className="pn-blocks">
          {blocks.map((b, i) => {
            const isDone = done.has(b.id);
            const mine = timer?.blockId === b.id;
            const running = mine && timer!.endsAt != null;
            const remaining = remainingFor(b);
            return (
              <li key={b.id} className="pn-block" data-done={isDone} data-running={running} data-module={b.fromModule} data-review={b.review}>
                <div className="pn-block-head">
                  <span className="pn-block-n">{i + 1}</span>
                  <div className="pn-block-title">
                    <h2>{b.label}</h2>
                    <span className="pn-block-tags">
                      {b.minutes} min{b.fromModule ? ` · ${cur.module?.title ?? "module"}` : ""}
                      {b.review ? " · review" : ""}
                    </span>
                  </div>
                  <button className="pn-check" data-on={isDone} onClick={() => void toggle(b)} aria-label={`${b.label} done`} aria-pressed={isDone}>
                    ✓
                  </button>
                </div>
                <p className="pn-block-text">{b.text}</p>
                <Links plan={plan} links={b.links} />
                {b.review ? (
                  <button className="pn-btn" onClick={() => void logWeek()}>
                    Log this week
                  </button>
                ) : null}
                <div className="pn-timer" role="timer" aria-label={`${b.label} timer`}>
                  <span className="pn-timer-n" data-zero={mine && remaining === 0}>
                    {mmss(remaining)}
                  </span>
                  {running ? (
                    <button className="pn-btn pn-btn-small" onClick={() => pause(b)}>
                      Pause
                    </button>
                  ) : (
                    <button className="pn-btn pn-btn-small" onClick={() => start(b)} disabled={mine && remaining === 0}>
                      {mine && remaining > 0 && remaining < b.minutes * 60 ? "Resume" : "Start"}
                    </button>
                  )}
                  {mine ? (
                    <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={reset}>
                      Reset
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <section className="pn-goal">
        <p className="pn-eyebrow">Done when</p>
        <p className="pn-goal-text">{cur.goal}</p>
        {!rest || showAnyway ? (
          <p className="pn-note">
            {doneCount}/{blocks.length} blocks today
          </p>
        ) : null}
        {progress.completed && !cur.module ? (
          <p className="pn-note">You have met the last goal of this plan. Time to ask for a new one.</p>
        ) : (
          <div className="pn-row">
            <button className="pn-btn pn-btn-primary" onClick={() => void met()}>
              Goal met → next
            </button>
            <button className="pn-btn" onClick={() => void again()}>
              Repeat this week
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

// ---- Plan ----

function PlanView(props: ViewProps) {
  const ctx = props.runtime.ctx;
  const { state, error, update } = usePianoState(ctx);
  if (!state) return <div className="pn-load">{error ?? "Loading…"}</div>;
  const { plan, progress } = state;
  const today = ctx.today();
  const cur = currentWeek(plan, progress, today);
  const weeks = mainWeeks(plan);

  const go = async (weekId: string, label: string): Promise<void> => {
    const ok = await ctx.ui.confirm(`Go to ${label}?`, { detail: progress.module ? "This also leaves the running module." : undefined, ok: "Go" });
    if (!ok) return;
    await update((p) => jumpTo(plan, p, weekId, ctx.now()));
  };

  return (
    <div className="pn">
      <style>{CSS}</style>
      <header className="pn-head">
        <p className="pn-eyebrow">Plan · {plan.version}</p>
        <h1 className="pn-title">{plan.title}</h1>
        {plan.rules?.length ? (
          <ol className="pn-rules">
            {plan.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ol>
        ) : null}
      </header>

      {plan.phases.map((phase) => (
        <section key={phase.id} className="pn-phase">
          <p className="pn-eyebrow">{phase.span ?? "Phase"}</p>
          <h2>{phase.title}</h2>
          <p className="pn-phase-goal">{phase.goal}</p>
          <ol className="pn-weeks">
            {phase.weeks.map((w) => {
              const index = weeks.findIndex((x) => x.week.id === w.id);
              const status = cur ? (index < cur.index ? "done" : index === cur.index ? "current" : "ahead") : "ahead";
              const n = startingWeekNumber(plan, w.id);
              const blocks = blocksForWeek(plan, w.id);
              return (
                <li key={w.id} className="pn-week" data-status={status}>
                  <div className="pn-week-head">
                    <div>
                      <h3>
                        {w.label}
                        <span className="pn-week-n"> · plan week {n}{(w.spanWeeks ?? 1) > 1 ? `–${n + (w.spanWeeks ?? 1) - 1}` : ""}</span>
                      </h3>
                      <p className="pn-week-goal">Done when: {w.doneWhen}</p>
                    </div>
                    {status === "current" ? (
                      <span className="pn-pill" data-tone="day">
                        now{(progress.repeats[w.id] ?? 0) > 0 ? ` · repeat ${progress.repeats[w.id]}` : ""}
                      </span>
                    ) : (
                      <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={() => void go(w.id, w.label)}>
                        {status === "done" ? "Back here" : "Jump here"}
                      </button>
                    )}
                  </div>
                  <details className="pn-week-blocks">
                    <summary>The five blocks</summary>
                    <ul>
                      {plan.blocks.map((b) => (
                        <li key={b.id}>
                          <strong>{b.label}</strong> <span>{blocks[b.id]?.text ?? b.source ?? ""}</span>
                          <Links plan={plan} links={blocks[b.id]?.links ?? []} />
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ol>
          {phase.notes?.length ? (
            <ul className="pn-notes">
              {phase.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}

      <section className="pn-phase">
        <p className="pn-eyebrow">Core resources</p>
        <ul className="pn-resources">
          {plan.resources.map((r) => (
            <li key={r.id}>
              <a href={r.url} target="_blank" rel="noreferrer noopener">
                {r.title} ↗
              </a>
              <span className="pn-res-kind">{[r.kind, r.when].filter(Boolean).join(" · ")}</span>
              {r.why ? <p>{r.why}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---- Modules & settings ----

function ModulesView(props: ViewProps) {
  const ctx = props.runtime.ctx;
  const { state, error, update, reload } = usePianoState(ctx);
  if (!state) return <div className="pn-load">{error ?? "Loading…"}</div>;
  const { plan, progress, planSource } = state;
  const today = ctx.today();
  const cur = currentWeek(plan, progress, today);

  const begin = async (m: PlanModule): Promise<void> => {
    const warn = moduleWarning(plan, progress, m);
    const [min, max] = m.suggestedWeeks ?? [m.weeks.length, m.weeks.length];
    const values = await ctx.ui.form<{ weeks: number }>({
      title: `Start ${m.title}`,
      submit: "Start",
      fields: { weeks: { type: "number", label: "For how many weeks", integer: true, min: 1, max: 52, default: min, help: `${warn ? `${warn} ` : ""}Usually ${min}–${max} weeks; blocks 2 and 4 follow the module, then the plan resumes at ${cur?.week.label ?? "where you left it"}.` } },
      initial: { weeks: min },
    });
    if (!values) return;
    await update((p) => startModule(plan, p, m.id, Number(values.weeks), ctx.now()));
    ctx.ui.toast(`${m.title} for ${values.weeks} week${Number(values.weeks) === 1 ? "" : "s"}`);
    props.navigate("today");
  };
  const leave = async (): Promise<void> => {
    if (!(await ctx.ui.confirm("Leave the module now?", { detail: `Back to ${cur?.week.label ?? "the plan"} where you left it.`, ok: "Leave" }))) return;
    await update((p) => leaveModule(plan, p, ctx.now()));
  };

  const pickStartDate = async (): Promise<void> => {
    const v = await ctx.ui.form<{ startDate: Date }>({
      title: "Start date",
      submit: "Save",
      fields: { startDate: { type: "datetime", label: "Day 1 of week 1", required: true, help: "Day 7 of every cycle is the rest day" } },
      initial: { startDate: parseDay(progress.startDate) },
    });
    if (!v?.startDate) return;
    const d = v.startDate instanceof Date ? v.startDate : new Date(String(v.startDate));
    await update((p) => setStartDate(p, isoDay(d)));
  };
  const pickReviewDay = async (): Promise<void> => {
    const choice = await ctx.ui.sheet<number>({ title: "Review day", items: WEEKDAYS.map((w, i) => ({ id: i, label: w, detail: i === progress.reviewWeekday ? "current" : undefined })) });
    if (choice == null) return;
    await update((p) => setReviewWeekday(p, choice));
  };
  const loadPlan = async (): Promise<void> => {
    // Imported into the app's folder (plans/), so the person picks it once and it stays with the
    // app; no file permission is needed for that, in the sealed box either.
    const [file] = await ctx.files.import({ folder: "plans", accept: ".json,application/json" });
    if (!file) return; // cancelled
    const blob = { text: async () => (await ctx.files.text(file)) ?? "", name: file.name };
    let parsed: unknown;
    try {
      parsed = JSON.parse(await blob.text());
    } catch {
      ctx.ui.toast("That file is not JSON");
      return;
    }
    const checked = validatePlan(parsed);
    if (!checked.ok) {
      await ctx.ui.confirm("The plan file has problems", { detail: checked.errors.slice(0, 6).join("\n"), ok: "OK" });
      return;
    }
    const name = blob.name;
    if (!(await ctx.ui.confirm(`Use “${checked.plan.title}” (${checked.plan.version})?`, { detail: "Your progress and logs are kept; a week the new plan does not have falls back to its first week.", ok: "Use this plan" }))) return;
    await ctx.storage.set(PLAN_KEY, checked.plan);
    await ctx.storage.set(PLAN_SOURCE_KEY, name);
    announce();
    await reload();
    ctx.ui.toast("Plan loaded");
  };
  const useBuiltIn = async (): Promise<void> => {
    const builtIn = await builtInPlan(ctx);
    if (!(await ctx.ui.confirm("Go back to the built-in plan?", { detail: `${builtIn.title} (${builtIn.version})`, ok: "Use built-in" }))) return;
    await ctx.storage.delete(PLAN_KEY);
    await ctx.storage.delete(PLAN_SOURCE_KEY);
    announce();
    await reload();
  };
  const resetProgress = async (): Promise<void> => {
    if (!(await ctx.ui.confirm("Start the plan over?", { detail: "Progress goes back to week 1 from today. Sessions and logs are kept.", ok: "Start over", destructive: true }))) return;
    await update(() => defaultProgress(plan, today));
  };

  return (
    <div className="pn">
      <style>{CSS}</style>
      <header className="pn-head">
        <p className="pn-eyebrow">Modules</p>
        <h1 className="pn-title">Blues, jazz and the plan itself</h1>
      </header>

      {progress.module && cur?.module ? (
        <section className="pn-card" data-tone="module">
          <p className="pn-eyebrow">Running</p>
          <h2>
            {cur.module.title} · week {cur.moduleWeekNumber} of {cur.moduleWeeksTotal}
          </h2>
          <p>Done when: {cur.goal}</p>
          <p className="pn-note">Returns to {cur.week.label} afterwards.</p>
          <button className="pn-btn" onClick={() => void leave()}>
            Leave module
          </button>
        </section>
      ) : null}

      {plan.modules.map((m) => {
        const warn = moduleWarning(plan, progress, m);
        const active = progress.module?.id === m.id;
        return (
          <section key={m.id} className="pn-card">
            <h2>{m.title}</h2>
            {m.intro ? <p>{m.intro}</p> : null}
            {m.suggestedWeeks ? (
              <p className="pn-note">
                Usually {m.suggestedWeeks[0]}–{m.suggestedWeeks[1]} weeks · {m.weeks.length} weeks of material
              </p>
            ) : null}
            {warn ? <p className="pn-warn">{warn}</p> : null}
            <details className="pn-week-blocks">
              <summary>The weeks</summary>
              <ol className="pn-module-weeks">
                {m.weeks.map((w, i) => (
                  <li key={w.id}>
                    <strong>Week {i + 1}</strong>
                    <ul>
                      {Object.entries(w.blocks).map(([id, c]) => (
                        <li key={id}>
                          <em>{plan.blocks.find((b) => b.id === id)?.label ?? id}:</em> {c.text}
                          <Links plan={plan} links={c.links ?? []} />
                        </li>
                      ))}
                    </ul>
                    <p className="pn-week-goal">Done when: {w.doneWhen}</p>
                  </li>
                ))}
              </ol>
              {m.notes?.length ? (
                <ul className="pn-notes">
                  {m.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </details>
            <button className="pn-btn pn-btn-primary" disabled={active} onClick={() => void begin(m)}>
              {active ? "Running" : `Start ${m.title.toLowerCase()}`}
            </button>
          </section>
        );
      })}

      <section className="pn-card">
        <p className="pn-eyebrow">Settings</p>
        <dl className="pn-settings">
          <div>
            <dt>Start date</dt>
            <dd>
              {parseDay(progress.startDate).toLocaleDateString()}{" "}
              <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={() => void pickStartDate()}>
                Change
              </button>
            </dd>
          </div>
          <div>
            <dt>Review day</dt>
            <dd>
              {WEEKDAYS[progress.reviewWeekday]}{" "}
              <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={() => void pickReviewDay()}>
                Change
              </button>
            </dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>
              {plan.title} · {plan.version} <span className="pn-note">({planSource})</span>
              <div className="pn-row">
                <button className="pn-btn pn-btn-small" onClick={() => void loadPlan()}>
                  Load plan file…
                </button>
                {planSource !== "built-in" ? (
                  <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={() => void useBuiltIn()}>
                    Use built-in
                  </button>
                ) : null}
              </div>
            </dd>
          </div>
          <div>
            <dt>Progress</dt>
            <dd>
              {progress.history.length} moves since {new Date(progress.history[0]?.at ?? progress.weekStartedAt).toLocaleDateString()}{" "}
              <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={() => void resetProgress()}>
                Start over
              </button>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}


export default defineApp({
  id: "piano",
  name: "Piano",
  icon: "🎹",
  version: "1.0.0",
  schemaVersion: 1,
  theme: { accent: "#C9772B" },
  permissions: { haptics: true }, // a buzz when a timer ends (a plan file comes in through ctx.files, which needs none)
  nav: "tabs",

  quickActions: [{ id: "log-week", label: "Log this week", icon: "📝", entity: "weekLog", mode: "form" }],

  entities: {
    // One per day: which blocks you ticked. Written by the Today screen; readable as history.
    session: {
      label: "Session",
      icon: "🎹",
      displayField: "label",
      fields: {
        date: { type: "datetime", required: true, default: (ctx) => ctx.today() },
        weekId: { type: "text", hidden: true, help: "The plan week this day belonged to" },
        blocksDone: { type: "tags", label: "Blocks done" },
        rest: { type: "boolean", label: "Rest day", default: false },
        minutes: { type: "number", unit: "min", integer: true, min: 0 },
        note: { type: "text", multiline: true },
      },
      computed: {
        label: (s) => `${s.date instanceof Date ? s.date.toLocaleDateString() : "—"} · ${s.rest ? "rest" : `${Array.isArray(s.blocksDone) ? s.blocksDone.length : 0} blocks`}`,
      },
    },

    // The weekly review, one row per week, newest first on the Log tab.
    weekLog: {
      label: "Week log",
      icon: "📝",
      displayField: "week",
      fields: {
        date: { type: "datetime", required: true, default: (ctx) => ctx.today(), width: "half" },
        week: { type: "text", required: true, placeholder: "Week 3", width: "half" },
        weekId: { type: "text", hidden: true },
        daysPractised: { type: "number", label: "Days practised", integer: true, min: 0, max: 7, required: true, width: "half" },
        tempoBpm: { type: "number", label: "Tempo reached", unit: "bpm", integer: true, min: 0, width: "half" },
        recorded: { type: "text", label: "Piece / exercise recorded" },
        fix: { type: "text", label: "One thing to fix", multiline: true },
        notes: { type: "text", multiline: true },
      },
      groups: [
        { title: "Week", fields: ["date", "week", "daysPractised", "tempoBpm"] },
        { title: "Review", fields: ["recorded", "fix", "notes"] },
      ],
    },
  },

  pages: [
    { id: "today", title: "Today", icon: "☀️", view: { type: "custom", entity: "session", render: (props) => <Today {...props} /> } },
    {
      id: "log",
      title: "Log",
      icon: "📝",
      view: {
        type: "timeline",
        entity: "weekLog",
        date: "date",
        groupBy: "month",
        newest: "first",
        display: {
          primary: (l) => l.week,
          secondary: (l) => [`${l.daysPractised ?? 0} days`, l.tempoBpm ? `${l.tempoBpm} bpm` : null, l.recorded || null, l.fix ? `fix: ${l.fix}` : null].filter(Boolean).join(" · "),
        },
        onOpen: { page: "weeklog", param: { weekLogId: "id" } },
        emptyText: "No weeks logged yet. On your review day, block 5 becomes “Record + log”.",
      },
    },
    { id: "plan", title: "Plan", icon: "🗺", view: { type: "custom", entity: "session", render: (props) => <PlanView {...props} /> } },
    { id: "modules", title: "Modules", icon: "🎷", view: { type: "custom", entity: "session", render: (props) => <ModulesView {...props} /> } },
    { id: "weeklog", title: "Week log", hidden: true, view: { type: "detail", entity: "weekLog", param: "weekLogId" } },
    {
      id: "sessions",
      title: "Sessions",
      icon: "📅",
      view: {
        type: "timeline",
        entity: "session",
        date: "date",
        groupBy: "week",
        display: { primary: (s) => (s.rest ? "Rest day" : `${Array.isArray(s.blocksDone) ? s.blocksDone.length : 0} of 5 blocks`), secondary: (s) => s.note || s.weekId || "" },
        onOpen: { page: "session", param: { sessionId: "id" } },
        emptyText: "Nothing practised yet. Tick a block on Today.",
      },
    },
    { id: "session", title: "Session", hidden: true, view: { type: "detail", entity: "session", param: "sessionId" } },
  ],

  reminders: [],
});
