// Reminder reconciliation (issue #18): schedule future reminders, cancel stale ones idempotently,
// and no-op cleanly with no notification cap (web degradation). Driven through the real plants app.

import { beforeEach, describe, expect, it } from "vitest";
import plants from "../../../examples/plants.app.js";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "../src/index.js";

const DAY = 86_400_000;
const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };

async function setup(caps: FakeCapabilities): Promise<{ store: MemoryStore; runtime: PotyroRuntime }> {
  const store = new MemoryStore();
  await store.open("plants");
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: plants });
  const runtime = createRuntime({ app: loaded, host, store, caps, ui, nav });
  return { store, runtime };
}

const plantWith = (over: Record<string, unknown>) => ({
  name: "Fern",
  active: true,
  lastWatered: new Date(),
  wateringIntervalDays: 7,
  seasonalCare: [],
  ...over,
});

describe("reminder reconciliation", () => {
  let caps: FakeCapabilities;
  beforeEach(() => {
    caps = new FakeCapabilities({ notifications: true });
  });

  it("schedules a future reminder with its resolved title", async () => {
    const { store, runtime } = await setup(caps);
    const p = await store.insert("plant", plantWith({ name: "Fern" })); // watered now → due in 7d
    await runtime.reconcileReminders();

    const scheduled = caps.notifications!.scheduled;
    expect([...scheduled.keys()]).toEqual([`water-due:${p.id}`]);
    expect(scheduled.get(`water-due:${p.id}`)!.title).toBe("Water Fern");
  });

  it("does not schedule past-due reminders", async () => {
    const { store, runtime } = await setup(caps);
    await store.insert("plant", plantWith({ lastWatered: new Date(Date.now() - 30 * DAY) })); // overdue
    await runtime.reconcileReminders();
    expect(caps.notifications!.scheduled.size).toBe(0);
  });

  it("cancels a reminder that becomes inactive (idempotent across passes)", async () => {
    const { store, runtime } = await setup(caps);
    const p = await store.insert("plant", plantWith({}));
    await runtime.reconcileReminders();
    expect(caps.notifications!.scheduled.size).toBe(1);

    await store.update("plant", p.id, { active: false }); // when → null
    await runtime.reconcileReminders();
    expect(caps.notifications!.scheduled.size).toBe(0);
  });

  it("cancels a reminder when its record is deleted", async () => {
    const { store, runtime } = await setup(caps);
    const p = await store.insert("plant", plantWith({}));
    await runtime.reconcileReminders();
    await store.delete("plant", p.id);
    await runtime.reconcileReminders();
    expect(caps.notifications!.scheduled.size).toBe(0);
  });

  it("re-scheduling the same set is stable (no duplicates)", async () => {
    const { store, runtime } = await setup(caps);
    await store.insert("plant", plantWith({}));
    await runtime.reconcileReminders();
    await runtime.reconcileReminders();
    expect(caps.notifications!.scheduled.size).toBe(1);
  });

  it("no notification cap → no-op (web degradation to in-app due)", async () => {
    const noNotif = new FakeCapabilities({ notifications: false });
    const { store, runtime } = await setup(noNotif);
    await store.insert("plant", plantWith({}));
    await expect(runtime.reconcileReminders()).resolves.toBeUndefined();
    expect(noNotif.notifications).toBeNull();
  });
});
