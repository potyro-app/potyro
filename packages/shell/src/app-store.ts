// Which store an app's data is in, opened the way the app itself opens it.
//
// Two surfaces open an app's store: the app, and the Data panel. They must agree on BOTH decisions
// below, or the panel shows a different app from the one you use — an empty table for an example
// that has never been opened, or the local store of an app whose records are in its shared space.

import { openStore } from "./open-store.js";
import { seedIfEmpty } from "./seed.js";
import type { Store } from "@karta/store";
import type { UserApp } from "./user-apps.js";

/**
 * Whether this app's SYNCED store may be opened (KA-23).
 *
 * An app someone else wrote may only reach its shared space once this device has agreed to that.
 * Denied, or never asked — an imported app whose `sync` flag came in a bundle — it is local-only:
 * that is what the permission means.
 */
export async function syncAllowedFor(app: UserApp): Promise<boolean> {
  if (!app.sync) return false;
  if (app.trusted) return true;
  const { syncConsented } = await import("./sync-consent.js");
  return syncConsented(app.id);
}

/**
 * Open the app's store and give an empty one its first-run rows.
 *
 * Never seeds a space that came from somewhere else. The seeders are keyed on the app id, so a guest
 * who joined a shared "split" ran `seedSplit` against the space they had just joined — and a space
 * whose records have not replicated yet is indistinguishable from an empty one. The result was a
 * second "Flat" group inside the owner's app, with both people writing to one space and each seeing
 * only their own rows (Split scopes its views by the selected group).
 */
export async function openAppStore(app: UserApp, opts: { sync: boolean; me?: string }): Promise<Store> {
  const store = await openStore(`user:${app.id}`, { sync: opts.sync });
  if (!app.joined) await seedOnce(app.id, () => seedIfEmpty(store, app.id, opts.me));
  return store;
}

/**
 * One seeding per app at a time.
 *
 * "If empty" is a read followed by writes, so two opens that overlap — the panel and the app, or the
 * panel mounted twice by React's strict mode — both find the store empty and both write the example
 * rows. A later open waits for the running one and then checks again, finding it full.
 */
const seeding = new Map<string, Promise<void>>();
async function seedOnce(appId: string, seed: () => Promise<void>): Promise<void> {
  const before = seeding.get(appId) ?? Promise.resolve();
  const mine = before.then(seed, seed);
  seeding.set(appId, mine.catch(() => {}));
  await mine;
}
