// Workout's first-run records: a PPL program someone has been running for about eleven weeks, and a
// second program (Upper/Lower) resting on the shelf — proof that routines are just records.
//
// The history is a real double progression, so every chart rises the way a lifter's would: each
// exercise climbs from the bottom of its rep range to the top over three sessions, then the weight
// goes up and the reps start again. Thirty sessions in turn — Push A, Pull A, Legs A — with two
// weeks off three weeks ago, so the streak reads three or four weeks in a row rather than eleven.
// The last session, yesterday, was Push A: two lifts went up in weight that day (Bench Press and
// Overhead Press, the two personal records its page shows), the rest repeated the session before.
// So the Train screen opens on "Next up: Pull A". Each session keeps the records it broke, worked
// out here the way the app works them out when a workout is finished.
import type { Store } from "@potyro/store";
import type { SeedPhoto } from "../seed.js";

const DAY = 86_400_000;

interface Lift {
  name: string;
  muscles: string[];
  repRange: string;
  step: number;
  restSec: number;
  /** Starting weight, ten weeks ago. 0 for a bodyweight lift. */
  start: number;
  sets: number;
  /** Where in its three-session cycle the lift starts, so they do not all add weight on the same day. */
  phase: number;
  bodyweight?: boolean;
  /** A lighter set first, for the big lifts. */
  warmup?: boolean;
  cue?: string;
}

const PUSH: Lift[] = [
  { name: "Bench Press", muscles: ["chest", "triceps", "shoulders"], repRange: "6–10", step: 2.5, restSec: 150, start: 60, sets: 4, phase: 0, warmup: true, cue: "Shoulder blades pinned, bar to mid-chest, elbows about 45°" },
  { name: "Overhead Press", muscles: ["shoulders", "triceps"], repRange: "6–10", step: 2.5, restSec: 120, start: 37.5, sets: 3, phase: 0, cue: "Squeeze your glutes, head through at the top" },
  { name: "Incline Dumbbell Press", muscles: ["chest", "shoulders"], repRange: "8–12", step: 2, restSec: 90, start: 20, sets: 3, phase: 1 },
  { name: "Lateral Raise", muscles: ["shoulders"], repRange: "12–15", step: 1, restSec: 60, start: 8, sets: 3, phase: 2, cue: "Lead with the elbows, stop at shoulder height" },
  { name: "Triceps Pushdown", muscles: ["triceps"], repRange: "10–15", step: 2.5, restSec: 60, start: 22.5, sets: 3, phase: 1 },
];
const PULL: Lift[] = [
  { name: "Barbell Row", muscles: ["back", "biceps"], repRange: "6–10", step: 2.5, restSec: 120, start: 55, sets: 4, phase: 1, warmup: true, cue: "Flat back, pull to the belly button" },
  { name: "Pull-up", muscles: ["back", "biceps"], repRange: "5–10", step: 0, restSec: 120, start: 0, sets: 3, phase: 2, bodyweight: true, cue: "Dead hang to chin over the bar, no swinging" },
  { name: "Lat Pulldown", muscles: ["back"], repRange: "8–12", step: 2.5, restSec: 90, start: 50, sets: 3, phase: 0 },
  { name: "Face Pull", muscles: ["shoulders", "back"], repRange: "12–15", step: 2.5, restSec: 60, start: 15, sets: 3, phase: 2 },
  { name: "Biceps Curl", muscles: ["biceps"], repRange: "8–12", step: 1, restSec: 60, start: 12, sets: 3, phase: 1 },
];
const LEGS: Lift[] = [
  { name: "Squat", muscles: ["quads", "glutes"], repRange: "5–8", step: 5, restSec: 180, start: 85, sets: 4, phase: 2, warmup: true, cue: "Brace, knees over toes, hip crease below the knee" },
  { name: "Romanian Deadlift", muscles: ["hamstrings", "glutes"], repRange: "8–10", step: 5, restSec: 150, start: 70, sets: 3, phase: 1, cue: "Soft knees, push the hips back, bar close to the legs" },
  { name: "Leg Press", muscles: ["quads", "glutes"], repRange: "10–15", step: 10, restSec: 120, start: 120, sets: 3, phase: 0 },
  { name: "Leg Curl", muscles: ["hamstrings"], repRange: "10–15", step: 2.5, restSec: 60, start: 35, sets: 3, phase: 2 },
  { name: "Calf Raise", muscles: ["calves"], repRange: "10–15", step: 5, restSec: 60, start: 60, sets: 4, phase: 1 },
];

