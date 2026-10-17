// An app put away while its reminders are being read: switching apps closes its store under the
// read, which rejected with `the database "…" is not open` — uncaught, in Firefox on every switch back
// to a sealed app. Now the read just stops.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PotyroRuntime } from "@potyro/runtime";
import type { Store } from "@potyro/store";
import { startReminderSync, watchReminderTimes } from "../src/reminder-sync.js";

const closed = (): Promise<never> => new Promise((_, reject) => setTimeout(() => reject(new Error('the database "user-plants" is not open')), 5));

function putAwayApp(): { runtime: PotyroRuntime; store: Store } {
  const runtime = {
    definition: { reminders: [{ id: "water", entity: "plant" }] },
    ctx: { query: closed },
    core: { app: { reminderWhen: async () => null } },
    reconcileReminders: closed,
  } as unknown as PotyroRuntime;
  const store = { subscribe: () => () => {} } as unknown as Store;
  return { runtime, store };
}

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown): void => void unhandled.push(e);

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  unhandled.length = 0;
  vi.restoreAllMocks();
});

describe("reminders of an app that was put away", () => {
  it("stop reading quietly once the app is put away, and still say so when it was not", async () => {
    process.on("unhandledRejection", onUnhandled);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, store } = putAwayApp();

    const times: string[][] = [];
    const stopTimes = watchReminderTimes(runtime, store, (due) => void times.push(due));
    const stopSync = startReminderSync(runtime, store);
    stopTimes();
    stopSync();
    await new Promise((r) => setTimeout(r, 30));
    expect(unhandled).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(times).toEqual([]);

    // Still open when it failed: a warning, never an uncaught error.
    const live = putAwayApp();
    const stop = watchReminderTimes(live.runtime, live.store, () => {});
    await new Promise((r) => setTimeout(r, 30));
    expect(unhandled).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    stop();
  });
});
