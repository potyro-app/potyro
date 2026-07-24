// The live workout tracker — a custom view (full React, runs trusted). Mobile-first: you
// explicitly START a workout (which timestamps it and starts a clock), work through each
// exercise tapping ✓ to complete a set, a rest timer counts down, finishing an exercise's sets
// auto-advances, and FINISH writes a session (nested entries → sets) with its duration. The
// in-progress workout is saved to ctx.storage so leaving/returning the tab doesn't lose it.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewProps } from "karta";

const DAYS = ["push", "pull", "legs"] as const;
const REST_SECONDS = 90;

type SetRow = { kg: string; reps: string; done: boolean };
type Plan = Record<string, SetRow[]>; // exerciseId -> set rows

interface Active {
  day: string;
  startedAt: string; // ISO
  plan: Plan;
}

const mmss = (total: number): string => `${Math.floor(total / 60)}:${String(Math.max(0, total % 60)).padStart(2, "0")}`;

export function LogSession(props: ViewProps) {
  const { runtime, navigate } = props;
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

  if (loading) return <div className="wk-load">Loading…</div>;

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
          <h1 className="wk-start-title">Ready to train?</h1>
          <div className="wk-seg">
            {DAYS.map((d) => (
              <button key={d} className="wk-seg-btn" data-on={d === day} onClick={() => setDay(d)}>
                {d}
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
            {exercises.length === 0 ? <li className="wk-muted">No {day} exercises — add some on the Program tab.</li> : null}
          </ul>
          <button className="wk-start-btn" disabled={!exercises.length} onClick={start}>
            Start {day} workout
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
      setRest(REST_SECONDS);
      if (rows.every((r) => r.done)) {
        const next = exercises.find((e: any) => e.id !== exId && !(plan[e.id] ?? []).every((r) => r.done));
        if (next) setOpenId(next.id);
      }
    }
  };

  const addSet = (exId: string): void =>
    setPlan((p) => ({ ...p, [exId]: [...(p[exId] ?? []), { kg: "", reps: "", done: false }] }));

  const cancel = (): void => {
    if (!globalThis.confirm?.("Discard this workout?")) return;
    setStartedAt(null);
    setPlan({});
    setRest(null);
  };

  const finish = async (): Promise<void> => {
    const entries = exercises
      .map((e: any) => ({
        exercise: e.id,
        sets: (plan[e.id] ?? []).filter((r) => r.done && r.reps).map((r) => ({ kg: Number(r.kg) || 0, reps: Number(r.reps) || 0 })),
      }))
      .filter((en: any) => en.sets.length > 0);
    if (entries.length === 0) {
      runtime.ctx.ui.toast("Complete a set first");
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
          <span className="wk-top-day">{day}</span>
          <span className="wk-clock">{mmss(elapsed)}</span>
        </div>
        <div className="wk-top-r">
          <span className="wk-top-prog">
            {setsDone}/{setsTotal}
          </span>
          <button className="wk-cancel" onClick={cancel} aria-label="Discard workout">
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
                  {best ? ` · best ${e.bodyweight ? "" : `${best.kg}kg×`}${best.reps}` : ""}
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
                        <em>reps</em>
                      </label>
                      <button className="wk-check" data-on={r.done} onClick={() => toggleDone(e.id, i)} aria-label="Complete set">
                        ✓
                      </button>
                    </div>
                  ))}
                  <button className="wk-addset" onClick={() => addSet(e.id)}>
                    + Add set
                  </button>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="wk-bar">
        {rest != null ? (
          <div className="wk-rest">
            <span className="wk-rest-n">{mmss(rest)}</span>
            <button onClick={() => setRest((r) => (r ?? 0) + 30)}>+30s</button>
            <button onClick={() => setRest(null)}>skip</button>
          </div>
        ) : (
          <span className="wk-bar-hint">Tap ✓ to log a set</span>
        )}
        <button className="wk-finish" onClick={() => void finish()}>
          Finish
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
.wk-bar { position:fixed; left:50%; transform:translateX(-50%); bottom:0; width:min(860px, 100%); display:flex; align-items:center; gap:10px; padding:12px 16px calc(12px + env(safe-area-inset-bottom)); background:var(--surface,#fff); border-top:1px solid var(--line,#eee); z-index:20; }
.wk-bar-hint { color:var(--ink-soft,#999); font-size:.9rem; }
.wk-rest { display:flex; align-items:center; gap:8px; }
.wk-rest-n { font-size:1.4rem; font-weight:800; font-variant-numeric: tabular-nums; color:var(--wk-accent); }
.wk-rest button { border:1px solid var(--line,#ddd); background:var(--paper,#f3efe6); border-radius:8px; padding:.35rem .6rem; }
.wk-finish { margin-left:auto; padding:.9rem 1.6rem; border:0; border-radius:12px; background:var(--wk-accent); color:#08203f; font-weight:800; font-size:1.05rem; }
.wk-muted { color:var(--ink-soft,#999); }
`;