/** Days ago of each session: three a week, with two weeks off (20–32 days ago always holds a whole calendar week). */
const SCHEDULE = [1, 3, 5, 8, 10, 12, 15, 17, 19, 33, 35, 37, 40, 42, 44, 47, 49, 51, 54, 56, 58, 61, 63, 65, 68, 70, 72, 75, 77, 79];

const range = (text: string): [number, number] => {
  const [lo, hi] = text.split("–").map(Number);
  return [lo!, hi ?? lo!];
};

/** The sets of a lift on its k-th time: double progression, three sessions to a step. */
function setsFor(lift: Lift, k: number): Set_[] {
  const [lo, hi] = range(lift.repRange);
  const cycle = k + lift.phase;
  const kg = lift.bodyweight ? 0 : lift.start + Math.floor(cycle / 3) * lift.step;
  const mid = Math.round((lo + hi) / 2);
  const top = cycle % 3 === 2;
  const reps = cycle % 3 === 0 ? lo : top ? hi : mid;
  const extra = lift.bodyweight ? Math.floor(cycle / 3) : 0; // a bodyweight lift progresses on reps alone
  const out: Set_[] = [];
  if (lift.warmup) out.push({ kg: Math.round((kg * 0.5) / 2.5) * 2.5, reps: 8, kind: "warmup" });
  for (let i = 0; i < lift.sets; i++) {
    // The last set of a session that has not reached the top is the hardest: one rep short.
    const last = i === lift.sets - 1 && !top;
    out.push({ kg, reps: Math.max(1, reps + extra - (last ? 1 : 0)) });
  }
  return out;
}

type Set_ = { kg: number; reps: number; kind?: "warmup" };
const e1rm = (kg: number, reps: number): number => (reps <= 0 || kg <= 0 ? 0 : reps === 1 ? kg : Math.round(kg * (1 + reps / 30) * 2) / 2);

/**
 * The records a session broke, the way the app works them out when a workout is finished (its
 * `recordsIn`): a loaded lift by its heaviest working set and its best estimated 1RM, a bodyweight
 * lift by its most reps — against every earlier time, and never on a first time.
 */
function recordsOf(entries: { lift: Lift; exercise: string; sets: Set_[] }[], earlier: ReadonlyMap<string, Set_[]>) {
  const out: { exercise: string; kind: string; value: number }[] = [];
  for (const { lift, exercise, sets } of entries) {
    const now = sets.filter((s) => s.kind !== "warmup");
    const before = (earlier.get(exercise) ?? []).filter((s) => s.kind !== "warmup");
    if (!now.length || !before.length) continue;
    if (lift.bodyweight) {
      const reps = Math.max(...now.map((s) => s.reps));
      if (reps > Math.max(...before.map((s) => s.reps))) out.push({ exercise, kind: "reps", value: reps });
      continue;
    }
    const heaviest = Math.max(...now.map((s) => s.kg));
    if (heaviest > Math.max(...before.map((s) => s.kg))) out.push({ exercise, kind: "heaviest", value: heaviest });
    const best = Math.max(...now.map((s) => e1rm(s.kg, s.reps)));
    if (best > Math.max(...before.map((s) => e1rm(s.kg, s.reps)))) out.push({ exercise, kind: "e1rm", value: best });
  }
  return out;
}

