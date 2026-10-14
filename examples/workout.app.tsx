// workout.app.ts
// The fourth fixture. Stresses two capabilities the other examples don't:
//  (a) NESTED list fields — session.entries is a list whose rows contain another list (`sets`):
//      session → entries → sets. Supported one level deep in schema validation, storage, the
//      generated form, and the detail view.
//  (b) ASYNC computed that call ctx.query — exercise.lastBest scans recent sessions (history)
//      to produce a rolling personal best. The computed runner awaits it, memoizes per pass
//      (many exercises query the same sessions → each session resolved once), and guards
//      against self-referential recursion.
//
// Note: creating a session (with its nested entries → sets) uses the *generic* record form —
// no custom "log" screen is required for the data-entry path.
//
// In six languages (#303); every language but English is a model's draft (#297). The live screen is
// a custom view and says its words through `runtime.ctx.t`, like any function. Exercises and what
// you lifted are records. A training day is an option ("push"), so the screens that name one say it
// through `dayName`, with the same words as the field's labels.
import { defineApp } from "potyro";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Ctx, ViewProps } from "potyro";

// ---- Your own code, in the same file. An app is one file: the Studio edits it, a share link carries
// it, and it runs anywhere the shell does. ----

// The live workout tracker — a custom view (full React, runs trusted). Mobile-first: you
// explicitly START a workout (which timestamps it and starts a clock), work through each
// exercise tapping ✓ to complete a set, a rest timer counts down, finishing an exercise's sets
// auto-advances, and FINISH writes a session (nested entries → sets) with its duration. The
// in-progress workout is saved to ctx.storage so leaving/returning the tab doesn't lose it.

const DAYS = ["push", "pull", "legs"] as const;

/** A training day in words: the same as `day`'s labels below. Records keep "push". */
const dayName = (d: unknown, ctx: Ctx): string => {
  if (d === "push") return ctx.t({ en: "push", "pt-BR": "empurrar", de: "Drücken", es: "empuje", pl: "pchanie", it: "spinta" });
  if (d === "pull") return ctx.t({ en: "pull", "pt-BR": "puxar", de: "Ziehen", es: "tracción", pl: "ciągnięcie", it: "trazione" });
  if (d === "legs") return ctx.t({ en: "legs", "pt-BR": "pernas", de: "Beine", es: "pierna", pl: "nogi", it: "gambe" });
  return String(d ?? "");
};
const capital = (s: string): string => (s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s);
/** When an exercise does not say (an older record, or a hand-written one). */
const REST_SECONDS = 90;

type SetRow = { kg: string; reps: string; done: boolean };
type Plan = Record<string, SetRow[]>; // exerciseId -> set rows

interface Active {
  day: string;
  startedAt: string; // ISO
  plan: Plan;
}

const mmss = (total: number): string => `${Math.floor(total / 60)}:${String(Math.max(0, total % 60)).padStart(2, "0")}`;

