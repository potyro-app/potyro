// Keeps scheduled reminders in sync with the data (issue #18). Reconciles once on load and again,
// debounced, whenever an entity that a reminder watches changes — so watering a plant (or editing
// its schedule) re-computes its next notification. Reconciliation itself is idempotent and a no-op
// when there is no notification cap (web today → the app's in-app "due" surface covers it).

import type { PotyroRuntime } from "@potyro/runtime";
import type { Store } from "@potyro/store";

const DEBOUNCE_MS = 300;

/** Start reminder reconciliation. Returns a disposer. No-op when the app declares no reminders. */
export function startReminderSync(runtime: PotyroRuntime, store: Store): () => void {
  const reminders = runtime.definition.reminders ?? [];
  if (reminders.length === 0) return () => {};

  const entities = [...new Set(reminders.map((r) => r.entity))];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let alive = true;

  const reconcile = (): void => {
    runtime.reconcileReminders().catch((e: unknown) => {
      // Put away mid-way (its store is closed): nothing left to schedule for.
      if (alive) console.warn("[potyro] could not schedule the app's reminders:", e);
    });
  };
  const scheduleReconcile = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(reconcile, DEBOUNCE_MS);
  };

  reconcile(); // on load
  const unsubscribers = entities.map((entity) => store.subscribe(entity, scheduleReconcile));

  return () => {
    alive = false;
    if (timer) clearTimeout(timer);
    for (const unsub of unsubscribers) unsub();
  };
}

/** At most this many due times are kept per app: a badge counts what is due, not a year of schedule. */
const MAX_DUE = 50;

/**
 * Report when each of the app's reminders falls due (#86): once on load and again, debounced, when a
 * watched entity changes. The launcher stores the times and counts the ones that have come, so a
 * plant that falls due after the app was closed still shows on its tile. Returns a disposer.
 */
export function watchReminderTimes(runtime: PotyroRuntime, store: Store, onTimes: (due: string[]) => void): () => void {
  const reminders = runtime.definition.reminders ?? [];
  if (reminders.length === 0) return () => {};
  const entities = [...new Set(reminders.map((r) => r.entity))];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let alive = true;

  const collect = async (): Promise<void> => {
    const times: number[] = [];
    for (const rem of reminders) {
      if (!alive) return;
      const rows = await runtime.ctx.query(rem.entity);
      for (const row of rows) {
        try {
          const when = await runtime.core.app.reminderWhen(rem.id, row, runtime.ctx);
          if (when && !Number.isNaN(when.getTime())) times.push(when.getTime());
        } catch {
          // One reminder that throws for one record does not hide the others.
        }
      }
    }
    if (!alive) return;
    onTimes(times.sort((a, b) => a - b).slice(0, MAX_DUE).map((t) => new Date(t).toISOString()));
  };
  // The app can be put away while this reads — switching apps closes its store under it, and an
  // uncaught "the database … is not open" was the result, in Firefox on every switch back.
  const run = (): void => {
    collect().catch((e: unknown) => {
      if (alive) console.warn("[potyro] could not work out when the app's reminders fall due:", e);
    });
  };
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  };

  run();
  const unsubscribers = entities.map((entity) => store.subscribe(entity, schedule));
  return () => {
    alive = false;
    if (timer) clearTimeout(timer);
    for (const unsub of unsubscribers) unsub();
  };
}
