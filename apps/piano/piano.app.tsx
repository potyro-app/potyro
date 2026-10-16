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
      ctx.t({
        en: "plan.json has not reached this device yet",
        "pt-BR": "O plan.json ainda não chegou a este aparelho",
        de: "plan.json ist noch nicht auf diesem Gerät",
        es: "plan.json aún no ha llegado a este dispositivo",
        pl: "Plik plan.json jeszcze nie dotarł na to urządzenie",
        it: "plan.json non è ancora arrivato su questo dispositivo",
      }),
    );
  }
  const checked = validatePlan(raw);
  if (!checked.ok) {
    const head = ctx.t({
      en: "plan.json is not a valid plan:",
      "pt-BR": "O plan.json não é um plano válido:",
      de: "plan.json ist kein gültiger Plan:",
      es: "plan.json no es un plan válido:",
      pl: "plan.json nie jest poprawnym planem:",
      it: "plan.json non è un piano valido:",
    });
    throw new Error(`${head}\n${checked.errors.join("\n")}`);
  }
  return checked.plan;
}

/** "Loading…", for every screen that waits on the plan. */
const loadingText = (ctx: Ctx): string => ctx.t({ en: "Loading…", "pt-BR": "Carregando…", de: "Wird geladen…", es: "Cargando…", pl: "Wczytywanie…", it: "Caricamento…" });

/** "Done when: …" — a week's goal, as the plan words it. */
const doneWhen = (goal: string, ctx: Ctx): string =>
  ctx.t({ en: "Done when: {goal}", "pt-BR": "Pronto quando: {goal}", de: "Geschafft, wenn: {goal}", es: "Hecho cuando: {goal}", pl: "Zaliczone, gdy: {goal}", it: "Fatto quando: {goal}" }, { goal });

/** "Blues · week 2 of 4". */
const moduleWeek = (module: string, n: number, total: number, ctx: Ctx): string =>
  ctx.t(
    {
      en: "{module} · week {n} of {total}",
      "pt-BR": "{module} · semana {n} de {total}",
      de: "{module} · Woche {n} von {total}",
      es: "{module} · semana {n} de {total}",
      pl: "{module} · tydzień {n} z {total}",
      it: "{module} · settimana {n} di {total}",
    },
    { module, n, total },
  );

/** A weekday's name, 0 = Sunday, in the person's calendar. 4 January 2026 was a Sunday. */
const weekdayName = (i: number, ctx: Ctx): string => ctx.format.date(new Date(2026, 0, 4 + i, 12), { weekday: "long" });

