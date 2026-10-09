// Live attention counts for synced apps while the home screen is showing (#86, phase 2).
//
// Phase 1 keeps the counts an app had when it was last open, which is exact for reminders and stale
// for everything else: a message that arrives while you look at the home screen showed nothing until
// you opened the app. For a shared list that is the one number the home screen exists to answer.
//
// A synced app's CRDT store can be opened without its runtime. On the home screen this opens the
// stores of the most recently opened synced apps, counts unread chat exactly the way the running app
// does (the same watermark, the same function), recounts when a message arrives, and writes the
// result to the launcher entry — the tile re-renders from there. Leaving the home screen closes
// them. Capped, so thirty synced apps do not open thirty stores.

import { ROOM_THREAD, type Store } from "@potyro/store";
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
      const [{ openStore }, { unreadCount }, { peekIdentity }] = await Promise.all([
        import("./open-store.js"),
        import("./chat-panel.js"),
        import("@potyro/identity"),
      ]);
      if (stopped) return;
      const store = await openStore(`user:${app.id}`, { sync: true });
      if (stopped) {
        await store.close();
        return;
      }
      stores.push(store);
      const me = peekIdentity() ?? undefined;

      let timer: ReturnType<typeof setTimeout> | null = null;
      const count = async (): Promise<void> => {
        // Messages only. Counting edits meant walking up to a hundred activity items per app on
        // every change, to produce a number that went up when someone dragged a row — see
        // `AppSignals`.
        const chat = store.messages
          ? await store.messages(ROOM_THREAD).then((messages) => unreadCount(messages, app.id, ROOM_THREAD, me?.id))
          : 0;
        if (!stopped) recordSignals(appKey("user", app.id), { chat });
      };
      const recount = (): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void count().catch((e: unknown) => console.warn("[potyro] live badge count failed:", e)), DEBOUNCE_MS);
      };
      stops.push(() => {
        if (timer) clearTimeout(timer);
      });
      // Only the chat is watched. Subscribing to every entity existed to recount edits, which meant
      // the home screen did work on every record anyone changed anywhere — to produce a number that
      // has since been removed for saying nothing.
      const unsubChat = store.subscribeMessages?.(ROOM_THREAD, recount);
      if (unsubChat) stops.push(unsubChat);
      recount();
    })().catch((e: unknown) => console.warn(`[potyro] could not watch "${app.name}" for the home screen:`, e));
  }

  return () => {
    stopped = true;
    for (const stop of stops.splice(0)) stop();
    for (const store of stores.splice(0)) void store.close().catch(() => {});
  };
}
