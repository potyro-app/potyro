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
import { defineApp } from "karta";
import { LogSession } from "./views/LogSession"; // the live workout tracker (custom view)

const LOOKBACK = 5; // "best of the last N sessions"

// relations inside list rows may be a raw id ref or a resolved object — handle both
const refId = (x: unknown): string => (typeof x === "string" ? x : (x as { id: string }).id);
// scoring: bodyweight lifts progress on reps; loaded lifts on volume (kg × reps)
const setScore = (bw: boolean, s: { kg?: number; reps?: number }) => (bw ? (s.reps ?? 0) : (s.kg ?? 0) * (s.reps ?? 0));

export default defineApp({
  id: "workout",
  name: "PPL Log",
  version: "1.0.0",
  schemaVersion: 1,
  theme: { accent: "#5B8DEF" },
  permissions: { haptics: true }, // buzz on set-complete + rest-end

  // Quick actions: "Start session" picks the day inline (instant menu → creates + opens the session);
  // "New exercise" opens the form (the exercise has other required fields). Demonstrates KA-04 ④.
  quickActions: [
    { id: "start-session", label: "Start session", icon: "▶", entity: "session", mode: "menu", open: true },
    { id: "new-exercise", label: "New exercise", icon: "＋", entity: "exercise" },
  ],

  entities: {
    // ---- the PROGRAM: editable exercise records ----
    exercise: {
      label: "Exercise",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        day: { type: "enum", options: ["push", "pull", "legs"], required: true },
        order: { type: "number", integer: true, default: 0 },
        targetSets: { type: "number", integer: true, min: 1, default: 3 },
        repRange: { type: "text", default: "8–12" },
        cue: { type: "text", multiline: true },
        bodyweight: { type: "boolean", default: false },
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
      label: "Session",
      displayField: "label",
      fields: {
        day: { type: "enum", options: ["push", "pull", "legs"], required: true },
        date: { type: "datetime", required: true, default: (ctx) => ctx.now() },
        durationSec: { type: "number", hidden: true },
        entries: {
          type: "list",
          of: {
            exercise: { type: "relation", to: "exercise", required: true },
            sets: {
              // NESTED list: a list field whose rows contain another list field
              type: "list",
              ordered: true,
              of: {
                kg: { type: "number", min: 0 },
                reps: { type: "number", min: 0, integer: true },
              },
            },
          },
        },
      },
      computed: {
        label: (s) => `${s.day[0].toUpperCase()}${s.day.slice(1)} — ${s.date.toLocaleDateString()}`,
        duration: (s) => (s.durationSec ? `${Math.round(s.durationSec / 60)} min` : "—"),
        totalSets: (s) => ((s.entries as any[]) ?? []).reduce((n: number, e: any) => n + (e.sets?.length ?? 0), 0),
        totalVolume: (s) =>
          ((s.entries as any[]) ?? []).reduce(
            (v: number, e: any) => v + ((e.sets as any[]) ?? []).reduce((a: number, x: any) => a + (x.kg ?? 0) * (x.reps ?? 0), 0),
            0,
          ),
      },
    },
  },

  pages: [
    {
      // The live workout screen — bespoke logic, so it's a custom view (full React component).
      id: "train",
      title: "Train",
      view: {
        type: "custom",
        entity: "session",
        render: (props) => LogSession(props),
      },
    },
    {
      id: "history",
      title: "History",
      view: {
        type: "list",
        entity: "session",
        sort: (a, b) => b.date.getTime() - a.date.getTime(),
        display: {
          primary: (s) => s.label,
          secondary: (s) => `${s.totalSets} sets · ${Math.round(s.totalVolume)} kg · ${s.duration}`,
        },
        onOpen: { page: "session", param: { sessionId: "id" } },
        emptyText: "No sessions logged yet. Hit Train to start one.",
      },
    },
    {
      id: "program",
      title: "Program",
      view: {
        type: "list",
        entity: "exercise",
        sort: (a, b) => a.day.localeCompare(b.day) || a.order - b.order,
        display: {
          primary: (e) => e.name,
          secondary: (e) => `${e.day} · ${e.targetSets}×${e.repRange}${e.bodyweight ? " · bodyweight" : ""}`,
        },
        onOpen: { page: "exercise", param: { exerciseId: "id" } },
      },
    },
    {
      id: "exercise",
      title: "Exercise",
      hidden: true,
      view: {
        type: "detail",
        entity: "exercise",
        param: "exerciseId",
        sections: [
          { title: "Exercise", fields: ["name", "day", "order"] },
          { title: "Target", fields: ["targetSets", "repRange", "bodyweight"] },
          { title: "Rolling best", fields: ["lastBest"] },
          { title: "Notes", fields: ["cue"] },
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
        sections: [
          { title: "Overview", fields: ["day", "date", "duration", "totalSets", "totalVolume"] },
          { title: "Entries", fields: ["entries"] }, // nested list rendered in the detail view
        ],
      },
    },
  ],

  reminders: [],
});