function LogSession(props: ViewProps) {
  const { runtime, navigate } = props;
  const ctx = runtime.ctx;
  const { rows: all, loading } = runtime.useQuery("exercise");

  const [day, setDay] = useState<string>(DAYS[0]);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [plan, setPlan] = useState<Plan>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [rest, setRest] = useState<number | null>(null);
  const hydrated = useRef(false);

  const exercises = useMemo(
    () => all.filter((e: any) => e.day === day).sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)),
    [all, day],
  );

  // Rehydrate an in-progress workout (survives tab switches).
  useEffect(() => {
    void runtime.ctx.storage.get<Active>("active").then((saved) => {
      if (saved?.startedAt) {
        setDay(saved.day);
        setStartedAt(new Date(saved.startedAt));
        setPlan(saved.plan ?? {});
      }
      hydrated.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist / clear the in-progress workout.
  useEffect(() => {
    if (!hydrated.current) return;
    if (startedAt) void runtime.ctx.storage.set("active", { day, startedAt: startedAt.toISOString(), plan });
    else void runtime.ctx.storage.delete("active");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, startedAt, plan]);

  // Clocks.
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  useEffect(() => {
    if (rest == null) return;
    if (rest <= 0) {
      runtime.ctx.caps.haptics?.vibrate([0, 250, 120, 250]); // rest over — get ready
      setRest(null);
      return;
    }
    const t = setTimeout(() => setRest((s) => (s == null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rest]);

  if (loading) return <div className="wk-load">{ctx.t({ en: "Loading…", "pt-BR": "Carregando…", de: "Wird geladen…", es: "Cargando…", pl: "Wczytywanie…", it: "Caricamento…" })}</div>;

  const start = (): void => {
    const p: Plan = {};
    for (const e of exercises) {
      const best = e.lastBest as { kg?: number; reps?: number } | null;
      const n = e.targetSets ?? 3;
      p[e.id] = Array.from({ length: n }, () => ({
        kg: best?.kg != null ? String(best.kg) : "",
        reps: best?.reps != null ? String(best.reps) : "",
        done: false,
      }));
    }
    setPlan(p);
    setOpenId(exercises[0]?.id ?? null);
    setStartedAt(new Date());
    setNow(Date.now());
  };

  // ---------- START SCREEN ----------
  if (!startedAt) {
    return (
      <div className="wk">
        <style>{CSS}</style>
        <div className="wk-start">
          <h1 className="wk-start-title">
            {ctx.t({ en: "Ready to train?", "pt-BR": "Bora treinar?", de: "Bereit fürs Training?", es: "¿A entrenar?", pl: "Czas na trening?", it: "Si comincia?" })}
          </h1>
          <div className="wk-seg">
            {DAYS.map((d) => (
              <button key={d} className="wk-seg-btn" data-on={d === day} onClick={() => setDay(d)}>
                {dayName(d, ctx)}
              </button>
            ))}
          </div>
          <ul className="wk-preview">
            {exercises.map((e: any) => (
              <li key={e.id}>
                <span>{e.name}</span>
                <span className="wk-muted">
                  {e.targetSets ?? 3} × {e.repRange ?? "—"}
                </span>
              </li>
            ))}
            {exercises.length === 0 ? (
              <li className="wk-muted">
                {ctx.t(
                  {
                    en: "No {day} exercises — add some on the Program tab.",
                    "pt-BR": "Nenhum exercício de {day} — adicione alguns na aba Programa.",
                    de: "Keine Übungen für {day} — füge im Tab Programm welche hinzu.",
                    es: "No hay ejercicios de {day} — añade alguno en la pestaña Programa.",
                    pl: "Brak ćwiczeń ({day}) — dodaj je w zakładce Program.",
                    it: "Nessun esercizio di {day} — aggiungine nella scheda Programma.",
                  },
                  { day: dayName(day, ctx) },
                )}
              </li>
            ) : null}
          </ul>
          <button className="wk-start-btn" disabled={!exercises.length} onClick={start}>
            {ctx.t(
              {
                en: "Start {day} workout",
                "pt-BR": "Começar treino de {day}",
                de: "Training starten: {day}",
                es: "Empezar entreno de {day}",
                pl: "Zacznij trening: {day}",
                it: "Inizia l'allenamento di {day}",
              },
              { day: dayName(day, ctx) },
            )}
          </button>
        </div>
      </div>
    );
  }

  // ---------- ACTIVE WORKOUT ----------
  const elapsed = Math.floor((now - startedAt.getTime()) / 1000);
  const allRows = Object.values(plan).flat();
  const setsDone = allRows.filter((r) => r.done).length;
  const setsTotal = allRows.length;

  const update = (exId: string, i: number, patch: Partial<SetRow>): void =>
    setPlan((p) => ({ ...p, [exId]: (p[exId] ?? []).map((r, ri) => (ri === i ? { ...r, ...patch } : r)) }));

  const toggleDone = (exId: string, i: number): void => {
    const rows = (plan[exId] ?? []).map((r, ri) => (ri === i ? { ...r, done: !r.done } : r));
    setPlan((p) => ({ ...p, [exId]: rows }));
    if (rows[i]!.done) {
      runtime.ctx.caps.haptics?.vibrate(35); // set logged — quick tick
      // The rest this exercise asks for: a heavy squat and a cable fly do not want the same wait.
      const ex = exercises.find((e: any) => e.id === exId) as { restSec?: number } | undefined;
      const wait = typeof ex?.restSec === "number" && ex.restSec > 0 ? Math.round(ex.restSec) : REST_SECONDS;
      setRest(wait);
      if (rows.every((r) => r.done)) {
        const next = exercises.find((e: any) => e.id !== exId && !(plan[e.id] ?? []).every((r) => r.done));
        if (next) setOpenId(next.id);
      }
    }
  };

  const addSet = (exId: string): void =>
    setPlan((p) => ({ ...p, [exId]: [...(p[exId] ?? []), { kg: "", reps: "", done: false }] }));

  const cancel = async (): Promise<void> => {
    const sure = await runtime.ctx.ui.confirm(
      ctx.t({ en: "Discard this workout?", "pt-BR": "Descartar este treino?", de: "Dieses Training verwerfen?", es: "¿Descartar este entreno?", pl: "Odrzucić ten trening?", it: "Scartare questo allenamento?" }),
      {
        detail: ctx.t({ en: "Nothing from it is saved.", "pt-BR": "Nada dele será salvo.", de: "Nichts davon wird gespeichert.", es: "No se guardará nada.", pl: "Nic z niego nie zostanie zapisane.", it: "Non verrà salvato niente." }),
        ok: ctx.t({ en: "Discard", "pt-BR": "Descartar", de: "Verwerfen", es: "Descartar", pl: "Odrzuć", it: "Scarta" }),
        destructive: true,
      },
    );
    if (!sure) return;
    setStartedAt(null);
    setPlan({});
    setRest(null);
  };

  const finish = async (): Promise<void> => {
    // Finishing is a choice, not a reflex (#112): save it, keep going, or throw it away — the last
    // one set apart and in red by the sheet itself.
    const choice = await runtime.ctx.ui.sheet({
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
    if (choice === "discard") {
      setStartedAt(null);
      setPlan({});
      setRest(null);
      return;
    }
    if (choice !== "save") return;
    const entries = exercises
      .map((e: any) => ({
        exercise: e.id,
        sets: (plan[e.id] ?? []).filter((r) => r.done && r.reps).map((r) => ({ kg: Number(r.kg) || 0, reps: Number(r.reps) || 0 })),
      }))
      .filter((en: any) => en.sets.length > 0);
    if (entries.length === 0) {
      runtime.ctx.ui.toast(
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
    await runtime.create("session", { day, date: startedAt, durationSec: elapsed, entries });
    setStartedAt(null);
    setPlan({});
    setRest(null);
    navigate("history");
  };

  return (
    <div className="wk wk-active">
      <style>{CSS}</style>

      <header className="wk-top">
        <div className="wk-top-l">
          <span className="wk-top-day">{dayName(day, ctx)}</span>
          <span className="wk-clock">{mmss(elapsed)}</span>
        </div>
        <div className="wk-top-r">
          <span className="wk-top-prog">
            {setsDone}/{setsTotal}
          </span>
          <button
            className="wk-cancel"
            onClick={() => void cancel()}
            aria-label={ctx.t({ en: "Discard workout", "pt-BR": "Descartar treino", de: "Training verwerfen", es: "Descartar entreno", pl: "Odrzuć trening", it: "Scarta l'allenamento" })}
          >
            ✕
          </button>
        </div>
      </header>

      <div className="wk-scroll">
        {exercises.map((e: any) => {
          const rows = plan[e.id] ?? [];
          const done = rows.length > 0 && rows.every((r) => r.done);
          const open = openId === e.id;
          const best = e.lastBest as { kg?: number; reps?: number } | null;
          return (
            <section key={e.id} className="wk-ex" data-done={done} data-open={open}>
              <button className="wk-ex-head" onClick={() => setOpenId(open ? null : e.id)}>
                <span className="wk-ex-name">
                  {done ? "✓ " : ""}
                  {e.name}
                </span>
                <span className="wk-ex-meta">
                  {rows.filter((r) => r.done).length}/{rows.length}
                  {best
                    ? ctx.t(
                        { en: " · best {best}", "pt-BR": " · recorde {best}", de: " · Bestwert {best}", es: " · mejor {best}", pl: " · rekord {best}", it: " · record {best}" },
                        { best: e.bodyweight ? String(best.reps) : `${best.kg}kg×${best.reps}` },
                      )
                    : ""}
                </span>
              </button>
              {open ? (
                <div className="wk-sets">
                  {rows.map((r, i) => (
                    <div key={i} className="wk-set" data-done={r.done}>
                      <span className="wk-set-n">{i + 1}</span>
                      {!e.bodyweight ? (
                        <label className="wk-field">
                          <input type="number" inputMode="decimal" value={r.kg} onChange={(ev) => update(e.id, i, { kg: ev.target.value })} />
                          <em>kg</em>
                        </label>
                      ) : null}
                      <label className="wk-field">
                        <input type="number" inputMode="numeric" value={r.reps} onChange={(ev) => update(e.id, i, { reps: ev.target.value })} />
                        <em>{ctx.t({ en: "reps", "pt-BR": "reps", de: "Wdh.", es: "reps", pl: "powt.", it: "rip." })}</em>
                      </label>
                      <button
                        className="wk-check"
                        data-on={r.done}
                        onClick={() => toggleDone(e.id, i)}
                        aria-label={ctx.t({ en: "Complete set", "pt-BR": "Concluir série", de: "Satz abschließen", es: "Completar serie", pl: "Zalicz serię", it: "Completa la serie" })}
                      >
                        ✓
                      </button>
                    </div>
                  ))}
                  <button className="wk-addset" onClick={() => addSet(e.id)}>
                    {ctx.t({ en: "+ Add set", "pt-BR": "+ Adicionar série", de: "+ Satz hinzufügen", es: "+ Añadir serie", pl: "+ Dodaj serię", it: "+ Aggiungi serie" })}
                  </button>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="wk-bar">
        {rest != null ? (
          <div className="wk-rest" role="timer" aria-label={ctx.t({ en: "Rest", "pt-BR": "Descanso", de: "Pause", es: "Descanso", pl: "Przerwa", it: "Recupero" })}>
            <span className="wk-rest-n">{mmss(rest)}</span>
            <button onClick={() => setRest((r) => (r ?? 0) + 30)}>+30s</button>
            <button onClick={() => setRest(null)}>{ctx.t({ en: "skip", "pt-BR": "pular", de: "überspringen", es: "saltar", pl: "pomiń", it: "salta" })}</button>
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
        <button className="wk-finish" onClick={() => void finish()}>
          {ctx.t({ en: "Finish", "pt-BR": "Terminar", de: "Beenden", es: "Terminar", pl: "Zakończ", it: "Fine" })}
        </button>
      </div>
    </div>
  );
}

const CSS = `
.wk { --wk-accent: var(--accent, #5B8DEF); }
.wk-load { padding: 2rem; color: var(--ink-soft,#888); }
.wk, .wk * { box-sizing: border-box; }
.wk input, .wk button { font-size: 16px; } /* 16px prevents iOS zoom */

/* ---- start screen ---- */
.wk-start { display:flex; flex-direction:column; gap:16px; max-width:520px; margin:0 auto; padding-top:8px; }
.wk-start-title { font-family: var(--font-display, serif); font-size: 1.8rem; margin:0; }
.wk-seg { display:grid; grid-template-columns: repeat(3,1fr); gap:6px; background:var(--paper,#eee); padding:5px; border-radius:14px; }
.wk-seg-btn { text-transform:capitalize; padding:.7rem 0; border:0; border-radius:10px; background:transparent; color:var(--ink-soft,#666); font-weight:600; }
.wk-seg-btn[data-on="true"] { background:var(--surface,#fff); color:var(--ink,#222); box-shadow:0 1px 3px rgba(0,0,0,.12); }
.wk-preview { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; }
.wk-preview li { display:flex; justify-content:space-between; padding:.7rem .2rem; border-bottom:1px solid var(--line,#eee); }
.wk-start-btn { margin-top:8px; padding:1.1rem; border:0; border-radius:14px; background:var(--wk-accent); color:#08203f; font-size:1.1rem; font-weight:800; }
.wk-start-btn:disabled { opacity:.4; }

/* ---- active workout ---- */
.wk-active { padding-bottom: 92px; }
.wk-top { position:sticky; top:0; z-index:5; display:flex; align-items:center; justify-content:space-between; padding:.7rem .2rem; background:linear-gradient(var(--surface,#fff), color-mix(in oklch, var(--surface,#fff) 85%, transparent)); backdrop-filter: blur(6px); border-bottom:1px solid var(--line,#eee); }
.wk-top-l { display:flex; align-items:baseline; gap:10px; }
.wk-top-day { text-transform:capitalize; font-weight:700; font-size:1.1rem; }
.wk-clock { font-variant-numeric: tabular-nums; color:var(--wk-accent); font-weight:700; font-size:1.2rem; }
.wk-top-r { display:flex; align-items:center; gap:10px; }
.wk-top-prog { color:var(--ink-soft,#666); font-variant-numeric: tabular-nums; }
.wk-cancel { width:34px; height:34px; border-radius:999px; border:1px solid var(--line,#ddd); background:var(--surface,#fff); color:var(--ink-soft,#888); }

.wk-scroll { display:flex; flex-direction:column; gap:10px; padding-top:12px; }
.wk-ex { border:1px solid var(--line,#e6e2d8); border-radius:14px; overflow:hidden; background:var(--surface,#fff); }
.wk-ex[data-done="true"] .wk-ex-name { color:#2c7a4b; }
.wk-ex-head { width:100%; display:flex; justify-content:space-between; align-items:center; gap:8px; padding:1rem; border:0; background:transparent; text-align:left; color:inherit; }
.wk-ex-name { font-weight:700; font-size:1.05rem; }
.wk-ex-meta { color:var(--ink-soft,#777); font-size:.85rem; white-space:nowrap; }
.wk-sets { display:flex; flex-direction:column; gap:8px; padding:0 1rem 1rem; }
.wk-set { display:flex; align-items:center; gap:10px; padding:.5rem; border-radius:10px; background:var(--paper,#f5f1e8); }
.wk-set[data-done="true"] { background: color-mix(in oklch, #2c7a4b 14%, var(--surface,#fff)); }
.wk-set-n { width:1.6rem; text-align:center; color:var(--ink-soft,#888); font-weight:700; }
.wk-field { display:flex; align-items:center; gap:4px; flex:1; }
.wk-field input { width:100%; min-width:0; min-height:46px; text-align:center; padding:.4rem; border:1px solid var(--line,#ddd); border-radius:10px; background:var(--surface,#fff); font-variant-numeric: tabular-nums; }
.wk-field em { font-style:normal; font-size:.7rem; color:var(--ink-soft,#999); }
.wk-check { flex:0 0 auto; width:48px; height:48px; border-radius:12px; border:2px solid var(--line,#ccc); background:var(--surface,#fff); color:transparent; font-size:1.4rem; font-weight:900; }
.wk-check[data-on="true"] { background:#2c7a4b; border-color:#2c7a4b; color:#fff; }
.wk-addset { align-self:flex-start; border:1px dashed var(--line,#ccc); background:transparent; color:var(--ink-soft,#777); border-radius:10px; padding:.5rem .8rem; }

/* ---- fixed bottom bar ---- */
.wk-bar { position:fixed; left:50%; transform:translateX(-50%); bottom:var(--k-chrome-bottom, 0px); width:min(860px, 100%); display:flex; align-items:center; gap:10px; padding:12px 16px calc(12px + var(--k-safe-bottom, env(safe-area-inset-bottom))); background:var(--surface,#fff); border-top:1px solid var(--line,#eee); z-index:20; }
.wk-bar-hint { color:var(--ink-soft,#999); font-size:.9rem; }
.wk-rest { display:flex; align-items:center; gap:8px; }
.wk-rest-n { font-size:1.4rem; font-weight:800; font-variant-numeric: tabular-nums; color:var(--wk-accent); }
.wk-rest button { border:1px solid var(--line,#ddd); background:var(--paper,#f3efe6); border-radius:8px; padding:.35rem .6rem; }
.wk-finish { margin-left:auto; padding:.9rem 1.6rem; border:0; border-radius:12px; background:var(--wk-accent); color:#08203f; font-weight:800; font-size:1.05rem; }
.wk-muted { color:var(--ink-soft,#999); }
`;

const LOOKBACK = 5; // "best of the last N sessions"

// relations inside list rows may be a raw id ref or a resolved object — handle both. A link to an
// exercise that was deleted resolves to null: that entry has no exercise any more, and says so.
const refId = (x: unknown): string | undefined => (typeof x === "string" ? x : (x as { id?: string } | null)?.id);
// scoring: bodyweight lifts progress on reps; loaded lifts on volume (kg × reps)
const setScore = (bw: boolean, s: { kg?: number; reps?: number }) => (bw ? (s.reps ?? 0) : (s.kg ?? 0) * (s.reps ?? 0));

// ---- Progress (#109): weeks start on Monday; a session belongs to the week its date falls in. ----
const WEEK = 7 * 24 * 3600 * 1000;
const weekStart = (d: Date): number => {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return day.getTime() - ((day.getDay() + 6) % 7) * 24 * 3600 * 1000;
};
/** The sessions of the week `back` weeks before this one. */
const inWeek = (rows: any[], now: Date, back: number): any[] => {
  const from = weekStart(now) - back * WEEK;
  return rows.filter((s) => s.date.getTime() >= from && s.date.getTime() < from + WEEK);
};
const volume = (rows: any[]): number => rows.reduce((v, s) => v + s.totalVolume, 0);
const avgMinutes = (rows: any[]): number | null => {
  const timed = rows.filter((s) => s.durationSec);
  return timed.length ? Math.round(timed.reduce((n, s) => n + s.durationSec, 0) / timed.length / 60) : null;
};

export default defineApp({
  id: "workout",
  name: { en: "PPL Log", "pt-BR": "Diário PPL", de: "PPL-Tagebuch", es: "Registro PPL", pl: "Dziennik PPL", it: "Diario PPL" },
  icon: "🏋",
  version: "1.2.0",
  schemaVersion: 1,
  language: "en",
  languages: ["en", "pt-BR", "de", "es", "pl", "it"],
  theme: { accent: "#5B8DEF" },
  permissions: { haptics: true }, // buzz on set-complete + rest-end
  nav: "grid", // land on an object grid (Exercises / Sessions) with the quick actions on top

  // Give the object tiles a glyph on the grid home.
  // (icons live on the entities below)

  // Quick actions: "Start session" picks the day inline (instant menu → creates + opens the session);
  // "New exercise" opens the form (the exercise has other required fields). Demonstrates KA-04 ④.
  // No "Start session": a session is written when a workout is FINISHED, so a button that created
  // an empty one and dropped you on its record page was a second, worse way into the Train tab —
  // which is the screen that actually starts a workout.
  quickActions: [
    {
      id: "new-exercise",
      label: { en: "New exercise", "pt-BR": "Novo exercício", de: "Neue Übung", es: "Nuevo ejercicio", pl: "Nowe ćwiczenie", it: "Nuovo esercizio" },
      icon: "＋",
      entity: "exercise",
    },
  ],

  entities: {
    // ---- the PROGRAM: editable exercise records ----
    exercise: {
      label: { en: "Exercise", "pt-BR": "Exercício", de: "Übung", es: "Ejercicio", pl: "Ćwiczenie", it: "Esercizio" },
      icon: "💪",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, label: { en: "Name", "pt-BR": "Nome", de: "Name", es: "Nombre", pl: "Nazwa", it: "Nome" } },
        day: {
          type: "enum",
          options: ["push", "pull", "legs"],
          required: true,
          label: { en: "Day", "pt-BR": "Dia", de: "Tag", es: "Día", pl: "Dzień", it: "Giorno" },
          labels: {
            push: { en: "push", "pt-BR": "empurrar", de: "Drücken", es: "empuje", pl: "pchanie", it: "spinta" },
            pull: { en: "pull", "pt-BR": "puxar", de: "Ziehen", es: "tracción", pl: "ciągnięcie", it: "trazione" },
            legs: { en: "legs", "pt-BR": "pernas", de: "Beine", es: "pierna", pl: "nogi", it: "gambe" },
          },
        },
        order: { type: "number", integer: true, default: 0, label: { en: "Order", "pt-BR": "Ordem", de: "Reihenfolge", es: "Orden", pl: "Kolejność", it: "Ordine" } },
        targetSets: {
          type: "number",
          unit: { en: "sets", "pt-BR": "séries", de: "Sätze", es: "series", pl: "serie", it: "serie" },
          integer: true,
          min: 1,
          default: 3,
          label: { en: "Target Sets", "pt-BR": "Séries previstas", de: "Sätze (Ziel)", es: "Series objetivo", pl: "Docelowe serie", it: "Serie previste" },
        },
        repRange: {
          type: "text",
          default: "8–12",
          label: {
            en: "Rep Range",
            "pt-BR": "Faixa de repetições",
            de: "Wiederholungen",
            es: "Rango de repeticiones",
            pl: "Zakres powtórzeń",
            it: "Intervallo di ripetizioni",
          },
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
        cue: {
          type: "text",
          multiline: true,
          label: { en: "Cue", "pt-BR": "Dica", de: "Hinweis", es: "Consejo", pl: "Wskazówka", it: "Suggerimento" },
        },
        bodyweight: {
          type: "boolean",
          default: false,
          label: { en: "Bodyweight", "pt-BR": "Peso corporal", de: "Eigengewicht", es: "Peso corporal", pl: "Masa ciała", it: "Corpo libero" },
        },
      },
      computed: {
        // ASYNC computed that reads history: the rolling personal best for this exercise across
        // the last N sessions of its day. Queries a *different* entity (session), reading the
        // nested entries → sets of each. Returns the best set, or null.
        lastBest: async (e, ctx) => {
          const sessions = await ctx.query("session", {
            filter: (s: any) => s.day === e.day,
            sort: (a: any, b: any) => b.date.getTime() - a.date.getTime(),
            limit: LOOKBACK,
          });
          let best: { kg?: number; reps?: number; score: number } | null = null;
          for (const s of sessions) {
            for (const entry of (s.entries as any[]) ?? []) {
              if (refId(entry.exercise) !== e.id) continue;
              for (const set of (entry.sets as any[]) ?? []) {
                const score = setScore(Boolean(e.bodyweight), set);
                if (score > 0 && (!best || score > best.score)) best = { ...set, score };
              }
            }
          }
          return best;
        },
      },
    },

    // ---- HISTORY: each finished workout is one record, with nested lists inside ----
    session: {
      label: { en: "Session", "pt-BR": "Treino", de: "Training", es: "Sesión", pl: "Trening", it: "Sessione" },
      icon: "🏋",
      displayField: "label",
      fields: {
        day: {
          type: "enum",
          options: ["push", "pull", "legs"],
          colors: { push: "red", pull: "blue", legs: "green" },
          required: true,
          label: { en: "Day", "pt-BR": "Dia", de: "Tag", es: "Día", pl: "Dzień", it: "Giorno" },
          labels: {
            push: { en: "push", "pt-BR": "empurrar", de: "Drücken", es: "empuje", pl: "pchanie", it: "spinta" },
            pull: { en: "pull", "pt-BR": "puxar", de: "Ziehen", es: "tracción", pl: "ciągnięcie", it: "trazione" },
            legs: { en: "legs", "pt-BR": "pernas", de: "Beine", es: "pierna", pl: "nogi", it: "gambe" },
          },
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
              },
            },
          },
        },
      },
      computed: {
        // The day is an option ("push"), shown in the person's words; the date as their calendar writes it.
        label: (s, ctx) => `${capital(dayName(s.day, ctx))} — ${ctx.format.date(s.date, { day: "numeric", month: "numeric", year: "numeric" })}`,
        duration: (s, ctx) => (s.durationSec ? ctx.format.number(Math.round(s.durationSec / 60), { style: "unit", unit: "minute" }) : "—"),
        totalSets: (s) => ((s.entries as any[]) ?? []).reduce((n: number, e: any) => n + (e.sets?.length ?? 0), 0),
        totalVolume: (s) =>
          ((s.entries as any[]) ?? []).reduce(
            (v: number, e: any) => v + ((e.sets as any[]) ?? []).reduce((a: number, x: any) => a + (x.kg ?? 0) * (x.reps ?? 0), 0),
            0,
          ),
      },
      actions: {
        // One set, asked for in one form (#112): which exercise, how heavy, how many. It starts from
        // this session's last set, so the common case — the same again — is one tap.
        logSet: {
          label: { en: "Log Set", "pt-BR": "Registrar série", de: "Satz eintragen", es: "Anotar serie", pl: "Zapisz serię", it: "Segna serie" },
          run: async (s, ctx) => {
            // An entry whose exercise was deleted cannot be written back (its exercise is required);
            // the session keeps the rest.
            const entries = ((s.entries as any[]) ?? [])
              .map((e: any) => ({ exercise: refId(e.exercise), sets: [...((e.sets as any[]) ?? [])] }))
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
      title: { en: "Train", "pt-BR": "Treinar", de: "Training", es: "Entrenar", pl: "Trening", it: "Allenamento" },
      view: {
        type: "custom",
        entity: "session",
        render: (props) => LogSession(props),
      },
    },
    {
      id: "history",
      title: { en: "History", "pt-BR": "Histórico", de: "Verlauf", es: "Historial", pl: "Historia", it: "Cronologia" },
      view: {
        type: "timeline",
        entity: "session",
        date: "date",
        groupBy: "week",
        color: "day",
        display: {
          primary: (s, ctx) => capital(dayName(s.day, ctx)),
          secondary: (s, ctx) =>
            ctx.t(
              {
                en: "{sets, plural, one {# set} other {# sets}} · {volume} kg · {duration}",
                "pt-BR": "{sets, plural, one {# série} other {# séries}} · {volume} kg · {duration}",
                de: "{sets, plural, one {# Satz} other {# Sätze}} · {volume} kg · {duration}",
                es: "{sets, plural, one {# serie} other {# series}} · {volume} kg · {duration}",
                pl: "{sets, plural, one {# seria} few {# serie} many {# serii} other {# serii}} · {volume} kg · {duration}",
                it: "{sets, plural, one {# serie} other {# serie}} · {volume} kg · {duration}",
              },
              // "1,410" in English, "1410" in Polish: the person's own way of writing a number.
              { sets: s.totalSets, volume: ctx.format.number(Math.round(s.totalVolume)), duration: String(s.duration) },
            ),
        },
        onOpen: { page: "session", param: { sessionId: "id" } },
        emptyText: {
          en: "No sessions logged yet. Hit Train to start one.",
          "pt-BR": "Nenhum treino registrado ainda. Toque em Treinar para começar.",
          de: "Noch keine Trainings eingetragen. Tippe auf Training, um eins zu starten.",
          es: "Aún no hay sesiones. Pulsa Entrenar para empezar una.",
          pl: "Brak zapisanych treningów. Stuknij Trening, by zacząć.",
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
        ],
      },
    },
    {
      id: "program",
      title: { en: "Program", "pt-BR": "Programa", de: "Programm", es: "Programa", pl: "Program", it: "Programma" },
      view: {
        type: "list",
        entity: "exercise",
        sort: (a, b) => a.day.localeCompare(b.day) || a.order - b.order,
        display: {
          primary: (e) => e.name,
          secondary: (e, ctx) => {
            const bodyweight = e.bodyweight
              ? ` · ${ctx.t({ en: "bodyweight", "pt-BR": "peso corporal", de: "Eigengewicht", es: "peso corporal", pl: "masa ciała", it: "corpo libero" })}`
              : "";
            return `${dayName(e.day, ctx)} · ${e.targetSets}×${e.repRange}${bodyweight}`;
          },
        },
        onOpen: { page: "exercise", param: { exerciseId: "id" } },
      },
    },
    {
      id: "exercise",
      title: { en: "Exercise", "pt-BR": "Exercício", de: "Übung", es: "Ejercicio", pl: "Ćwiczenie", it: "Esercizio" },
      hidden: true,
      view: {
        type: "detail",
        entity: "exercise",
        param: "exerciseId",
        sections: [
          { title: { en: "Exercise", "pt-BR": "Exercício", de: "Übung", es: "Ejercicio", pl: "Ćwiczenie", it: "Esercizio" }, fields: ["name", "day", "order"] },
          { title: { en: "Target", "pt-BR": "Meta", de: "Ziel", es: "Objetivo", pl: "Cel", it: "Obiettivo" }, fields: ["targetSets", "repRange", "bodyweight"] },
          {
            title: { en: "Rolling best", "pt-BR": "Melhor recente", de: "Aktueller Bestwert", es: "Mejor reciente", pl: "Ostatni rekord", it: "Record recente" },
            fields: ["lastBest"],
          },
          { title: { en: "Notes", "pt-BR": "Anotações", de: "Notizen", es: "Notas", pl: "Notatki", it: "Note" }, fields: ["cue"] },
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
        sections: [
          {
            title: { en: "Overview", "pt-BR": "Visão geral", de: "Überblick", es: "Resumen", pl: "Przegląd", it: "Panoramica" },
            fields: ["day", "date", "duration", "totalSets", "totalVolume"],
          },
          // nested list rendered in the detail view
          { title: { en: "Entries", "pt-BR": "Exercícios", de: "Übungen", es: "Ejercicios", pl: "Ćwiczenia", it: "Esercizi" }, fields: ["entries"] },
        ],
      },
    },
  ],

  reminders: [],
});
