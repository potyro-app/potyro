// @vitest-environment happy-dom
// A device that used Workout 1.x opens the Train screen of 2.0 for the first time. Its exercises and
// sessions carry the training day as an option ("push"); 2.0 keeps routines as records. A migration
// works one record at a time and cannot make new ones, so the Train screen makes them: one routine per
// day that has exercises, in their old order, and every old session pointed at its day's routine —
// then opens on what comes next. Only once: a second open finds routines and leaves them be.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import workout from "../../../examples/workout.app.tsx";
import type { ViewProps } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { compose } from "../src/compose.js";
import { migrateOnLoad } from "../src/migrate-on-load.js";

afterEach(cleanup);

const ui = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };

async function v1Store(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.open("workout");
  const ex = (name: string, day: string, order: number) => store.insert("exercise", { name, day, order, targetSets: 3, repRange: "8–12", bodyweight: false, restSec: 90 });
  const bench = await ex("Bench Press", "push", 0);
  const ohp = await ex("Overhead Press", "push", 1);
  const row = await ex("Barbell Row", "pull", 0);
  await ex("Squat", "legs", 0);
  await store.insert("session", { day: "push", date: new Date(Date.now() - 3 * 86_400_000), entries: [{ exercise: bench.id, sets: [{ kg: 80, reps: 5 }] }, { exercise: ohp.id, sets: [{ kg: 40, reps: 8 }] }] });
  await store.insert("session", { day: "pull", date: new Date(Date.now() - 86_400_000), entries: [{ exercise: row.id, sets: [{ kg: 60, reps: 8 }] }] });
  await store.kvSet("__appVersion", "1.3.0");
  await migrateOnLoad(store, workout);
  return store;
}

describe("Workout 2.0's Train screen on v1 data", () => {
  it("turns the old training days into routines, links the old sessions, and offers the next one", async () => {
    const store = await v1Store();
    const { runtime } = await compose({ app: workout, provenance: "trusted", store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} } });
    const train = workout.pages.find((p) => p.id === "train")!.view as { render: (p: ViewProps) => JSX.Element };
    const props: ViewProps = { runtime, entity: "session", options: {}, navigate: () => {} };
    const { container } = render(train.render(props));

    // Push, then Pull, were the last two: Legs is next.
    await waitFor(() => expect(container.querySelector(".wk-huge")?.textContent).toBe("Legs"), { timeout: 10_000 });
    const routines = await store.all("routine");
    expect(routines.map((r) => r.name).sort()).toEqual(["Legs", "Pull", "Push"]);
    const push = routines.find((r) => r.name === "Push")!;
    expect((push.exercises as { exercise: string }[]).length).toBe(2);
    const sessions = await store.all("session");
    expect(sessions.every((s) => typeof s.routine === "string" && s.routine)).toBe(true);

    // A second open makes nothing new.
    cleanup();
    const again = render(train.render(props));
    await waitFor(() => expect(again.container.querySelector(".wk-huge")?.textContent).toBe("Legs"), { timeout: 10_000 });
    expect(await store.all("routine")).toHaveLength(3);
  });
});
