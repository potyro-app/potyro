// Workout 2.0 (routines as records): the first-run program, what the app works out from it, and what
// becomes of a device that still holds v1 records — where the training day was an option on each
// exercise and each session.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import workout from "../../../examples/workout.app.tsx";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import type { NavBridge, UiBridge } from "@potyro/host";
import { compose } from "../src/compose.js";
import { seedIfEmpty } from "../src/seed.js";
import { migrateOnLoad } from "../src/migrate-on-load.js";

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };
// Wednesday 9 September 2026, noon: the seed's "yesterday" is a Tuesday in the same week.
const NOW = new Date(2026, 8, 9, 12, 0, 0);

async function open(seed: (s: MemoryStore) => Promise<void>) {
  const store = new MemoryStore();
  await store.open("workout");
  await seed(store);
  const { runtime } = await compose({ app: workout, provenance: "trusted", store, caps: new FakeCapabilities(), ui, nav });
  return { store, runtime };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("the first-run program", () => {
  it("is PPL in rotation and Upper/Lower resting, and Pull A is next after yesterday's Push A", async () => {
    const { runtime } = await open((s) => seedIfEmpty(s, "workout", undefined, async () => undefined));
    const routines = await runtime.ctx.query("routine");
    expect(routines.map((r) => r.name).sort()).toEqual(["Legs A", "Lower", "Pull A", "Push A", "Upper"]);
    expect(routines.filter((r) => r.active === false).map((r) => r.program)).toEqual(["Upper/Lower", "Upper/Lower"]);
    const tile = await workout.tile!(runtime.ctx);
    expect(tile.title).toBe("Pull A next");
    expect(tile.lines).toEqual(["Last: yesterday", expect.stringMatching(/^Streak: [34] weeks$/)]);
  });

  it("has thirty sessions whose last one broke exactly two records: the two presses went up", async () => {
    const { runtime } = await open((s) => seedIfEmpty(s, "workout", undefined, async () => undefined));
    const { rows } = await runtime.queryPage("history");
    expect(rows).toHaveLength(30);
    const last = [...rows].sort((a, b) => +b.date - +a.date)[0]!;
    expect(last.title).toBe("Push A");
    expect(last.records).toHaveLength(2);
    expect(String(last.prs)).toBe("🏆 Bench Press: 67.5 kg, heaviest yet · 🏆 Overhead Press: 45 kg, heaviest yet");
  });

  it("pictures a record by the kind of lifting it is: pressing, pulling or legs", async () => {
    const { runtime } = await open((s) => seedIfEmpty(s, "workout", undefined, async () => undefined));
    const art = (rows: { name: string; art: string }[], name: string) => rows.find((r) => r.name === name)!.art;
    const exercises = (await runtime.ctx.query("exercise")) as unknown as { name: string; art: string }[];
    expect(art(exercises, "Bench Press")).toBe("art/press.webp");
    expect(art(exercises, "Pull-up")).toBe("art/pull.webp");
    expect(art(exercises, "Squat")).toBe("art/plates.webp");
    const routines = (await runtime.ctx.query("routine")) as unknown as { name: string; art: string }[];
    expect([art(routines, "Push A"), art(routines, "Pull A"), art(routines, "Legs A")]).toEqual(["art/press.webp", "art/pull.webp", "art/plates.webp"]);
    // No page wears a picture: the app sits on its plain ground, and the photos are for the records.
    expect(workout.theme?.background).toBeUndefined();
    expect(workout.pages.filter((p) => p.background)).toEqual([]);
  });

  it("charts each exercise's estimated 1RM, rising", async () => {
    const { runtime } = await open((s) => seedIfEmpty(s, "workout", undefined, async () => undefined));
    const squat = (await runtime.ctx.query("exercise")).find((e) => e.name === "Squat")!;
    const curve = squat.progress as { value: number }[];
    expect(curve).toHaveLength(10);
    expect(curve[curve.length - 1]!.value).toBeGreaterThan(curve[0]!.value);
    expect(squat.best).toMatch(/^\d+(\.5)? kg$/);
  });
});

describe("a device that still holds v1 records", () => {
  // What the v1 seed wrote: the day an option on each exercise and session, no routines, sets with no kind.
  async function v1(store: MemoryStore): Promise<void> {
    const bench = await store.insert("exercise", { name: "Bench Press", day: "push", order: 0, targetSets: 3, repRange: "6–10", bodyweight: false, restSec: 150 });
    const ohp = await store.insert("exercise", { name: "Overhead Press", day: "push", order: 1, targetSets: 3, repRange: "8–12", bodyweight: false, restSec: 120 });
    const squat = await store.insert("exercise", { name: "Squat", day: "legs", order: 0, targetSets: 4, repRange: "5–8", bodyweight: false, restSec: 180 });
    await store.insert("session", { day: "push", date: new Date(2026, 8, 1), durationSec: 3600, entries: [{ exercise: bench.id, sets: [{ kg: 80, reps: 5 }] }, { exercise: ohp.id, sets: [{ kg: 40, reps: 8 }] }] });
    await store.insert("session", { day: "legs", date: new Date(2026, 8, 3), durationSec: 3300, entries: [{ exercise: squat.id, sets: [{ kg: 110, reps: 5 }] }] });
    await store.kvSet("__appVersion", "1.3.0");
  }

  it("migrates: sessions get an empty routine and no records, exercises a step — and the old day stays", async () => {
    const store = new MemoryStore();
    await store.open("workout");
    await v1(store);
    const { ran } = await migrateOnLoad(store, workout);
    expect(ran.map((m) => `${m.from}→${m.to}`)).toEqual(["1.3.0→2.0.0"]);
    const sessions = await store.all("session");
    expect(sessions.every((s) => s.routine === null && Array.isArray(s.records) && s.day)).toBe(true);
    expect((sessions[0]!.entries as { sets: unknown[] }[])[0]!.sets[0]).toEqual({ kg: 80, reps: 5 }); // a set with no kind is a working set
    const exercises = await store.all("exercise");
    expect(exercises.every((e) => e.step === 2.5 && Array.isArray(e.muscles) && e.day)).toBe(true);
  });

  it("reaches 2.0.0 from every 1.x that ever shipped", async () => {
    for (const from of ["1.0.0", "1.1.0", "1.1.1", "1.2.0"]) {
      const store = new MemoryStore();
      await store.open(`workout-${from}`);
      await store.kvSet("__appVersion", from);
      const { ran } = await migrateOnLoad(store, workout);
      expect(ran.map((m) => m.to)).toEqual(["1.3.0", "2.0.0"]);
    }
  });

  it("still reads before any routine exists: sessions say their day, exercises their best", async () => {
    const { runtime } = await open(async (s) => {
      await v1(s);
      await migrateOnLoad(s, workout);
    });
    const { rows } = await runtime.queryPage("history");
    expect(rows.map((r) => r.title).sort()).toEqual(["Legs", "Push"]);
    const squat = (await runtime.ctx.query("exercise")).find((e) => e.name === "Squat")!;
    expect(squat.lastBest).toMatchObject({ kg: 110, reps: 5 });
    // No routine yet, so nothing to suggest — the tile says when, not what.
    const tile = await workout.tile!(runtime.ctx);
    expect(tile.title).toBe("");
    expect(tile.lines?.[0]).toMatch(/^Last: /);
  });
});