/** Why starting a module now is early, in the person's words (progress.ts decides whether it is). */
const warningWords = (ctx: Ctx) => (v: { module: string; from: string; phase: string; here: string }): string =>
  ctx.t(
    {
      en: "The plan suggests {module} from {from} ({phase}); you are on {here}.",
      "pt-BR": "O plano sugere {module} a partir de {from} ({phase}); você está em {here}.",
      de: "Der Plan sieht {module} ab {from} ({phase}) vor; du bist bei {here}.",
      es: "El plan sugiere {module} a partir de {from} ({phase}); vas por {here}.",
      pl: "Plan proponuje moduł {module} od: {from} ({phase}); teraz jesteś na: {here}.",
      it: "Il piano suggerisce {module} da {from} ({phase}); sei a {here}.",
    },
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
          { en: "{label}: time's up", "pt-BR": "{label}: acabou o tempo", de: "{label}: Zeit ist um", es: "{label}: se acabó el tiempo", pl: "{label}: koniec czasu", it: "{label}: tempo scaduto" },
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
        {ctx.t({
          en: "This plan has no weeks. Load one on the Modules tab.",
          "pt-BR": "Este plano não tem semanas. Carregue um na aba Módulos.",
          de: "Dieser Plan hat keine Wochen. Lade einen im Tab Module.",
          es: "Este plan no tiene semanas. Carga uno en la pestaña Módulos.",
          pl: "Ten plan nie ma tygodni. Wczytaj inny w zakładce Moduły.",
          it: "Questo piano non ha settimane. Caricane uno nella scheda Moduli.",
        })}
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
          {
            en: "{week} · {module} week {n}",
            "pt-BR": "{week} · {module}, semana {n}",
            de: "{week} · {module}, Woche {n}",
            es: "{week} · {module}, semana {n}",
            pl: "{week} · {module}, tydzień {n}",
            it: "{week} · {module}, settimana {n}",
          },
          { week: cur.week.label, module: cur.module.title, n: cur.moduleWeekNumber },
        )
      : cur.week.label;
    // The log's own fields, as the runtime shows them: already in the person's language.
    const f = runtime.definition.entities.weekLog!.fields as Record<string, Field>;
    const values = await ctx.ui.form<{ week: string; daysPractised: number; recorded: string; tempoBpm: number; fix: string; notes: string }>({
      title: ctx.t({ en: "Log this week", "pt-BR": "Registrar esta semana", de: "Diese Woche eintragen", es: "Anotar esta semana", pl: "Zapisz ten tydzień", it: "Segna questa settimana" }),
      submit: ctx.t({ en: "Save log", "pt-BR": "Salvar registro", de: "Eintrag speichern", es: "Guardar registro", pl: "Zapisz wpis", it: "Salva il registro" }),
      fields: { week: f.week!, daysPractised: f.daysPractised!, recorded: f.recorded!, tempoBpm: f.tempoBpm!, fix: f.fix!, notes: f.notes! },
      initial: { week: label, daysPractised: practised },
    });
    if (!values) return;
    await runtime.create("weekLog", { ...values, date: today, weekId: progress.weekId });
    ctx.ui.toast(ctx.t({ en: "Week logged", "pt-BR": "Semana registrada", de: "Woche eingetragen", es: "Semana anotada", pl: "Tydzień zapisany", it: "Settimana segnata" }));
    navigate("log");
  };

  const met = async (): Promise<void> => {
    const last = !cur.module && cur.index === cur.total - 1;
    const question = cur.module
      ? ctx.t(
          {
            en: "Module week {n} of {total} done?",
            "pt-BR": "Semana {n} de {total} do módulo concluída?",
            de: "Modulwoche {n} von {total} geschafft?",
            es: "¿Terminada la semana {n} de {total} del módulo?",
            pl: "Tydzień modułu {n} z {total} zaliczony?",
            it: "Settimana {n} di {total} del modulo fatta?",
          },
          { n: cur.moduleWeekNumber, total: cur.moduleWeeksTotal },
        )
      : ctx.t(
          { en: "{week} done?", "pt-BR": "{week}: concluída?", de: "{week} geschafft?", es: "¿Terminado: {week}?", pl: "{week}: zaliczone?", it: "{week}: fatto?" },
          { week: cur.week.label },
        );
    const ok = await ctx.ui.confirm(question, {
      detail: last
        ? ctx.t({
            en: "This is the last week of the plan.",
            "pt-BR": "Esta é a última semana do plano.",
            de: "Das ist die letzte Woche des Plans.",
            es: "Es la última semana del plan.",
            pl: "To ostatni tydzień planu.",
            it: "È l'ultima settimana del piano.",
          })
        : doneWhen(cur.goal, ctx),
      ok: ctx.t({ en: "Goal met", "pt-BR": "Meta cumprida", de: "Ziel erreicht", es: "Objetivo cumplido", pl: "Cel osiągnięty", it: "Obiettivo raggiunto" }),
    });
    if (!ok) return;
    await update((p) => goalMet(plan, p, ctx.now()));
    void ctx.caps.haptics?.vibrate([0, 80, 60, 80]);
  };
  const again = async (): Promise<void> => {
    const question = cur.module
      ? ctx.t({
          en: "Repeat this module week?",
          "pt-BR": "Repetir esta semana do módulo?",
          de: "Diese Modulwoche wiederholen?",
          es: "¿Repetir esta semana del módulo?",
          pl: "Powtórzyć ten tydzień modułu?",
          it: "Ripetere questa settimana del modulo?",
        })
      : ctx.t({ en: "Repeat {week}?", "pt-BR": "Repetir {week}?", de: "{week} wiederholen?", es: "¿Repetir {week}?", pl: "Powtórzyć: {week}?", it: "Ripetere {week}?" }, { week: cur.week.label });
    const ok = await ctx.ui.confirm(question, {
      detail: ctx.t({
        en: "Repeating a week is normal.",
        "pt-BR": "Repetir uma semana é normal.",
        de: "Eine Woche zu wiederholen ist normal.",
        es: "Repetir una semana es normal.",
        pl: "Powtarzanie tygodnia to nic złego.",
        it: "Ripetere una settimana è normale.",
      }),
      ok: ctx.t({ en: "Repeat", "pt-BR": "Repetir", de: "Wiederholen", es: "Repetir", pl: "Powtórz", it: "Ripeti" }),
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
                {
                  en: " · week {n} of {total}",
                  "pt-BR": " · semana {n} de {total}",
                  de: " · Woche {n} von {total}",
                  es: " · semana {n} de {total}",
                  pl: " · tydzień {n} z {total}",
                  it: " · settimana {n} di {total}",
                },
                { n: cur.weekOfSpan, total: cur.spanWeeks },
              )}
            </span>
          ) : null}
        </h1>
        <p className="pn-meta">
          <span>{longDate(today, ctx)}</span>
          <span className="pn-pill" data-tone={rest ? "rest" : review ? "review" : "day"}>
            {rest
              ? ctx.t({ en: "Day 7 · rest", "pt-BR": "Dia 7 · descanso", de: "Tag 7 · Ruhetag", es: "Día 7 · descanso", pl: "Dzień 7 · odpoczynek", it: "Giorno 7 · riposo" })
              : ctx.t({ en: "Day {day} of 7", "pt-BR": "Dia {day} de 7", de: "Tag {day} von 7", es: "Día {day} de 7", pl: "Dzień {day} z 7", it: "Giorno {day} di 7" }, { day })}
            {review && !rest
              ? ctx.t({ en: " · review day", "pt-BR": " · dia de revisão", de: " · Rückblick", es: " · día de repaso", pl: " · dzień podsumowania", it: " · giorno di ripasso" })
              : ""}
          </span>
          {cur.module ? (
            <span className="pn-pill" data-tone="module">
              {moduleWeek(cur.module.title, cur.moduleWeekNumber, cur.moduleWeeksTotal, ctx)}
            </span>
          ) : null}
          {cur.repeats > 0 ? (
            <span className="pn-pill">
              {ctx.t({ en: "repeat {n}", "pt-BR": "repetição {n}", de: "Wiederholung {n}", es: "repetición {n}", pl: "powtórka {n}", it: "ripetizione {n}" }, { n: cur.repeats })}
            </span>
          ) : null}
        </p>
        {beforeStart ? (
          <p className="pn-note">
            {ctx.t(
              {
                en: "The plan starts on {date}. Change it on the Modules tab.",
                "pt-BR": "O plano começa em {date}. Mude isso na aba Módulos.",
                de: "Der Plan beginnt am {date}. Ändern kannst du das im Tab Module.",
                es: "El plan empieza el {date}. Cámbialo en la pestaña Módulos.",
                pl: "Plan zaczyna się {date}. Zmienisz to w zakładce Moduły.",
                it: "Il piano comincia il {date}. Puoi cambiarlo nella scheda Moduli.",
              },
              { date: shortDate(parseDay(progress.startDate), ctx) },
            )}
          </p>
        ) : null}
        <ol className="pn-dots" aria-label={ctx.t({ en: "This week", "pt-BR": "Esta semana", de: "Diese Woche", es: "Esta semana", pl: "Ten tydzień", it: "Questa settimana" })}>
          {dots.map((d, i) => (
            <li key={d.key} data-on={d.practised} data-rest={d.rest} data-today={d.today} data-future={d.future} title={d.key}>
              {i + 1}
            </li>
          ))}
        </ol>
      </header>

      {rest && !showAnyway ? (
        <section className="pn-rest">
          <h2>{ctx.t({ en: "Rest day", "pt-BR": "Dia de descanso", de: "Ruhetag", es: "Día de descanso", pl: "Dzień odpoczynku", it: "Giorno di riposo" })}</h2>
          <p>{plan.restDay.text}</p>
          <div className="pn-row">
            <button className="pn-btn" data-on={restTaken} onClick={() => void toggleRest()}>
              {restTaken
                ? ctx.t({ en: "✓ Rested", "pt-BR": "✓ Descanso feito", de: "✓ Ausgeruht", es: "✓ Descanso hecho", pl: "✓ Odpoczynek zaliczony", it: "✓ Riposo fatto" })
                : ctx.t({ en: "Mark as rested", "pt-BR": "Marcar descanso", de: "Als Ruhetag abhaken", es: "Marcar descanso", pl: "Odhacz odpoczynek", it: "Segna il riposo" })}
            </button>
            <button className="pn-btn pn-btn-quiet" onClick={() => setShowAnyway(true)}>
              {ctx.t({ en: "Practise anyway", "pt-BR": "Praticar mesmo assim", de: "Trotzdem üben", es: "Practicar igualmente", pl: "Ćwicz mimo to", it: "Esercitati lo stesso" })}
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
                      {b.fromModule ? ` · ${cur.module?.title ?? ctx.t({ en: "module", "pt-BR": "módulo", de: "Modul", es: "módulo", pl: "moduł", it: "modulo" })}` : ""}
                      {b.review ? ` · ${ctx.t({ en: "review", "pt-BR": "revisão", de: "Rückblick", es: "repaso", pl: "podsumowanie", it: "ripasso" })}` : ""}
                    </span>
                  </div>
                  <button
                    className="pn-check"
                    data-on={isDone}
                    onClick={() => void toggle(b)}
                    aria-label={ctx.t({ en: "{label} done", "pt-BR": "{label} feito", de: "{label} erledigt", es: "{label} hecho", pl: "{label} zrobione", it: "{label} fatto" }, { label: b.label })}
                    aria-pressed={isDone}
                  >
                    ✓
                  </button>
                </div>
                <p className="pn-block-text">{b.text}</p>
                <Links plan={plan} links={b.links} />
                {b.review ? (
                  <button className="pn-btn" onClick={() => void logWeek()}>
                    {ctx.t({ en: "Log this week", "pt-BR": "Registrar esta semana", de: "Diese Woche eintragen", es: "Anotar esta semana", pl: "Zapisz ten tydzień", it: "Segna questa settimana" })}
                  </button>
                ) : null}
                <div
                  className="pn-timer"
                  role="timer"
                  aria-label={ctx.t(
                    { en: "{label} timer", "pt-BR": "Cronômetro: {label}", de: "Timer: {label}", es: "Temporizador: {label}", pl: "Minutnik: {label}", it: "Timer: {label}" },
                    { label: b.label },
                  )}
                >
                  <span className="pn-timer-n" data-zero={mine && remaining === 0}>
                    {mmss(remaining)}
                  </span>
                  {running ? (
                    <button className="pn-btn pn-btn-small" onClick={() => pause(b)}>
                      {ctx.t({ en: "Pause", "pt-BR": "Pausar", de: "Pause", es: "Pausa", pl: "Pauza", it: "Pausa" })}
                    </button>
                  ) : (
                    <button className="pn-btn pn-btn-small" onClick={() => start(b)} disabled={mine && remaining === 0}>
                      {mine && remaining > 0 && remaining < b.minutes * 60
                        ? ctx.t({ en: "Resume", "pt-BR": "Retomar", de: "Weiter", es: "Reanudar", pl: "Wznów", it: "Riprendi" })
                        : ctx.t({ en: "Start", "pt-BR": "Começar", de: "Start", es: "Empezar", pl: "Start", it: "Avvia" })}
                    </button>
                  )}
                  {mine ? (
                    <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={reset}>
                      {ctx.t({ en: "Reset", "pt-BR": "Zerar", de: "Zurücksetzen", es: "Reiniciar", pl: "Od nowa", it: "Azzera" })}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <section className="pn-goal">
        <p className="pn-eyebrow">{ctx.t({ en: "Done when", "pt-BR": "Pronto quando", de: "Geschafft, wenn", es: "Hecho cuando", pl: "Zaliczone, gdy", it: "Fatto quando" })}</p>
        <p className="pn-goal-text">{cur.goal}</p>
        {!rest || showAnyway ? (
          <p className="pn-note">
            {ctx.t(
              {
                en: "{done}/{total} blocks today",
                "pt-BR": "{done}/{total} blocos hoje",
                de: "{done}/{total} Blöcke heute",
                es: "{done}/{total} bloques hoy",
                pl: "{done}/{total} bloków dziś",
                it: "{done}/{total} blocchi oggi",
              },
              { done: doneCount, total: blocks.length },
            )}
          </p>
        ) : null}
        {progress.completed && !cur.module ? (
          <p className="pn-note">
            {ctx.t({
              en: "You have met the last goal of this plan. Time to ask for a new one.",
              "pt-BR": "Você cumpriu a última meta deste plano. Hora de pedir um novo.",
              de: "Du hast das letzte Ziel dieses Plans erreicht. Zeit für einen neuen.",
              es: "Has cumplido el último objetivo de este plan. Es hora de pedir uno nuevo.",
              pl: "Ostatni cel tego planu osiągnięty. Czas poprosić o nowy.",
              it: "Hai raggiunto l'ultimo obiettivo di questo piano. È ora di chiederne uno nuovo.",
            })}
          </p>
        ) : (
          <div className="pn-row">
            <button className="pn-btn pn-btn-primary" onClick={() => void met()}>
              {ctx.t({ en: "Goal met → next", "pt-BR": "Meta cumprida → próxima", de: "Ziel erreicht → weiter", es: "Objetivo cumplido → siguiente", pl: "Cel osiągnięty → dalej", it: "Obiettivo raggiunto → avanti" })}
            </button>
            <button className="pn-btn" onClick={() => void again()}>
              {ctx.t({ en: "Repeat this week", "pt-BR": "Repetir esta semana", de: "Diese Woche wiederholen", es: "Repetir esta semana", pl: "Powtórz ten tydzień", it: "Ripeti questa settimana" })}
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
      ctx.t({ en: "Go to {week}?", "pt-BR": "Ir para {week}?", de: "Zu {week} wechseln?", es: "¿Ir a {week}?", pl: "Przejść do: {week}?", it: "Andare a {week}?" }, { week: label }),
      {
        detail: progress.module
          ? ctx.t({
              en: "This also leaves the running module.",
              "pt-BR": "Isso também sai do módulo em andamento.",
              de: "Damit verlässt du auch das laufende Modul.",
              es: "Esto también sale del módulo en curso.",
              pl: "To także kończy trwający moduł.",
              it: "Così esci anche dal modulo in corso.",
            })
          : undefined,
        ok: ctx.t({ en: "Go", "pt-BR": "Ir", de: "Los", es: "Ir", pl: "Przejdź", it: "Vai" }),
      },
    );
    if (!ok) return;
    await update((p) => jumpTo(plan, p, weekId, ctx.now()));
  };

  return (
    <div className="pn">
      <style>{CSS}</style>
      <header className="pn-head">
        <p className="pn-eyebrow">{ctx.t({ en: "Plan · {version}", "pt-BR": "Plano · {version}", de: "Plan · {version}", es: "Plan · {version}", pl: "Plan · {version}", it: "Piano · {version}" }, { version: plan.version })}</p>
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
          <p className="pn-eyebrow">{phase.span ?? ctx.t({ en: "Phase", "pt-BR": "Fase", de: "Phase", es: "Fase", pl: "Etap", it: "Fase" })}</p>
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
                            {
                              en: " · plan week {n}",
                              "pt-BR": " · semana {n} do plano",
                              de: " · Planwoche {n}",
                              es: " · semana {n} del plan",
                              pl: " · tydzień planu {n}",
                              it: " · settimana {n} del piano",
                            },
                            { n: (w.spanWeeks ?? 1) > 1 ? `${n}–${n + (w.spanWeeks ?? 1) - 1}` : String(n) },
                          )}
                        </span>
                      </h3>
                      <p className="pn-week-goal">{doneWhen(w.doneWhen, ctx)}</p>
                    </div>
                    {status === "current" ? (
                      <span className="pn-pill" data-tone="day">
                        {ctx.t({ en: "now", "pt-BR": "agora", de: "jetzt", es: "ahora", pl: "teraz", it: "ora" })}
                        {(progress.repeats[w.id] ?? 0) > 0
                          ? ` · ${ctx.t({ en: "repeat {n}", "pt-BR": "repetição {n}", de: "Wiederholung {n}", es: "repetición {n}", pl: "powtórka {n}", it: "ripetizione {n}" }, { n: progress.repeats[w.id] ?? 0 })}`
                          : ""}
                      </span>
                    ) : (
                      <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={() => void go(w.id, w.label)}>
                        {status === "done"
                          ? ctx.t({ en: "Back here", "pt-BR": "Voltar aqui", de: "Hierher zurück", es: "Volver aquí", pl: "Wróć tutaj", it: "Torna qui" })
                          : ctx.t({ en: "Jump here", "pt-BR": "Ir para cá", de: "Hierher springen", es: "Saltar aquí", pl: "Przejdź tutaj", it: "Vai qui" })}
                      </button>
                    )}
                  </div>
                  <details className="pn-week-blocks">
                    <summary>{ctx.t({ en: "The five blocks", "pt-BR": "Os cinco blocos", de: "Die fünf Blöcke", es: "Los cinco bloques", pl: "Pięć bloków", it: "I cinque blocchi" })}</summary>
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
          {ctx.t({ en: "Core resources", "pt-BR": "Recursos principais", de: "Wichtigste Materialien", es: "Recursos principales", pl: "Podstawowe materiały", it: "Risorse principali" })}
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
  const startWord = ctx.t({ en: "Start", "pt-BR": "Começar", de: "Start", es: "Empezar", pl: "Start", it: "Avvia" });
  const saveWord = ctx.t({ en: "Save", "pt-BR": "Salvar", de: "Speichern", es: "Guardar", pl: "Zapisz", it: "Salva" });
  const changeWord = ctx.t({ en: "Change", "pt-BR": "Mudar", de: "Ändern", es: "Cambiar", pl: "Zmień", it: "Cambia" });
  const useBuiltInWord = ctx.t({ en: "Use built-in", "pt-BR": "Usar o incluído", de: "Eingebauten verwenden", es: "Usar el incluido", pl: "Użyj wbudowanego", it: "Usa quello incluso" });
  const startOver = ctx.t({ en: "Start over", "pt-BR": "Recomeçar", de: "Neu beginnen", es: "Empezar de nuevo", pl: "Zacznij od nowa", it: "Ricomincia" });

  const begin = async (m: PlanModule): Promise<void> => {
    const warn = moduleWarning(plan, progress, m, warning);
    const [min, max] = m.suggestedWeeks ?? [m.weeks.length, m.weeks.length];
    const resume = cur?.week.label;
    const usually = resume
      ? ctx.t(
          {
            en: "Usually {min}–{max} weeks; blocks 2 and 4 follow the module, then the plan resumes at {week}.",
            "pt-BR": "Normalmente {min}–{max} semanas; os blocos 2 e 4 seguem o módulo, depois o plano volta em {week}.",
            de: "Meist {min}–{max} Wochen; die Blöcke 2 und 4 folgen dem Modul, danach geht der Plan bei {week} weiter.",
            es: "Normalmente {min}–{max} semanas; los bloques 2 y 4 siguen el módulo y luego el plan vuelve a {week}.",
            pl: "Zwykle {min}–{max} tyg.; bloki 2 i 4 idą za modułem, potem plan wraca do: {week}.",
            it: "Di solito {min}–{max} settimane; i blocchi 2 e 4 seguono il modulo, poi il piano riprende da {week}.",
          },
          { min, max, week: resume },
        )
      : ctx.t(
          {
            en: "Usually {min}–{max} weeks; blocks 2 and 4 follow the module, then the plan resumes at where you left it.",
            "pt-BR": "Normalmente {min}–{max} semanas; os blocos 2 e 4 seguem o módulo, depois o plano volta de onde você parou.",
            de: "Meist {min}–{max} Wochen; die Blöcke 2 und 4 folgen dem Modul, danach geht der Plan dort weiter, wo du aufgehört hast.",
            es: "Normalmente {min}–{max} semanas; los bloques 2 y 4 siguen el módulo y luego el plan sigue donde lo dejaste.",
            pl: "Zwykle {min}–{max} tyg.; bloki 2 i 4 idą za modułem, potem plan wraca tam, gdzie przerwano.",
            it: "Di solito {min}–{max} settimane; i blocchi 2 e 4 seguono il modulo, poi il piano riprende da dove avevi lasciato.",
          },
          { min, max },
        );
    const values = await ctx.ui.form<{ weeks: number }>({
      title: ctx.t({ en: "Start {module}", "pt-BR": "Começar: {module}", de: "{module} starten", es: "Empezar: {module}", pl: "Zacznij: {module}", it: "Inizia: {module}" }, { module: m.title }),
      submit: startWord,
      fields: {
        weeks: {
          type: "number",
          label: ctx.t({ en: "For how many weeks", "pt-BR": "Por quantas semanas", de: "Wie viele Wochen", es: "Durante cuántas semanas", pl: "Na ile tygodni", it: "Per quante settimane" }),
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
        {
          en: "{module} for {n, plural, one {# week} other {# weeks}}",
          "pt-BR": "{module} por {n, plural, one {# semana} other {# semanas}}",
          de: "{module} für {n, plural, one {# Woche} other {# Wochen}}",
          es: "{module} durante {n, plural, one {# semana} other {# semanas}}",
          pl: "{module} na {n, plural, one {# tydzień} few {# tygodnie} many {# tygodni} other {# tygodnia}}",
          it: "{module} per {n, plural, one {# settimana} other {# settimane}}",
        },
        { module: m.title, n: Number(values.weeks) },
      ),
    );
    props.navigate("today");
  };
  const leave = async (): Promise<void> => {
    const back = cur
      ? ctx.t(
          {
            en: "Back to {week} where you left it.",
            "pt-BR": "De volta a {week}, onde você parou.",
            de: "Zurück zu {week}, wo du aufgehört hast.",
            es: "Vuelta a {week}, donde lo dejaste.",
            pl: "Powrót do: {week} — tam, gdzie przerwano.",
            it: "Torni a {week}, dove avevi lasciato.",
          },
          { week: cur.week.label },
        )
      : ctx.t({
          en: "Back to the plan where you left it.",
          "pt-BR": "De volta ao plano, onde você parou.",
          de: "Zurück zum Plan, wo du aufgehört hast.",
          es: "Vuelta al plan, donde lo dejaste.",
          pl: "Powrót do planu — tam, gdzie przerwano.",
          it: "Torni al piano, dove avevi lasciato.",
        });
    const sure = await ctx.ui.confirm(
      ctx.t({ en: "Leave the module now?", "pt-BR": "Sair do módulo agora?", de: "Das Modul jetzt verlassen?", es: "¿Dejar el módulo ahora?", pl: "Opuścić teraz moduł?", it: "Lasciare il modulo adesso?" }),
      { detail: back, ok: ctx.t({ en: "Leave", "pt-BR": "Sair", de: "Verlassen", es: "Salir", pl: "Opuść", it: "Lascia" }) },
    );
    if (!sure) return;
    await update((p) => leaveModule(plan, p, ctx.now()));
  };

  const pickStartDate = async (): Promise<void> => {
    const v = await ctx.ui.form<{ startDate: Date }>({
      title: ctx.t({ en: "Start date", "pt-BR": "Data de início", de: "Startdatum", es: "Fecha de inicio", pl: "Data rozpoczęcia", it: "Data di inizio" }),
      submit: saveWord,
      fields: {
        startDate: {
          type: "datetime",
          label: ctx.t({ en: "Day 1 of week 1", "pt-BR": "Dia 1 da semana 1", de: "Tag 1 von Woche 1", es: "Día 1 de la semana 1", pl: "Dzień 1 tygodnia 1", it: "Giorno 1 della settimana 1" }),
          required: true,
          help: ctx.t({
            en: "Day 7 of every cycle is the rest day",
            "pt-BR": "O dia 7 de cada ciclo é o dia de descanso",
            de: "Tag 7 jedes Zyklus ist der Ruhetag",
            es: "El día 7 de cada ciclo es el de descanso",
            pl: "Dzień 7 każdego cyklu to dzień odpoczynku",
            it: "Il giorno 7 di ogni ciclo è il giorno di riposo",
          }),
        },
      },
      initial: { startDate: parseDay(progress.startDate) },
    });
    if (!v?.startDate) return;
    const d = v.startDate instanceof Date ? v.startDate : new Date(String(v.startDate));
    await update((p) => setStartDate(p, isoDay(d)));
  };
  const pickReviewDay = async (): Promise<void> => {
    const current = ctx.t({ en: "current", "pt-BR": "atual", de: "aktuell", es: "actual", pl: "obecny", it: "attuale" });
    const choice = await ctx.ui.sheet<number>({
      title: ctx.t({ en: "Review day", "pt-BR": "Dia de revisão", de: "Rückblick-Tag", es: "Día de repaso", pl: "Dzień podsumowania", it: "Giorno di ripasso" }),
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
      ctx.ui.toast(ctx.t({ en: "That file is not JSON", "pt-BR": "Esse arquivo não é JSON", de: "Diese Datei ist kein JSON", es: "Ese archivo no es JSON", pl: "Ten plik to nie JSON", it: "Quel file non è JSON" }));
      return;
    }
    const checked = validatePlan(parsed);
    if (!checked.ok) {
      await ctx.ui.confirm(
        ctx.t({
          en: "The plan file has problems",
          "pt-BR": "O arquivo do plano tem problemas",
          de: "Die Plandatei hat Fehler",
          es: "El archivo del plan tiene problemas",
          pl: "Plik planu ma błędy",
          it: "Il file del piano ha dei problemi",
        }),
        { detail: checked.errors.slice(0, 6).join("\n"), ok: ctx.t({ en: "OK", "pt-BR": "OK", de: "OK", es: "Aceptar", pl: "OK", it: "OK" }) },
      );
      return;
    }
    const name = blob.name;
    const use = await ctx.ui.confirm(
      ctx.t(
        { en: "Use “{title}” ({version})?", "pt-BR": "Usar “{title}” ({version})?", de: "„{title}“ ({version}) verwenden?", es: "¿Usar «{title}» ({version})?", pl: "Użyć „{title}” ({version})?", it: "Usare “{title}” ({version})?" },
        { title: checked.plan.title, version: checked.plan.version },
      ),
      {
        detail: ctx.t({
          en: "Your progress and logs are kept; a week the new plan does not have falls back to its first week.",
          "pt-BR": "Seu progresso e seus registros ficam; uma semana que o novo plano não tem volta para a primeira semana dele.",
          de: "Dein Fortschritt und deine Einträge bleiben; eine Woche, die der neue Plan nicht hat, fällt auf seine erste Woche zurück.",
          es: "Tu progreso y tus registros se conservan; una semana que el plan nuevo no tenga vuelve a su primera semana.",
          pl: "Postępy i wpisy zostają; tydzień, którego nowy plan nie ma, cofa się do jego pierwszego tygodnia.",
          it: "I tuoi progressi e le registrazioni restano; una settimana che il nuovo piano non ha torna alla sua prima settimana.",
        }),
        ok: ctx.t({ en: "Use this plan", "pt-BR": "Usar este plano", de: "Diesen Plan verwenden", es: "Usar este plan", pl: "Użyj tego planu", it: "Usa questo piano" }),
      },
    );
    if (!use) return;
    await ctx.storage.set(PLAN_KEY, checked.plan);
    await ctx.storage.set(PLAN_SOURCE_KEY, name);
    announce();
    await reload();
    ctx.ui.toast(ctx.t({ en: "Plan loaded", "pt-BR": "Plano carregado", de: "Plan geladen", es: "Plan cargado", pl: "Plan wczytany", it: "Piano caricato" }));
  };
  const useBuiltIn = async (): Promise<void> => {
    const builtIn = await builtInPlan(ctx);
    const back = await ctx.ui.confirm(
      ctx.t({
        en: "Go back to the built-in plan?",
        "pt-BR": "Voltar ao plano que vem com o app?",
        de: "Zum eingebauten Plan zurück?",
        es: "¿Volver al plan incluido?",
        pl: "Wrócić do wbudowanego planu?",
        it: "Tornare al piano incluso?",
      }),
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
      ctx.t({ en: "Start the plan over?", "pt-BR": "Recomeçar o plano?", de: "Den Plan von vorn beginnen?", es: "¿Empezar el plan de nuevo?", pl: "Zacząć plan od nowa?", it: "Ricominciare il piano?" }),
      {
        detail: ctx.t({
          en: "Progress goes back to week 1 from today. Sessions and logs are kept.",
          "pt-BR": "O progresso volta para a semana 1 a partir de hoje. Sessões e registros ficam.",
          de: "Der Fortschritt beginnt ab heute wieder bei Woche 1. Einheiten und Einträge bleiben.",
          es: "El progreso vuelve a la semana 1 desde hoy. Las sesiones y los registros se conservan.",
          pl: "Postępy wracają do tygodnia 1 od dziś. Sesje i wpisy zostają.",
          it: "I progressi tornano alla settimana 1 da oggi. Sessioni e registrazioni restano.",
        }),
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
        <p className="pn-eyebrow">{ctx.t({ en: "Modules", "pt-BR": "Módulos", de: "Module", es: "Módulos", pl: "Moduły", it: "Moduli" })}</p>
        <h1 className="pn-title">
          {ctx.t({
            en: "Blues, jazz and the plan itself",
            "pt-BR": "Blues, jazz e o próprio plano",
            de: "Blues, Jazz und der Plan selbst",
            es: "Blues, jazz y el propio plan",
            pl: "Blues, jazz i sam plan",
            it: "Blues, jazz e il piano stesso",
          })}
        </h1>
      </header>

      {progress.module && cur?.module ? (
        <section className="pn-card" data-tone="module">
          <p className="pn-eyebrow">{ctx.t({ en: "Running", "pt-BR": "Em andamento", de: "Läuft", es: "En curso", pl: "W toku", it: "In corso" })}</p>
          <h2>{moduleWeek(cur.module.title, cur.moduleWeekNumber, cur.moduleWeeksTotal, ctx)}</h2>
          <p>{doneWhen(cur.goal, ctx)}</p>
          <p className="pn-note">
            {ctx.t(
              {
                en: "Returns to {week} afterwards.",
                "pt-BR": "Depois volta para {week}.",
                de: "Danach geht es mit {week} weiter.",
                es: "Después vuelve a {week}.",
                pl: "Potem powrót do: {week}.",
                it: "Dopo si torna a {week}.",
              },
              { week: cur.week.label },
            )}
          </p>
          <button className="pn-btn" onClick={() => void leave()}>
            {ctx.t({ en: "Leave module", "pt-BR": "Sair do módulo", de: "Modul verlassen", es: "Dejar el módulo", pl: "Opuść moduł", it: "Lascia il modulo" })}
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
                  {
                    en: "Usually {a}–{b} weeks · {n, plural, one {# week} other {# weeks}} of material",
                    "pt-BR": "Normalmente {a}–{b} semanas · {n, plural, one {# semana} other {# semanas}} de material",
                    de: "Meist {a}–{b} Wochen · Material für {n, plural, one {# Woche} other {# Wochen}}",
                    es: "Normalmente {a}–{b} semanas · {n, plural, one {# semana} other {# semanas}} de material",
                    pl: "Zwykle {a}–{b} tyg. · materiał na {n, plural, one {# tydzień} few {# tygodnie} many {# tygodni} other {# tygodnia}}",
                    it: "Di solito {a}–{b} settimane · materiale per {n, plural, one {# settimana} other {# settimane}}",
                  },
                  { a: m.suggestedWeeks[0], b: m.suggestedWeeks[1], n: m.weeks.length },
                )}
              </p>
            ) : null}
            {warn ? <p className="pn-warn">{warn}</p> : null}
            <details className="pn-week-blocks">
              <summary>{ctx.t({ en: "The weeks", "pt-BR": "As semanas", de: "Die Wochen", es: "Las semanas", pl: "Tygodnie", it: "Le settimane" })}</summary>
              <ol className="pn-module-weeks">
                {m.weeks.map((w, i) => (
                  <li key={w.id}>
                    <strong>{ctx.t({ en: "Week {n}", "pt-BR": "Semana {n}", de: "Woche {n}", es: "Semana {n}", pl: "Tydzień {n}", it: "Settimana {n}" }, { n: i + 1 })}</strong>
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
                ? ctx.t({ en: "Running", "pt-BR": "Em andamento", de: "Läuft", es: "En curso", pl: "W toku", it: "In corso" })
                : ctx.t({ en: "Start {module}", "pt-BR": "Começar: {module}", de: "{module} starten", es: "Empezar: {module}", pl: "Zacznij: {module}", it: "Inizia: {module}" }, { module: m.title.toLowerCase() })}
            </button>
          </section>
        );
      })}

      <section className="pn-card">
        <p className="pn-eyebrow">{ctx.t({ en: "Settings", "pt-BR": "Configurações", de: "Einstellungen", es: "Ajustes", pl: "Ustawienia", it: "Impostazioni" })}</p>
        <dl className="pn-settings">
          <div>
            <dt>{ctx.t({ en: "Start date", "pt-BR": "Data de início", de: "Startdatum", es: "Fecha de inicio", pl: "Data rozpoczęcia", it: "Data di inizio" })}</dt>
            <dd>
              {shortDate(parseDay(progress.startDate), ctx)}{" "}
              <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={() => void pickStartDate()}>
                {changeWord}
              </button>
            </dd>
          </div>
          <div>
            <dt>{ctx.t({ en: "Review day", "pt-BR": "Dia de revisão", de: "Rückblick-Tag", es: "Día de repaso", pl: "Dzień podsumowania", it: "Giorno di ripasso" })}</dt>
            <dd>
              {weekdayName(progress.reviewWeekday, ctx)}{" "}
              <button className="pn-btn pn-btn-small pn-btn-quiet" onClick={() => void pickReviewDay()}>
                {changeWord}
              </button>
            </dd>
          </div>
          <div>
            <dt>{ctx.t({ en: "Plan", "pt-BR": "Plano", de: "Plan", es: "Plan", pl: "Plan", it: "Piano" })}</dt>
            <dd>
              {plan.title} · {plan.version}{" "}
              <span className="pn-note">
                ({planSource === "built-in" ? ctx.t({ en: "built-in", "pt-BR": "incluído", de: "eingebaut", es: "incluido", pl: "wbudowany", it: "incluso" }) : planSource})
              </span>
              <div className="pn-row">
                <button className="pn-btn pn-btn-small" onClick={() => void loadPlan()}>
                  {ctx.t({ en: "Load plan file…", "pt-BR": "Carregar arquivo de plano…", de: "Plandatei laden…", es: "Cargar archivo de plan…", pl: "Wczytaj plik planu…", it: "Carica file del piano…" })}
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
            <dt>{ctx.t({ en: "Progress", "pt-BR": "Progresso", de: "Fortschritt", es: "Progreso", pl: "Postępy", it: "Progressi" })}</dt>
            <dd>
              {ctx.t(
                {
                  en: "{n, plural, one {# move} other {# moves}} since {date}",
                  "pt-BR": "{n, plural, one {# mudança} other {# mudanças}} desde {date}",
                  de: "{n, plural, one {# Schritt} other {# Schritte}} seit {date}",
                  es: "{n, plural, one {# cambio} other {# cambios}} desde el {date}",
                  pl: "{n, plural, one {# zmiana} few {# zmiany} many {# zmian} other {# zmiany}} od {date}",
                  it: "{n, plural, one {# passaggio} other {# passaggi}} dal {date}",
                },
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
  name: { en: "Piano", "pt-BR": "Piano", de: "Klavier", es: "Piano", pl: "Pianino", it: "Pianoforte" },
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
      label: { en: "Log this week", "pt-BR": "Registrar esta semana", de: "Diese Woche eintragen", es: "Anotar esta semana", pl: "Zapisz ten tydzień", it: "Segna questa settimana" },
      icon: "📝",
      entity: "weekLog",
      mode: "form",
    },
  ],

  entities: {
    // One per day: which blocks you ticked. Written by the Today screen; readable as history.
    session: {
      label: { en: "Session", "pt-BR": "Sessão", de: "Einheit", es: "Sesión", pl: "Sesja", it: "Sessione" },
      icon: "🎹",
      displayField: "label",
      fields: {
        date: {
          type: "datetime",
          required: true,
          default: (ctx) => ctx.today(),
          label: { en: "Date", "pt-BR": "Data", de: "Datum", es: "Fecha", pl: "Data", it: "Data" },
        },
        weekId: {
          type: "text",
          hidden: true,
          help: {
            en: "The plan week this day belonged to",
            "pt-BR": "A semana do plano a que este dia pertencia",
            de: "Die Planwoche, zu der dieser Tag gehörte",
            es: "La semana del plan a la que pertenecía este día",
            pl: "Tydzień planu, do którego należał ten dzień",
            it: "La settimana del piano a cui apparteneva questo giorno",
          },
        },
        blocksDone: {
          type: "tags",
          label: { en: "Blocks done", "pt-BR": "Blocos feitos", de: "Erledigte Blöcke", es: "Bloques hechos", pl: "Zrobione bloki", it: "Blocchi fatti" },
        },
        rest: {
          type: "boolean",
          default: false,
          label: { en: "Rest day", "pt-BR": "Dia de descanso", de: "Ruhetag", es: "Día de descanso", pl: "Dzień odpoczynku", it: "Giorno di riposo" },
        },
        minutes: {
          type: "number",
          unit: "min",
          integer: true,
          min: 0,
          label: { en: "Minutes", "pt-BR": "Minutos", de: "Minuten", es: "Minutos", pl: "Minuty", it: "Minuti" },
        },
        note: { type: "text", multiline: true, label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" } },
      },
      computed: {
        label: (s, ctx) => {
          const day = s.date instanceof Date ? ctx.format.date(s.date, { day: "numeric", month: "numeric", year: "numeric" }) : "—";
          const what = s.rest
            ? ctx.t({ en: "rest", "pt-BR": "descanso", de: "Ruhetag", es: "descanso", pl: "odpoczynek", it: "riposo" })
            : ctx.t(
                {
                  en: "{n, plural, one {# block} other {# blocks}}",
                  "pt-BR": "{n, plural, one {# bloco} other {# blocos}}",
                  de: "{n, plural, one {# Block} other {# Blöcke}}",
                  es: "{n, plural, one {# bloque} other {# bloques}}",
                  pl: "{n, plural, one {# blok} few {# bloki} many {# bloków} other {# bloku}}",
                  it: "{n, plural, one {# blocco} other {# blocchi}}",
                },
                { n: Array.isArray(s.blocksDone) ? s.blocksDone.length : 0 },
              );
          return `${day} · ${what}`;
        },
      },
    },

    // The weekly review, one row per week, newest first on the Log tab.
    weekLog: {
      label: { en: "Week log", "pt-BR": "Registro semanal", de: "Wochenbericht", es: "Registro semanal", pl: "Podsumowanie tygodnia", it: "Diario della settimana" },
      icon: "📝",
      displayField: "week",
      fields: {
        date: {
          type: "datetime",
          required: true,
          default: (ctx) => ctx.today(),
          width: "half",
          label: { en: "Date", "pt-BR": "Data", de: "Datum", es: "Fecha", pl: "Data", it: "Data" },
        },
        week: {
          type: "text",
          required: true,
          width: "half",
          label: { en: "Week", "pt-BR": "Semana", de: "Woche", es: "Semana", pl: "Tydzień", it: "Settimana" },
          placeholder: { en: "Week 3", "pt-BR": "Semana 3", de: "Woche 3", es: "Semana 3", pl: "Tydzień 3", it: "Settimana 3" },
        },
        weekId: { type: "text", hidden: true },
        daysPractised: {
          type: "number",
          integer: true,
          min: 0,
          max: 7,
          required: true,
          width: "half",
          label: { en: "Days practised", "pt-BR": "Dias de prática", de: "Geübte Tage", es: "Días de práctica", pl: "Dni ćwiczeń", it: "Giorni di pratica" },
        },
        tempoBpm: {
          type: "number",
          unit: "bpm",
          integer: true,
          min: 0,
          width: "half",
          label: { en: "Tempo reached", "pt-BR": "Andamento alcançado", de: "Erreichtes Tempo", es: "Tempo alcanzado", pl: "Osiągnięte tempo", it: "Tempo raggiunto" },
        },
        recorded: {
          type: "text",
          label: {
            en: "Piece / exercise recorded",
            "pt-BR": "Peça / exercício gravado",
            de: "Aufgenommenes Stück / Übung",
            es: "Pieza / ejercicio grabado",
            pl: "Nagrany utwór / ćwiczenie",
            it: "Brano / esercizio registrato",
          },
        },
        fix: {
          type: "text",
          multiline: true,
          label: { en: "One thing to fix", "pt-BR": "Uma coisa para corrigir", de: "Eine Sache zum Verbessern", es: "Una cosa que corregir", pl: "Jedna rzecz do poprawy", it: "Una cosa da correggere" },
        },
        notes: { type: "text", multiline: true, label: { en: "Notes", "pt-BR": "Anotações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" } },
      },
      groups: [
        { title: { en: "Week", "pt-BR": "Semana", de: "Woche", es: "Semana", pl: "Tydzień", it: "Settimana" }, fields: ["date", "week", "daysPractised", "tempoBpm"] },
        { title: { en: "Review", "pt-BR": "Revisão", de: "Rückblick", es: "Repaso", pl: "Podsumowanie", it: "Ripasso" }, fields: ["recorded", "fix", "notes"] },
      ],
    },
  },

  pages: [
    {
      id: "today",
      title: { en: "Today", "pt-BR": "Hoje", de: "Heute", es: "Hoy", pl: "Dziś", it: "Oggi" },
      icon: "☀️",
      view: { type: "custom", entity: "session", render: (props) => <Today {...props} /> },
    },
    {
      id: "log",
      title: { en: "Log", "pt-BR": "Registro", de: "Protokoll", es: "Registro", pl: "Dziennik", it: "Diario" },
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
                {
                  en: "{n, plural, one {# day} other {# days}}",
                  "pt-BR": "{n, plural, one {# dia} other {# dias}}",
                  de: "{n, plural, one {# Tag} other {# Tage}}",
                  es: "{n, plural, one {# día} other {# días}}",
                  pl: "{n, plural, one {# dzień} few {# dni} many {# dni} other {# dnia}}",
                  it: "{n, plural, one {# giorno} other {# giorni}}",
                },
                { n: Number(l.daysPractised ?? 0) },
              ),
              l.tempoBpm ? `${l.tempoBpm} bpm` : null,
              l.recorded || null,
              l.fix
                ? ctx.t(
                    { en: "fix: {fix}", "pt-BR": "corrigir: {fix}", de: "verbessern: {fix}", es: "corregir: {fix}", pl: "do poprawy: {fix}", it: "da correggere: {fix}" },
                    { fix: String(l.fix) },
                  )
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
        },
        onOpen: { page: "weeklog", param: { weekLogId: "id" } },
        emptyText: {
          en: "No weeks logged yet. On your review day, block 5 becomes “Record + log”.",
          "pt-BR": "Nenhuma semana registrada ainda. No seu dia de revisão, o bloco 5 passa a ser gravar e registrar.",
          de: "Noch keine Woche eingetragen. An deinem Rückblick-Tag wird Block 5 zum Aufnehmen und Eintragen.",
          es: "Aún no has anotado ninguna semana. En tu día de repaso, el bloque 5 pasa a ser grabar y anotar.",
          pl: "Brak zapisanych tygodni. W dniu podsumowania blok 5 zamienia się w nagranie i wpis.",
          it: "Ancora nessuna settimana segnata. Nel tuo giorno di ripasso, il blocco 5 diventa registrare e segnare.",
        },
      },
    },
    {
      id: "plan",
      title: { en: "Plan", "pt-BR": "Plano", de: "Plan", es: "Plan", pl: "Plan", it: "Piano" },
      icon: "🗺",
      view: { type: "custom", entity: "session", render: (props) => <PlanView {...props} /> },
    },
    {
      id: "modules",
      title: { en: "Modules", "pt-BR": "Módulos", de: "Module", es: "Módulos", pl: "Moduły", it: "Moduli" },
      icon: "🎷",
      view: { type: "custom", entity: "session", render: (props) => <ModulesView {...props} /> },
    },
    {
      id: "weeklog",
      title: { en: "Week log", "pt-BR": "Registro semanal", de: "Wochenbericht", es: "Registro semanal", pl: "Podsumowanie tygodnia", it: "Diario della settimana" },
      hidden: true,
      view: { type: "detail", entity: "weekLog", param: "weekLogId" },
    },
    {
      id: "sessions",
      title: { en: "Sessions", "pt-BR": "Sessões", de: "Einheiten", es: "Sesiones", pl: "Sesje", it: "Sessioni" },
      icon: "📅",
      view: {
        type: "timeline",
        entity: "session",
        date: "date",
        groupBy: "week",
        display: {
          primary: (s, ctx) =>
            s.rest
              ? ctx.t({ en: "Rest day", "pt-BR": "Dia de descanso", de: "Ruhetag", es: "Día de descanso", pl: "Dzień odpoczynku", it: "Giorno di riposo" })
              : ctx.t(
                  { en: "{n} of 5 blocks", "pt-BR": "{n} de 5 blocos", de: "{n} von 5 Blöcken", es: "{n} de 5 bloques", pl: "{n} z 5 bloków", it: "{n} di 5 blocchi" },
                  { n: Array.isArray(s.blocksDone) ? s.blocksDone.length : 0 },
                ),
          secondary: (s) => s.note || s.weekId || "",
        },
        onOpen: { page: "session", param: { sessionId: "id" } },
        emptyText: {
          en: "Nothing practised yet. Tick a block on Today.",
          "pt-BR": "Nada praticado ainda. Marque um bloco em Hoje.",
          de: "Noch nichts geübt. Hak einen Block unter Heute ab.",
          es: "Aún no has practicado nada. Marca un bloque en Hoy.",
          pl: "Jeszcze nic nie przećwiczono. Zaznacz blok w zakładce Dziś.",
          it: "Ancora nessun esercizio. Spunta un blocco in Oggi.",
        },
      },
    },
    {
      id: "session",
      title: { en: "Session", "pt-BR": "Sessão", de: "Einheit", es: "Sesión", pl: "Sesja", it: "Sessione" },
      hidden: true,
      view: { type: "detail", entity: "session", param: "sessionId" },
    },
  ],

  reminders: [],
});
