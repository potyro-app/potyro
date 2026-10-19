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
//
// In six languages (#303); every language but English is a model's draft (#297). The screens say
// their words through `ctx.t`, and dates through `ctx.format`. plan.json is not translated: it is
// the plan itself — a document of lessons, written in English around English books, videos and
// sites — and the app shows it as written, the way it shows a record. A plan in another language
// is a plan file of its own (Modules → Load plan file…). What validatePlan says about a broken file
// stays in English too: it points at paths in the file, for whoever edits it.
import { defineApp } from "potyro";
import type { Ctx, Field, Resolved, ViewProps } from "potyro";
import { useCallback, useEffect, useRef, useState } from "react";
import { blocksForWeek, mainWeeks, resolveLink, startingWeekNumber, validatePlan } from "./plan.js";
import type { Plan, PlanLink, PlanModule } from "./plan.js";
import {
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
  if (raw == null) {
    throw new Error(
      ctx.t("plan.json has not reached this device yet"),
    );
  }
  const checked = validatePlan(raw);
  if (!checked.ok) {
    const head = ctx.t("plan.json is not a valid plan:");
    throw new Error(`${head}\n${checked.errors.join("\n")}`);
  }
  return checked.plan;
}

/** "Loading…", for every screen that waits on the plan. */
const loadingText = (ctx: Ctx): string => ctx.t("Loading…");

/** "Done when: …" — a week's goal, as the plan words it. */
const doneWhen = (goal: string, ctx: Ctx): string =>
  ctx.t("Done when: {goal}", { goal });

/** "Blues · week 2 of 4". */
const moduleWeek = (module: string, n: number, total: number, ctx: Ctx): string =>
  ctx.t(
    "{module} · week {n} of {total}",
    { module, n, total },
  );

/** A weekday's name, 0 = Sunday, in the person's calendar. 4 January 2026 was a Sunday. */
const weekdayName = (i: number, ctx: Ctx): string => ctx.format.date(new Date(2026, 0, 4 + i, 12), { weekday: "long" });

