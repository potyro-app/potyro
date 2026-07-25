// Keeps scheduled reminders in sync with the data (issue #18). Reconciles once on load and again,
// debounced, whenever an entity that a reminder watches changes — so watering a plant (or editing
// its schedule) re-computes its next notification. Reconciliation itself is idempotent and a no-op
// when there is no notification cap (web today → the app's in-app "due" surface covers it).

import type { KartaRuntime } from "@karta/runtime";
import type { Store } from "@karta/store";

const DEBOUNCE_MS = 300;

/** Start reminder reconciliation. Returns a disposer. No-op when the app declares no reminders. */
export function startReminderSync(runtime: KartaRuntime, store: Store): () => void {
  const reminders = runtime.definition.reminders ?? [];
  if (reminders.length === 0) return () => {};

  const entities = [...new Set(reminders.map((r) => r.entity))];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const reconcile = (): void => {
    void runtime.reconcileReminders();
  };
  const scheduleReconcile = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(reconcile, DEBOUNCE_MS);
  };

  reconcile(); // on load
  const unsubscribers = entities.map((entity) => store.subscribe(entity, scheduleReconcile));

  return () => {
    if (timer) clearTimeout(timer);
    for (const unsub of unsubscribers) unsub();
  };
}
