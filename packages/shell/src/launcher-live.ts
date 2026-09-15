// Live attention counts for synced apps while the home screen is showing (#86, phase 2).
//
// Phase 1 keeps the counts an app had when it was last open, which is exact for reminders and stale
// for everything else: a message that arrives while you look at the home screen showed nothing until
// you opened the app. For a shared list that is the one number the home screen exists to answer.
//
// A synced app's CRDT store can be opened without its runtime. On the home screen this opens the
// stores of the most recently opened synced apps, counts unread chat and unseen changes exactly the
// way the running app does (the same watermarks, the same functions), recounts on every change, and
// writes the result to the launcher entry — the tile re-renders from there. Leaving the home screen
// closes them. Capped, so thirty synced apps do not open thirty stores.

import { activitySince, activitySupported } from "@karta/runtime";
import { ROOM_THREAD, type Store } from "@karta/store";
import type { AppDefinition } from "karta";
import { appKey, recordSignals, type InstalledApp } from "./launcher-store.js";

/** How many synced apps are watched at once: the most recently opened. */
export const LIVE_CAP = 10;
const DEBOUNCE_MS = 400;

export function liveCandidates(apps: readonly InstalledApp[]): InstalledApp[] {
  return apps
    .filter((a) => a.sync && a.entry.openCount)
    .sort((a, b) => (b.entry.lastOpenedAt ?? "").localeCompare(a.entry.lastOpenedAt ?? ""))
    .slice(0, LIVE_CAP);
}

/** Start watching `apps` (already capped). Returns a stop that unsubscribes and closes every store. */
export function watchLiveSignals(apps: readonly InstalledApp[]): () => void {
  let stopped = false;
  const stops: Array<() => void> = [];
  const stores: Store[] = [];

  for (const app of apps) {
    void (async () => {
      const [{ openStore }, { inspect }, { lastSeen }, { unreadCount }, { peekIdentity }] = await Promise.all([
        import("./open-store.js"),
        import("./app-source.js"),
        import("./activity-panel.js"),
        import("./chat-panel.js"),
        import("@karta/identity"),
      ]);
      if (stopped) return;
      const store = await openStore(`user:${app.id}`, { sync: true });
      if (stopped) {
        await store.close();
        return;
      }
      stores.push(store);
      const shape = await inspect(app.user.source);
      // Entity names are all the count needs; labels only word the feed, which is not shown here.
      const definition = { entities: Object.fromEntries(shape.entities.map((e) => [e.key, { fields: {} }])) } as unknown as AppDefinition;
      const me = peekIdentity() ?? undefined;

      let timer: ReturnType<typeof setTimeout> | null = null;
      const count = async (): Promise<void> => {
        const [changes, chat] = await Promise.all([
          activitySupported(store) ? activitySince({ store, definition, me }, lastSeen(app.id), { limit: 100 }).then((items) => items.length) : Promise.resolve(0),
          store.messages ? store.messages(ROOM_THREAD).then((messages) => unreadCount(messages, app.id, ROOM_THREAD, me?.id)) : Promise.resolve(0),
        ]);
        if (!stopped) recordSignals(appKey("user", app.id), { changes, chat });
      };
      const recount = (): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void count().catch((e: unknown) => console.warn("[karta] live badge count failed:", e)), DEBOUNCE_MS);
      };
      stops.push(() => {
        if (timer) clearTimeout(timer);
      });
      for (const entity of Object.keys(definition.entities)) stops.push(store.subscribe(entity, recount));
      const unsubChat = store.subscribeMessages?.(ROOM_THREAD, recount);
      if (unsubChat) stops.push(unsubChat);
      recount();
    })().catch((e: unknown) => console.warn(`[karta] could not watch "${app.name}" for the home screen:`, e));
  }

  return () => {
    stopped = true;
    for (const stop of stops.splice(0)) stop();
    for (const store of stores.splice(0)) void store.close().catch(() => {});
  };
}