/** Why starting a module now is early, in the person's words (progress.ts decides whether it is). */
const warningWords = (ctx: Ctx) => (v: { module: string; from: string; phase: string; here: string }): string =>
  ctx.t(
    "The plan suggests {module} from {from} ({phase}); you are on {here}.",
    v,
  );

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
const longDate = (d: Date, ctx: Ctx): string => ctx.format.date(d, { weekday: "long", day: "numeric", month: "long" });
/** A day on its own: "10/13/2026", "13.10.2026". */
const shortDate = (d: Date, ctx: Ctx): string => ctx.format.date(d, { day: "numeric", month: "numeric", year: "numeric" });

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
      const c = ctxRef.current;
      c.ui.toast(
        c.t(
          "{label}: time's up",
          { label: t.label },
        ),
      );
      setTimer({ ...t, endsAt: null, remaining: 0 });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [timer?.endsAt]);

  if (!state) return <div className="pn-load">{error ?? loadingText(ctx)}</div>;
  const { plan, progress } = state;
  const cur = currentWeek(plan, progress, today);
  if (!cur) {
    return (
      <div className="pn-load">
        {ctx.t("This plan has no weeks. Load one on the Modules tab.")}
      </div>
    );
  }

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
    // The week's name goes into the log, a record, in the language it was logged in.
    const label = cur.module
      ? ctx.t(
          "{week} · {module} week {n}",
          { week: cur.week.label, module: cur.module.title, n: cur.moduleWeekNumber },
        )
      : cur.week.label;
    // The log's own fields, as the runtime shows them: already in the person's language.
    const f = runtime.definition.entities.weekLog!.fields as Record<string, Field>;
    const values = await ctx.ui.form<{ week: string; daysPractised: number; recorded: string; tempoBpm: number; fix: string; notes: string }>({
      title: ctx.t("Log this week"),
      submit: ctx.t("Save log"),
      fields: { week: f.week!, daysPractised: f.daysPractised!, recorded: f.recorded!, tempoBpm: f.tempoBpm!, fix: f.fix!, notes: f.notes! },
      initial: { week: label, daysPractised: practised },
    });
    if (!values) return;
    await runtime.create("weekLog", { ...values, date: today, weekId: progress.weekId });
    ctx.ui.toast(ctx.t("Week logged"));
    navigate("log");
  };

  const met = async (): Promise<void> => {
    const last = !cur.module && cur.index === cur.total - 1;
    const question = cur.module
      ? ctx.t(
          "Module week {n} of {total} done?",
          { n: cur.moduleWeekNumber, total: cur.moduleWeeksTotal },
        )
      : ctx.t(
          "{week} done?",
          { week: cur.week.label },
        );
    const ok = await ctx.ui.confirm(question, {
      detail: last
        ? ctx.t("This is the last week of the plan.")
        : doneWhen(cur.goal, ctx),
      ok: ctx.t("Goal met"),
    });
    if (!ok) return;
    await update((p) => goalMet(plan, p, ctx.now()));
    void ctx.caps.haptics?.vibrate([0, 80, 60, 80]);
  };
  const again = async (): Promise<void> => {
    const question = cur.module
      ? ctx.t("Repeat this module week?")
      : ctx.t("Repeat {week}?", { week: cur.week.label });
    const ok = await ctx.ui.confirm(question, {
      detail: ctx.t("Repeating a week is normal."),
      ok: ctx.t("Repeat"),
    });
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
          {cur.spanWeeks > 1 ? (
            <span className="pn-title-sub">
              {ctx.t(
                " · week {n} of {total}",
                { n: cur.weekOfSpan, total: cur.spanWeeks },
              )}
            </span>
          ) : null}
        </h1>
        <p className="pn-meta">
          <span>{longDate(today, ctx)}</span>
          <span className="pn-pill" data-tone={rest ? "rest" : review ? "review" : "day"}>
            {rest
              ? ctx.t("Day 7 · rest")
              : ctx.t("Day {day} of 7", { day })}
            {review && !rest
              ? ctx.t(" · review day")
              : ""}
          </span>
          {cur.module ? (
            <span className="pn-pill" data-tone="module">
              {moduleWeek(cur.module.title, cur.moduleWeekNumber, cur.moduleWeeksTotal, ctx)}
            </span>
          ) : null}
          {cur.repeats > 0 ? (
            <span className="pn-pill">
              {ctx.t("repeat {n}", { n: cur.repeats })}
            </span>
          ) : null}
        </p>
        {beforeStart ? (
          <p className="pn-note">
            {ctx.t(
              "The plan starts on {date}. Change it on the Modules tab.",
              { date: shortDate(parseDay(progress.startDate), ctx) },
            )}
          </p>
        ) : null}
        <ol className="pn-dots" aria-label={ctx.t("This week")}>
          {dots.map((d, i) => (
            <li key={d.key} data-on={d.practised} data-rest={d.rest} data-today={d.today} data-future={d.future} title={d.key}>
              {i + 1}
            </li>
          ))}
        </ol>
      </header>

      {rest && !showAnyway ? (
        <section className="pn-rest">
          <h2>{ctx.t("Rest day")}</h2>
          <p>{plan.restDay.text}</p>
          <div className="pn-row">
            <button className="pn-btn" data-on={restTaken} onClick={() => void toggleRest()}>
              {restTaken
                ? ctx.t("✓ Rested")
                : ctx.t("Mark as rested")}
            </button>
            <button className="pn-btn pn-btn-quiet" onClick={() => setShowAnyway(true)}>
              {ctx.t("Practise anyway")}
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
                      {ctx.format.number(b.minutes, { style: "unit", unit: "minute" })}
                      {b.fromModule ? ` · ${cur.module?.title ?? ctx.t("module")}` : ""}
                      {b.review ? ` · ${ctx.t("review")}` : ""}
                    </span>
                  </div>
                  <button
                    className="pn-check"
                    data-on={isDone}
                    onClick={() => void toggle(b)}
                    aria-label={ctx.t("{label} done", { label: b.label })}
                    aria-pressed={isDone}
                  >
                    ✓
                  </button>
                </div>
                <p className="pn-block-text">{b.text}</p>
                <Links plan={plan} links={b.links} />
                {b.review ? (
                  <button className="pn-btn" onClick={() => void logWeek()}>
                    {ctx.t("Log this week")}
                  </button>
                ) : null}
                <div
                  className="pn-timer"
                  role="timer"
                  aria-label={ctx.t(
                    "{label} timer",
                    { label: b.label },
                  )}
                >
                  <span className="pn-timer-n" data-zero={mine && remaining === 0}>
                    {mmss(remaining)}
                  </span>
                  {running ? (
                    <button className="pn-btn pn-btn-small" onClick={() => pause(b)}>
                      {ctx.t("Pause")}
                    </button>
                  ) : (
                    <button className="pn-btn pn-btn-small" onClick={() => start(b)} disabled={mine && remaining === 0}>
                      {mine && remaining > 0 && remaining < b.minutes * 60
                        ? ctx.t("Resume")
                        : ctx.t("Start")}
                    </button>
                  )}
                  {mine ? (
                    <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={reset}>
                      {ctx.t("Reset")}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <section className="pn-goal">
        <p className="pn-eyebrow">{ctx.t("Done when")}</p>
        <p className="pn-goal-text">{cur.goal}</p>
        {!rest || showAnyway ? (
          <p className="pn-note">
            {ctx.t(
              "{done}/{total} blocks today",
              { done: doneCount, total: blocks.length },
            )}
          </p>
        ) : null}
        {progress.completed && !cur.module ? (
          <p className="pn-note">
            {ctx.t("You have met the last goal of this plan. Time to ask for a new one.")}
          </p>
        ) : (
          <div className="pn-row">
            <button className="pn-btn pn-btn-primary" onClick={() => void met()}>
              {ctx.t("Goal met → next")}
            </button>
            <button className="pn-btn" onClick={() => void again()}>
              {ctx.t("Repeat this week")}
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
  if (!state) return <div className="pn-load">{error ?? loadingText(ctx)}</div>;
  const { plan, progress } = state;
  const today = ctx.today();
  const cur = currentWeek(plan, progress, today);
  const weeks = mainWeeks(plan);

  const go = async (weekId: string, label: string): Promise<void> => {
    const ok = await ctx.ui.confirm(
      ctx.t("Go to {week}?", { week: label }),
      {
        detail: progress.module
          ? ctx.t("This also leaves the running module.")
          : undefined,
        ok: ctx.t("Go"),
      },
    );
    if (!ok) return;
    await update((p) => jumpTo(plan, p, weekId, ctx.now()));
  };

  return (
    <div className="pn">
      <style>{CSS}</style>
      <header className="pn-head">
        <p className="pn-eyebrow">{ctx.t("Plan · {version}", { version: plan.version })}</p>
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
          <p className="pn-eyebrow">{phase.span ?? ctx.t("Phase")}</p>
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
                        <span className="pn-week-n">
                          {ctx.t(
                            " · plan week {n}",
                            { n: (w.spanWeeks ?? 1) > 1 ? `${n}–${n + (w.spanWeeks ?? 1) - 1}` : String(n) },
                          )}
                        </span>
                      </h3>
                      <p className="pn-week-goal">{doneWhen(w.doneWhen, ctx)}</p>
                    </div>
                    {status === "current" ? (
                      <span className="pn-pill" data-tone="day">
                        {ctx.t("now")}
                        {(progress.repeats[w.id] ?? 0) > 0
                          ? ` · ${ctx.t("repeat {n}", { n: progress.repeats[w.id] ?? 0 })}`
                          : ""}
                      </span>
                    ) : (
                      <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={() => void go(w.id, w.label)}>
                        {status === "done"
                          ? ctx.t("Back here")
                          : ctx.t("Jump here")}
                      </button>
                    )}
                  </div>
                  <details className="pn-week-blocks">
                    <summary>{ctx.t("The five blocks")}</summary>
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
        <p className="pn-eyebrow">
          {ctx.t("Core resources")}
        </p>
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
  if (!state) return <div className="pn-load">{error ?? loadingText(ctx)}</div>;
  const { plan, progress, planSource } = state;
  const today = ctx.today();
  const cur = currentWeek(plan, progress, today);
  const warning = warningWords(ctx);
  const startWord = ctx.t("Start");
  const saveWord = ctx.t("Save");
  const changeWord = ctx.t("Change");
  const useBuiltInWord = ctx.t("Use built-in");
  const startOver = ctx.t("Start over");

  const begin = async (m: PlanModule): Promise<void> => {
    const warn = moduleWarning(plan, progress, m, warning);
    const [min, max] = m.suggestedWeeks ?? [m.weeks.length, m.weeks.length];
    const resume = cur?.week.label;
    const usually = resume
      ? ctx.t(
          "Usually {min}–{max} weeks; blocks 2 and 4 follow the module, then the plan resumes at {week}.",
          { min, max, week: resume },
        )
      : ctx.t(
          "Usually {min}–{max} weeks; blocks 2 and 4 follow the module, then the plan resumes at where you left it.",
          { min, max },
        );
    const values = await ctx.ui.form<{ weeks: number }>({
      title: ctx.t("Start {module}", { module: m.title }),
      submit: startWord,
      fields: {
        weeks: {
          type: "number",
          label: ctx.t("For how many weeks"),
          integer: true,
          min: 1,
          max: 52,
          default: min,
          help: warn ? `${warn} ${usually}` : usually,
        },
      },
      initial: { weeks: min },
    });
    if (!values) return;
    await update((p) => startModule(plan, p, m.id, Number(values.weeks), ctx.now()));
    ctx.ui.toast(
      ctx.t(
        "{module} for {n, plural, one {# week} other {# weeks}}",
        { module: m.title, n: Number(values.weeks) },
      ),
    );
    props.navigate("today");
  };
  const leave = async (): Promise<void> => {
    const back = cur
      ? ctx.t(
          "Back to {week} where you left it.",
          { week: cur.week.label },
        )
      : ctx.t("Back to the plan where you left it.");
    const sure = await ctx.ui.confirm(
      ctx.t("Leave the module now?"),
      { detail: back, ok: ctx.t("Leave") },
    );
    if (!sure) return;
    await update((p) => leaveModule(plan, p, ctx.now()));
  };

  const pickStartDate = async (): Promise<void> => {
    const v = await ctx.ui.form<{ startDate: Date }>({
      title: ctx.t("Start date"),
      submit: saveWord,
      fields: {
        startDate: {
          type: "datetime",
          label: ctx.t("Day 1 of week 1"),
          required: true,
          help: ctx.t("Day 7 of every cycle is the rest day"),
        },
      },
      initial: { startDate: parseDay(progress.startDate) },
    });
    if (!v?.startDate) return;
    const d = v.startDate instanceof Date ? v.startDate : new Date(String(v.startDate));
    await update((p) => setStartDate(p, isoDay(d)));
  };
  const pickReviewDay = async (): Promise<void> => {
    const current = ctx.t("current");
    const choice = await ctx.ui.sheet<number>({
      title: ctx.t("Review day"),
      items: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ id: i, label: weekdayName(i, ctx), detail: i === progress.reviewWeekday ? current : undefined })),
    });
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
      ctx.ui.toast(ctx.t("That file is not JSON"));
      return;
    }
    const checked = validatePlan(parsed);
    if (!checked.ok) {
      await ctx.ui.confirm(
        ctx.t("The plan file has problems"),
        { detail: checked.errors.slice(0, 6).join("\n"), ok: ctx.t("OK") },
      );
      return;
    }
    const name = blob.name;
    const use = await ctx.ui.confirm(
      ctx.t(
        "Use “{title}” ({version})?",
        { title: checked.plan.title, version: checked.plan.version },
      ),
      {
        detail: ctx.t("Your progress and logs are kept; a week the new plan does not have falls back to its first week."),
        ok: ctx.t("Use this plan"),
      },
    );
    if (!use) return;
    await ctx.storage.set(PLAN_KEY, checked.plan);
    await ctx.storage.set(PLAN_SOURCE_KEY, name);
    announce();
    await reload();
    ctx.ui.toast(ctx.t("Plan loaded"));
  };
  const useBuiltIn = async (): Promise<void> => {
    const builtIn = await builtInPlan(ctx);
    const back = await ctx.ui.confirm(
      ctx.t("Go back to the built-in plan?"),
      { detail: `${builtIn.title} (${builtIn.version})`, ok: useBuiltInWord },
    );
    if (!back) return;
    await ctx.storage.delete(PLAN_KEY);
    await ctx.storage.delete(PLAN_SOURCE_KEY);
    announce();
    await reload();
  };
  const resetProgress = async (): Promise<void> => {
    const sure = await ctx.ui.confirm(
      ctx.t("Start the plan over?"),
      {
        detail: ctx.t("Progress goes back to week 1 from today. Sessions and logs are kept."),
        ok: startOver,
        destructive: true,
      },
    );
    if (!sure) return;
    await update(() => defaultProgress(plan, today));
  };

  return (
    <div className="pn">
      <style>{CSS}</style>
      <header className="pn-head">
        <p className="pn-eyebrow">{ctx.t("Modules")}</p>
        <h1 className="pn-title">
          {ctx.t("Blues, jazz and the plan itself")}
        </h1>
      </header>

      {progress.module && cur?.module ? (
        <section className="pn-card" data-tone="module">
          <p className="pn-eyebrow">{ctx.t("Running")}</p>
          <h2>{moduleWeek(cur.module.title, cur.moduleWeekNumber, cur.moduleWeeksTotal, ctx)}</h2>
          <p>{doneWhen(cur.goal, ctx)}</p>
          <p className="pn-note">
            {ctx.t(
              "Returns to {week} afterwards.",
              { week: cur.week.label },
            )}
          </p>
          <button className="pn-btn" onClick={() => void leave()}>
            {ctx.t("Leave module")}
          </button>
        </section>
      ) : null}

      {plan.modules.map((m) => {
        const warn = moduleWarning(plan, progress, m, warning);
        const active = progress.module?.id === m.id;
        return (
          <section key={m.id} className="pn-card">
            <h2>{m.title}</h2>
            {m.intro ? <p>{m.intro}</p> : null}
            {m.suggestedWeeks ? (
              <p className="pn-note">
                {ctx.t(
                  "Usually {a}–{b} weeks · {n, plural, one {# week} other {# weeks}} of material",
                  { a: m.suggestedWeeks[0], b: m.suggestedWeeks[1], n: m.weeks.length },
                )}
              </p>
            ) : null}
            {warn ? <p className="pn-warn">{warn}</p> : null}
            <details className="pn-week-blocks">
              <summary>{ctx.t("The weeks")}</summary>
              <ol className="pn-module-weeks">
                {m.weeks.map((w, i) => (
                  <li key={w.id}>
                    <strong>{ctx.t("Week {n}", { n: i + 1 })}</strong>
                    <ul>
                      {Object.entries(w.blocks).map(([id, c]) => (
                        <li key={id}>
                          <em>{plan.blocks.find((b) => b.id === id)?.label ?? id}:</em> {c.text}
                          <Links plan={plan} links={c.links ?? []} />
                        </li>
                      ))}
                    </ul>
                    <p className="pn-week-goal">{doneWhen(w.doneWhen, ctx)}</p>
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
              {active
                ? ctx.t("Running")
                : ctx.t("Start {module}", { module: m.title.toLowerCase() })}
            </button>
          </section>
        );
      })}

      <section className="pn-card">
        <p className="pn-eyebrow">{ctx.t("Settings")}</p>
        <dl className="pn-settings">
          <div>
            <dt>{ctx.t("Start date")}</dt>
            <dd>
              {shortDate(parseDay(progress.startDate), ctx)}{" "}
              <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={() => void pickStartDate()}>
                {changeWord}
              </button>
            </dd>
          </div>
          <div>
            <dt>{ctx.t("Review day")}</dt>
            <dd>
              {weekdayName(progress.reviewWeekday, ctx)}{" "}
              <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={() => void pickReviewDay()}>
                {changeWord}
              </button>
            </dd>
          </div>
          <div>
            <dt>{ctx.t("Plan")}</dt>
            <dd>
              {plan.title} · {plan.version}{" "}
              <span className="pn-note">
                ({planSource === "built-in" ? ctx.t("built-in") : planSource})
              </span>
              <div className="pn-row">
                <button className="pn-btn pn-btn-small" onClick={() => void loadPlan()}>
                  {ctx.t("Load plan file…")}
                </button>
                {planSource !== "built-in" ? (
                  <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={() => void useBuiltIn()}>
                    {useBuiltInWord}
                  </button>
                ) : null}
              </div>
            </dd>
          </div>
          <div>
            <dt>{ctx.t("Progress")}</dt>
            <dd>
              {ctx.t(
                "{n, plural, one {# move} other {# moves}} since {date}",
                { n: progress.history.length, date: shortDate(new Date(progress.history[0]?.at ?? progress.weekStartedAt), ctx) },
              )}{" "}
              <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={() => void resetProgress()}>
                {startOver}
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
  version: "1.1.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#C9772B" },
  category: "music",
  permissions: { haptics: true }, // a buzz when a timer ends (a plan file comes in through ctx.files, which needs none)
  nav: "tabs",

  quickActions: [
    {
      id: "log-week",
      label: "Log this week",
      icon: "📝",
      entity: "weekLog",
      mode: "form",
    },
  ],

  entities: {
    // One per day: which blocks you ticked. Written by the Today screen; readable as history.
    session: {
      label: "Session",
      icon: "🎹",
      displayField: "label",
      fields: {
        date: {
          type: "datetime",
          required: true,
          default: (ctx) => ctx.today(),
          label: "Date",
        },
        weekId: {
          type: "text",
          hidden: true,
          help: "The plan week this day belonged to",
        },
        blocksDone: {
          type: "tags",
          label: "Blocks done",
        },
        rest: {
          type: "boolean",
          default: false,
          label: "Rest day",
        },
        minutes: {
          type: "number",
          unit: "min",
          integer: true,
          min: 0,
          label: "Minutes",
        },
        note: { type: "text", multiline: true, label: "Note" },
      },
      computed: {
        label: (s, ctx) => {
          const day = s.date instanceof Date ? ctx.format.date(s.date, { day: "numeric", month: "numeric", year: "numeric" }) : "—";
          const what = s.rest
            ? ctx.t("rest")
            : ctx.t(
                "{n, plural, one {# block} other {# blocks}}",
                { n: Array.isArray(s.blocksDone) ? s.blocksDone.length : 0 },
              );
          return `${day} · ${what}`;
        },
      },
    },

    // The weekly review, one row per week, newest first on the Log tab.
    weekLog: {
      label: "Week log",
      icon: "📝",
      displayField: "week",
      fields: {
        date: {
          type: "datetime",
          required: true,
          default: (ctx) => ctx.today(),
          width: "half",
          label: "Date",
        },
        week: {
          type: "text",
          required: true,
          width: "half",
          label: "Week",
          placeholder: "Week 3",
        },
        weekId: { type: "text", hidden: true },
        daysPractised: {
          type: "number",
          integer: true,
          min: 0,
          max: 7,
          required: true,
          width: "half",
          label: "Days practised",
        },
        tempoBpm: {
          type: "number",
          unit: "bpm",
          integer: true,
          min: 0,
          width: "half",
          label: "Tempo reached",
        },
        recorded: {
          type: "text",
          label: "Piece / exercise recorded",
        },
        fix: {
          type: "text",
          multiline: true,
          label: "One thing to fix",
        },
        notes: { type: "text", multiline: true, label: "Notes" },
      },
      groups: [
        { title: "Week", fields: ["date", "week", "daysPractised", "tempoBpm"] },
        { title: "Review", fields: ["recorded", "fix", "notes"] },
      ],
    },
  },

  pages: [
    {
      id: "today",
      title: "Today",
      icon: "☀️",
      view: { type: "custom", entity: "session", render: (props) => <Today {...props} /> },
    },
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
          secondary: (l, ctx) =>
            [
              ctx.t(
                "{n, plural, one {# day} other {# days}}",
                { n: Number(l.daysPractised ?? 0) },
              ),
              l.tempoBpm ? `${l.tempoBpm} bpm` : null,
              l.recorded || null,
              l.fix
                ? ctx.t(
                    "fix: {fix}",
                    { fix: String(l.fix) },
                  )
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
        },
        onOpen: { page: "weeklog", param: { weekLogId: "id" } },
        emptyText: "No weeks logged yet. On your review day, block 5 becomes “Record + log”.",
      },
    },
    {
      id: "plan",
      title: "Plan",
      icon: "🗺",
      view: { type: "custom", entity: "session", render: (props) => <PlanView {...props} /> },
    },
    {
      id: "modules",
      title: "Modules",
      icon: "🎷",
      view: { type: "custom", entity: "session", render: (props) => <ModulesView {...props} /> },
    },
    {
      id: "weeklog",
      title: "Week log",
      hidden: true,
      view: { type: "detail", entity: "weekLog", param: "weekLogId" },
    },
    {
      id: "sessions",
      title: "Sessions",
      icon: "📅",
      view: {
        type: "timeline",
        entity: "session",
        date: "date",
        groupBy: "week",
        display: {
          primary: (s, ctx) =>
            s.rest
              ? ctx.t("Rest day")
              : ctx.t(
                  "{n} of 5 blocks",
                  { n: Array.isArray(s.blocksDone) ? s.blocksDone.length : 0 },
                ),
          secondary: (s) => s.note || s.weekId || "",
        },
        onOpen: { page: "session", param: { sessionId: "id" } },
        emptyText: "Nothing practised yet. Tick a block on Today.",
      },
    },
    {
      id: "session",
      title: "Session",
      hidden: true,
      view: { type: "detail", entity: "session", param: "sessionId" },
    },
  ],

  reminders: [],
});
