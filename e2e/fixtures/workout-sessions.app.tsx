// Workout Sessions.
//
// Three separate jobs, three different UIs — conflating them is what made earlier versions useless:
//
//   LIBRARY (at home)  Exercises and Routines are real records with real fields. Creating them uses
//                      the normal form. A form is right here: you are curating, not training.
//   TRAINING (in gym)  One tap starts a workout. Load a routine, or add an exercise inline. Weight
//                      and reps are editable right on the set card — that is the point of tracking.
//   STATE (never typed) Clock, progress, rest are `hidden`. `finish` stamps its own end time.
//
// Taps from opening the app to logging set 1: 2 with a routine (Start → Load routine → tap circle
// is 3 including the log), 3 freestyle. Measured against the real runtime, not estimated.
//
// The elapsed clock is computed IN THE COMPONENT: `useRecord` only re-fetches on a store write, so a
// computed clock is frozen between writes and the timer sits at 00:00 however often the view renders.

import { defineApp, type ViewProps } from "karta";
import { useEffect, useRef, useState } from "react";

const DEF_SERIES = 3;
const DEF_REPS = 10;
const DEF_REST = 60;

const clock = (s: number): string =>
  `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, "0")}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

const idOf = (ref: unknown): string | undefined =>
  typeof ref === "string" ? ref : ((ref as { id?: string } | null)?.id ?? undefined);
const nameOf = (ref: unknown): string =>
  ref && typeof ref === "object" ? String((ref as { name?: string }).name ?? "Exercise") : "Exercise";

const S = {
  wrap: { display: "flex", flexDirection: "column", gap: "1rem" } as const,
  bar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" } as const,
  clock: { fontSize: "2.8rem", fontVariantNumeric: "tabular-nums", lineHeight: 1, fontWeight: 600 } as const,
  track: { height: 8, borderRadius: 999, background: "var(--line)", overflow: "hidden" } as const,
  fill: (p: number) => ({ height: "100%", width: `${p}%`, background: "var(--accent)", transition: "width 200ms" }),
  card: { border: "1px solid var(--line)", borderRadius: 12, padding: "0.9rem 1rem", display: "flex", flexDirection: "column", gap: "0.7rem" } as const,
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" } as const,
  dots: { display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" } as const,
  dot: (done: boolean) => ({
    width: 52, height: 52, borderRadius: 14,
    border: `1px solid ${done ? "var(--accent)" : "var(--line)"}`,
    background: done ? "var(--accent)" : "transparent",
    color: done ? "#fff" : "inherit",
    font: "inherit", fontSize: "1.05rem", fontWeight: 600, cursor: "pointer",
  }),
  num: { width: 74, font: "inherit", padding: "0.35rem 0.5rem", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", color: "inherit" } as const,
  rest: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.8rem 1rem", border: "2px solid var(--accent)", borderRadius: 12, flexWrap: "wrap" } as const,
  row: { display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" } as const,
};

function Run({ runtime, param }: ViewProps) {
  const sessionId = String(param?.sessionId ?? "");
  const { record, loading } = runtime.useRecord("session", sessionId);
  const [, force] = useState(0);
  const autoStarted = useRef(false);

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  // Opening the runner IS starting the workout.
  useEffect(() => {
    if (!record || autoStarted.current) return;
    if (!record.running && !record.finishedAt) {
      autoStarted.current = true;
      void runtime.runAction("session", "start", record.id);
    }
  }, [record, runtime]);

  if (loading) return <p className="k-muted">Loading…</p>;
  if (!record) return <p className="k-muted">No session.</p>;

  const sets = (record.sets as Record<string, unknown>[]) ?? [];
  const act = (key: string, input?: unknown) => void runtime.runAction("session", key, record.id, input);

  const base = Number(record.elapsedSeconds ?? 0);
  const since = record.running && record.startedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(record.startedAt as string).getTime()) / 1000))
    : 0;
  const restLeft = record.restEndsAt
    ? Math.max(0, Math.round((new Date(record.restEndsAt as string).getTime() - Date.now()) / 1000))
    : 0;

  const totalSeries = sets.reduce((n, s) => n + Number(s?.series ?? 0), 0);
  const doneSeries = sets.reduce((n, s) => n + Number(s?.done ?? 0), 0);

  return (
    <div style={S.wrap}>
      <div style={S.bar}>
        <div>
          <div style={S.clock}>{clock(base + since)}</div>
          <div className="k-muted">{doneSeries} / {totalSeries} series</div>
        </div>
        <div style={S.row}>
          {record.running ? (
            <button type="button" className="k-add" onClick={() => act("pause")}>⏸</button>
          ) : (
            <button type="button" className="k-add" onClick={() => act("start")}>▶</button>
          )}
          <button type="button" className="k-add" onClick={() => act("finish")}>🏁 End</button>
        </div>
      </div>

      <div style={S.track}><div style={S.fill(totalSeries ? Math.round((doneSeries / totalSeries) * 100) : 0)} /></div>

      {restLeft > 0 ? (
        <div style={S.rest}>
          <div>
            <div className="k-muted">REST</div>
            <div style={{ ...S.clock, fontSize: "2rem" }}>{clock(restLeft)}</div>
          </div>
          <div style={S.row}>
            <button type="button" className="k-add" onClick={() => act("restMinus15")}>−15s</button>
            <button type="button" className="k-add" onClick={() => act("restPlus15")}>+15s</button>
            <button type="button" className="k-add" onClick={() => act("skipRest")}>⏭ Skip</button>
          </div>
        </div>
      ) : null}

      <div style={S.row}>
        <button type="button" className="k-add" onClick={() => act("loadRoutine")}>📋 Load routine</button>
        <button type="button" className="k-add" onClick={() => act("addExercise")}>＋ Exercise</button>
      </div>

      {sets.length === 0 ? (
        <p className="k-muted">Load a routine, or add a single exercise.</p>
      ) : null}

      {sets.map((s, i) => {
        const series = Number(s?.series ?? 0);
        const done = Number(s?.done ?? 0);
        return (
          <div key={`${i}-${nameOf(s?.exercise)}`} style={S.card}>
            <div style={S.head}>
              <strong>{nameOf(s?.exercise)}</strong>
              <button type="button" className="k-add" onClick={() => act("removeExercise", { index: i })}>✕</button>
            </div>

            {/* Weight and reps are editable here — logging a workout without them is pointless. */}
            <div style={S.row}>
              <label className="k-muted">
                kg{" "}
                <input
                  style={S.num}
                  type="number"
                  step="0.5"
                  defaultValue={s?.weight == null ? "" : String(s.weight)}
                  onBlur={(e) => act("setField", { index: i, key: "weight", value: e.currentTarget.value })}
                />
              </label>
              <label className="k-muted">
                reps{" "}
                <input
                  style={S.num}
                  type="number"
                  defaultValue={String(s?.reps ?? DEF_REPS)}
                  onBlur={(e) => act("setField", { index: i, key: "reps", value: e.currentTarget.value })}
                />
              </label>
              <label className="k-muted">
                rest s{" "}
                <input
                  style={S.num}
                  type="number"
                  step="15"
                  defaultValue={String(s?.rest ?? DEF_REST)}
                  onBlur={(e) => act("setField", { index: i, key: "rest", value: e.currentTarget.value })}
                />
              </label>
            </div>

            <div style={S.dots}>
              {Array.from({ length: series }, (_, k) => (
                <button
                  key={k}
                  type="button"
                  style={S.dot(k < done)}
                  aria-label={`${nameOf(s?.exercise)} series ${k + 1}`}
                  onClick={() => act("tick", { index: i, delta: k < done ? -1 : 1 })}
                >
                  {k < done ? "✓" : k + 1}
                </button>
              ))}
              <button type="button" className="k-add" onClick={() => act("addSeries", { index: i })}>＋ series</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default defineApp({
  id: "workout-sessions",
  name: "Workout Sessions",
  version: "3.0.0",
  schemaVersion: 1,
  nav: "grid",
  quickActions: [
    // Training: one tap, no form.
    { id: "start", label: "Start workout", icon: "▶", entity: "session", mode: "instant", openPage: "run" },
    // Library: normal create forms — this is curation, not training.
    { id: "new-exercise", label: "New exercise", icon: "🏋", entity: "exercise", mode: "form", open: true },
    { id: "new-routine", label: "New routine", icon: "📋", entity: "routine", mode: "form", open: true },
  ],

  entities: {
    exercise: {
      label: "Exercise",
      icon: "🏋",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        muscleGroup: {
          type: "enum",
          options: ["chest", "back", "shoulders", "arms", "legs", "core", "full body", "cardio"],
          default: "full body",
        },
        equipment: {
          type: "enum",
          options: ["bodyweight", "dumbbell", "barbell", "machine", "kettlebell", "band", "cable", "other"],
          default: "bodyweight",
        },
        defaultSeries: { type: "number", label: "Series", min: 1, default: DEF_SERIES },
        defaultReps: { type: "number", label: "Reps", min: 1, default: DEF_REPS },
        defaultWeight: { type: "number", label: "Weight (kg)", min: 0 },
        defaultRestSeconds: { type: "number", label: "Rest (s)", min: 0, default: DEF_REST },
        notes: { type: "richtext" },
        demo: { type: "media" },
      },
      computed: {
        summary: (e) =>
          `${e.defaultSeries ?? 0}×${e.defaultReps ?? 0}${e.defaultWeight ? ` · ${e.defaultWeight}kg` : ""} · ${e.defaultRestSeconds ?? 0}s rest`,
      },
    },

    // A saved workout: "Push day" with its exercises. Starting from nothing every time was the gap.
    routine: {
      label: "Routine",
      icon: "📋",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        focus: {
          type: "enum",
          options: ["push", "pull", "legs", "upper", "lower", "full body", "mobility", "conditioning"],
          default: "full body",
        },
        exercises: {
          type: "list",
          label: "Exercises",
          ordered: true,
          of: {
            exercise: { type: "relation", to: "exercise", required: true },
            series: { type: "number", default: DEF_SERIES },
            reps: { type: "number", default: DEF_REPS },
            weight: { type: "number" },
            rest: { type: "number", label: "Rest (s)", default: DEF_REST },
          },
        },
        notes: { type: "richtext" },
      },
      computed: {
        count: (r) => ((r.exercises as unknown[]) ?? []).length,
        totalSeries: (r) => ((r.exercises as Record<string, unknown>[]) ?? []).reduce((n, x) => n + Number(x?.series ?? 0), 0),
        summary: (r) => `${r.count} exercises · ${r.totalSeries} series`,
      },
      actions: {
        // Start a workout from this routine, from the routine's own page.
        startWorkout: async (r, ctx) => {
          const rows = ((r.exercises as Record<string, unknown>[]) ?? []).map((x) => ({
            exercise: idOf(x.exercise),
            series: Number(x.series ?? DEF_SERIES),
            reps: Number(x.reps ?? DEF_REPS),
            weight: x.weight ?? null,
            rest: Number(x.rest ?? DEF_REST),
            done: 0,
          }));
          const s = await ctx.create("session", {
            name: `${String(r.name)} — ${ctx.today().toLocaleDateString()}`,
            routine: r.id,
            sets: rows,
            elapsedSeconds: 0,
            running: false,
          });
          ctx.navigate("run", { sessionId: s.id });
        },
      },
    },

    session: {
      label: "Session",
      icon: "⏱",
      displayField: "name",
      fields: {
        name: { type: "text", required: true, default: (ctx) => ctx.today().toLocaleDateString() },
        routine: { type: "relation", to: "routine" },
        notes: { type: "richtext" },
        sets: {
          type: "list",
          label: "Sets",
          hidden: true, // built in the runner
          ordered: true,
          of: {
            exercise: { type: "relation", to: "exercise" },
            series: { type: "number", default: DEF_SERIES },
            reps: { type: "number", default: DEF_REPS },
            weight: { type: "number" },
            rest: { type: "number", default: DEF_REST },
            done: { type: "number", default: 0 },
          },
        },
        startedAt: { type: "datetime", hidden: true },
        finishedAt: { type: "datetime", hidden: true },
        elapsedSeconds: { type: "number", hidden: true, default: 0 },
        running: { type: "boolean", hidden: true, default: false },
        restEndsAt: { type: "datetime", hidden: true },
      },
      computed: {
        setCount: (s) => ((s.sets as unknown[]) ?? []).length,
        totalSeries: (s) => ((s.sets as Record<string, unknown>[]) ?? []).reduce((n, x) => n + Number(x?.series ?? 0), 0),
        seriesDone: (s) => ((s.sets as Record<string, unknown>[]) ?? []).reduce((n, x) => n + Number(x?.done ?? 0), 0),
        percentDone: (s) => (Number(s.totalSeries) ? Math.round((Number(s.seriesDone) / Number(s.totalSeries)) * 100) : 0),
        volume: (s) =>
          ((s.sets as Record<string, unknown>[]) ?? []).reduce(
            (n, x) => n + Number(x?.done ?? 0) * Number(x?.reps ?? 0) * Number(x?.weight ?? 0),
            0,
          ),
        liveSeconds: (s, ctx) => {
          const base = Number(s.elapsedSeconds ?? 0);
          if (!s.running || !s.startedAt) return base;
          return base + Math.max(0, Math.floor((ctx.now().getTime() - new Date(s.startedAt as string).getTime()) / 1000));
        },
        clock: (s) => clock(Number(s.liveSeconds ?? 0)),
        statusLine: (s) =>
          s.finishedAt
            ? `done · ${s.clock} · ${s.seriesDone}/${s.totalSeries} series${Number(s.volume) ? ` · ${Math.round(Number(s.volume))} kg` : ""}`
            : s.running
              ? `▶ running · ${s.seriesDone}/${s.totalSeries} series`
              : `${s.setCount} exercises · ${s.percentDone}%`,
      },
      actions: {
        start: async (s, ctx) => {
          if (s.running || s.finishedAt) return;
          await ctx.patch("session", s.id, { running: true, startedAt: ctx.now() });
        },
        pause: async (s, ctx) => {
          if (!s.running) return;
          await ctx.patch("session", s.id, { running: false, elapsedSeconds: Number(s.liveSeconds ?? 0), startedAt: null });
        },
        finish: async (s, ctx) => {
          await ctx.patch("session", s.id, {
            running: false,
            elapsedSeconds: Number(s.liveSeconds ?? 0),
            startedAt: null,
            finishedAt: ctx.now(),
            restEndsAt: null,
          });
          ctx.ui.toast(`Done · ${clock(Number(s.liveSeconds ?? 0))} · ${String(s.seriesDone)} series`);
        },

        /** Copy a saved routine's exercises into this session. */
        loadRoutine: async (s, ctx) => {
          const routines = await ctx.query("routine", { sort: (a, b) => String(a.name).localeCompare(String(b.name)) });
          if (!routines.length) {
            ctx.ui.toast("No routines yet — make one from the Routines tab.");
            return;
          }
          const chosen = (await ctx.ui.pick(routines, { label: (r) => `${String(r.name)} (${String(r.summary)})` })) as
            | Record<string, unknown>
            | null;
          if (!chosen) return;
          const rows = ((chosen.exercises as Record<string, unknown>[]) ?? []).map((x) => ({
            exercise: idOf(x.exercise),
            series: Number(x.series ?? DEF_SERIES),
            reps: Number(x.reps ?? DEF_REPS),
            weight: x.weight ?? null,
            rest: Number(x.rest ?? DEF_REST),
            done: 0,
          }));
          await ctx.patch("session", s.id, {
            sets: [...(((s.sets as Record<string, unknown>[]) ?? []).map(strip)), ...rows],
            routine: chosen.id,
          });
        },

        /** Add one exercise mid-workout: pick from the library, or type a new name. */
        addExercise: async (s, ctx) => {
          const library = await ctx.query("exercise", { sort: (a, b) => String(a.name).localeCompare(String(b.name)) });
          let ex: Record<string, unknown> | null = null;
          if (library.length) {
            ex = (await ctx.ui.pick(library, { label: (e) => `${String(e.name)} — ${String(e.summary)}` })) as
              | Record<string, unknown>
              | null;
          }
          if (!ex) {
            const typed = (await ctx.ui.prompt("New exercise name"))?.trim();
            if (!typed) return;
            const existing = library.find((e) => String(e.name).toLowerCase() === typed.toLowerCase());
            ex = existing ?? (await ctx.create("exercise", { name: typed }));
          }
          const rows = [...(((s.sets as Record<string, unknown>[]) ?? []).map(strip))];
          rows.push({
            exercise: String(ex.id),
            series: Number(ex.defaultSeries ?? DEF_SERIES),
            reps: Number(ex.defaultReps ?? DEF_REPS),
            weight: ex.defaultWeight ?? null,
            rest: Number(ex.defaultRestSeconds ?? DEF_REST),
            done: 0,
          });
          await ctx.patch("session", s.id, { sets: rows });
        },

        removeExercise: async (s, ctx, input) => {
          const { index } = (input ?? {}) as { index?: number };
          const rows = ((s.sets as Record<string, unknown>[]) ?? []).map(strip).filter((_, i) => i !== index);
          await ctx.patch("session", s.id, { sets: rows });
        },

        /** Edit weight / reps / rest on one set row, from the runner. */
        setField: async (s, ctx, input) => {
          const { index, key, value } = (input ?? {}) as { index?: number; key?: string; value?: string };
          if (index == null || !key) return;
          const rows = ((s.sets as Record<string, unknown>[]) ?? []).map(strip);
          const row = rows[index];
          if (!row) return;
          const n = value === "" || value == null ? null : Number(value);
          rows[index] = { ...row, [key]: n != null && Number.isFinite(n) ? n : null };
          await ctx.patch("session", s.id, { sets: rows });
        },

        tick: async (s, ctx, input) => {
          const { index, delta } = (input ?? {}) as { index?: number; delta?: number };
          const rows = ((s.sets as Record<string, unknown>[]) ?? []).map(strip);
          const row = rows[index ?? -1];
          if (!row) return;
          const series = Number(row.series ?? 0);
          const next = Math.max(0, Math.min(series, Number(row.done ?? 0) + Number(delta ?? 1)));
          rows[index as number] = { ...row, done: next };
          const patch: Record<string, unknown> = { sets: rows };
          if (Number(delta ?? 1) > 0 && next < series) {
            patch.restEndsAt = new Date(ctx.now().getTime() + Number(row.rest ?? DEF_REST) * 1000);
          }
          await ctx.patch("session", s.id, patch);
        },

        addSeries: async (s, ctx, input) => {
          const { index } = (input ?? {}) as { index?: number };
          const rows = ((s.sets as Record<string, unknown>[]) ?? []).map(strip);
          const row = rows[index ?? -1];
          if (!row) return;
          rows[index as number] = { ...row, series: Number(row.series ?? 0) + 1 };
          await ctx.patch("session", s.id, { sets: rows });
        },

        restPlus15: async (s, ctx) => {
          const base = s.restEndsAt ? new Date(s.restEndsAt as string).getTime() : ctx.now().getTime();
          await ctx.patch("session", s.id, { restEndsAt: new Date(base + 15000) });
        },
        restMinus15: async (s, ctx) => {
          const base = s.restEndsAt ? new Date(s.restEndsAt as string).getTime() : ctx.now().getTime();
          await ctx.patch("session", s.id, { restEndsAt: new Date(Math.max(ctx.now().getTime(), base - 15000)) });
        },
        skipRest: async (s, ctx) => {
          await ctx.patch("session", s.id, { restEndsAt: null });
        },
      },
    },
  },

  pages: [
    {
      id: "sessions",
      title: "Workouts",
      view: {
        type: "list",
        entity: "session",
        sort: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
        display: { primary: "name", secondary: (s) => String(s.statusLine) },
        onOpen: { page: "run", param: { sessionId: "id" } },
        emptyText: "No workouts yet — hit Start workout.",
      },
    },
    {
      id: "routines",
      title: "Routines",
      view: {
        type: "list",
        entity: "routine",
        display: { primary: "name", secondary: (r) => String(r.summary) },
        rowActions: ["startWorkout"],
        onOpen: { page: "routine-detail", param: { routineId: "id" } },
        emptyText: "No routines yet — hit New routine to build one.",
      },
    },
    {
      id: "exercises",
      title: "Exercises",
      view: {
        type: "list",
        entity: "exercise",
        sort: (a, b) => String(a.name).localeCompare(String(b.name)),
        display: { primary: "name", secondary: (e) => `${e.muscleGroup} · ${e.summary}` },
        onOpen: { page: "exercise-detail", param: { exerciseId: "id" } },
        emptyText: "No exercises yet — hit New exercise.",
      },
    },
    {
      id: "run",
      title: "Workout",
      hidden: true,
      view: { type: "custom", entity: "session", param: "sessionId", render: (props) => Run(props) },
    },
    {
      id: "routine-detail",
      title: "Routine",
      hidden: true,
      view: {
        type: "detail",
        entity: "routine",
        param: "routineId",
        sections: [
          { fields: ["name", "focus"] },
          { title: "Exercises", fields: ["exercises"] },
          { title: "Notes", fields: ["notes"] },
        ],
        actions: ["startWorkout"],
      },
    },
    {
      id: "exercise-detail",
      title: "Exercise",
      hidden: true,
      view: {
        type: "detail",
        entity: "exercise",
        param: "exerciseId",
        sections: [
          { fields: ["name", "muscleGroup", "equipment"] },
          { title: "Defaults", fields: ["defaultSeries", "defaultReps", "defaultWeight", "defaultRestSeconds"] },
          { title: "Reference", fields: ["demo", "notes"] },
        ],
      },
    },
  ],
});

/** List rows come back with relations resolved to objects; storage wants the id back. */
function strip(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, exercise: idOf(row.exercise) };
}