export async function seedWorkout(store: Store, _me: string | undefined, _photo: SeedPhoto): Promise<void> {
  if ((await store.all("exercise")).length > 0) return;

  const ids = new Map<string, string>();
  for (const lift of [...PUSH, ...PULL, ...LEGS]) {
    const row = await store.insert("exercise", {
      name: lift.name,
      muscles: lift.muscles,
      repRange: lift.repRange,
      step: lift.step,
      restSec: lift.restSec,
      bodyweight: Boolean(lift.bodyweight),
      cue: lift.cue ?? "",
    });
    ids.set(lift.name, String(row.id));
  }
  const id = (name: string): string => ids.get(name)!;
  const rows = (lifts: Lift[]) => lifts.map((l) => ({ exercise: id(l.name), sets: l.sets, reps: l.repRange }));

  const routine = async (name: string, program: string, order: number, exercises: { exercise: string; sets: number; reps: string }[], active = true, note = "") =>
    String((await store.insert("routine", { name, program, order, active, note, exercises })).id);
  const push = await routine("Push A", "PPL", 0, rows(PUSH), true, "Chest, shoulders and triceps. Big press first, while you are fresh.");
  const pull = await routine("Pull A", "PPL", 1, rows(PULL), true, "Back and biceps.");
  const legs = await routine("Legs A", "PPL", 2, rows(LEGS), true, "The long one: eat beforehand.");
  // A second program, resting: switch it on in its routine to make it take turns instead.
  await routine("Upper", "Upper/Lower", 0, [
    { exercise: id("Bench Press"), sets: 4, reps: "6–10" },
    { exercise: id("Barbell Row"), sets: 4, reps: "6–10" },
    { exercise: id("Overhead Press"), sets: 3, reps: "8–12" },
    { exercise: id("Pull-up"), sets: 3, reps: "5–10" },
    { exercise: id("Biceps Curl"), sets: 2, reps: "10–15" },
  ], false);
  await routine("Lower", "Upper/Lower", 1, [
    { exercise: id("Squat"), sets: 4, reps: "5–8" },
    { exercise: id("Romanian Deadlift"), sets: 3, reps: "8–10" },
    { exercise: id("Leg Curl"), sets: 3, reps: "10–15" },
    { exercise: id("Calf Raise"), sets: 4, reps: "10–15" },
  ], false);

  const turns: { routine: string; lifts: Lift[] }[] = [
    { routine: push, lifts: PUSH },
    { routine: pull, lifts: PULL },
    { routine: legs, lifts: LEGS },
  ];
  const now = Date.now();
  const times = new Map<string, number>(); // how many times each lift has been done so far
  const lastSets = new Map<string, ReturnType<typeof setsFor>>();
  const done = new Map<string, Set_[]>(); // every set so far, per exercise: what a record has to beat
  const oldestFirst = [...SCHEDULE].sort((a, b) => b - a);
  for (let i = 0; i < oldestFirst.length; i++) {
    const daysAgo = oldestFirst[i]!;
    // Counted back from the last session, which is Push A.
    const turn = turns[(((oldestFirst.length - 1 - i) % 3) * 2) % 3]!;
    const final = i === oldestFirst.length - 1;
    const entries = turn.lifts.map((lift) => {
      const k = times.get(lift.name) ?? 0;
      times.set(lift.name, k + 1);
      // Yesterday only the two big presses moved up; everything else was a repeat of last time.
      const sets = final && lift.name !== "Bench Press" && lift.name !== "Overhead Press" ? (lastSets.get(lift.name) ?? setsFor(lift, k)) : setsFor(lift, k);
      lastSets.set(lift.name, sets);
      return { lift, exercise: id(lift.name), sets };
    });
    const records = recordsOf(entries, done);
    for (const e of entries) done.set(e.exercise, [...(done.get(e.exercise) ?? []), ...e.sets]);
    const date = new Date(now - daysAgo * DAY);
    date.setHours(i % 2 ? 18 : 7, i % 3 ? 30 : 0, 0, 0);
    await store.insert("session", {
      routine: turn.routine,
      date,
      durationSec: (52 + ((i * 7) % 17)) * 60,
      entries: entries.map(({ exercise, sets }) => ({ exercise, sets })),
      records,
    });
  }
}
