// Running an app's `migrations` when its version has moved on (docs/06).
//
// This was specified, implemented at both ends — `Store.runMigrations`, the declarative op set in
// `migrate.ts`, `storedSchemaVersion`, the `__appVersion` marker — and never actually CALLED. So
// every app that shipped a migration silently didn't run it: fields renamed in the source kept
// their old names in stored records, and `addField` defaults never appeared.
//
// It surfaced through sync (accepting an updated app must transform the data it already holds), but
// it was never a sync bug. It affects every app on every device.
//
// ## Only the migrations that have not run
//
// The stored `__appVersion` says where this device's data is. The chain is walked from there —
// each migration's `to` becoming the next one's `from` — so a device two versions behind runs both,
// in order, and a device that is current runs none. Matching on `from` rather than comparing
// versions avoids a semver parser and, more importantly, cannot skip a step.

import type { AppDefinition, Migration } from "karta";
import type { Store } from "@karta/store";
// Re-exported: the walk itself lives beside `MigrationPlan` in @karta/store, so the eval harness
// and the shell cannot disagree about which migrations run.
import { migrationChain } from "@karta/store";
export { migrationChain };

const APP_VERSION_KEY = "__appVersion";

/**
 * Bring `store`'s data up to `definition`, if it is behind.
 *
 * Returns what it did, so a caller can report it. Never throws on a no-op.
 */
export async function migrateOnLoad(
  store: Store,
  definition: AppDefinition,
): Promise<{ ran: Migration[]; from: string | null }> {
  const from = await store.kvGet(APP_VERSION_KEY);
  const stored = await store.storedSchemaVersion();
  const chain = migrationChain(definition.migrations ?? [], from);

  if (!chain.length) {
    // Still record where the data now stands, so the NEXT version knows what to migrate from.
    // Without this the marker is only ever written by a migration, and an app that ships its first
    // migration later has no idea which version its existing data came from.
    if (from !== definition.version) await store.kvSet(APP_VERSION_KEY, definition.version);
    return { ran: [], from };
  }

  await store.runMigrations({
    fromAppVersion: from,
    toAppVersion: definition.version,
    fromSchemaVersion: stored,
    toSchemaVersion: definition.schemaVersion,
    migrations: chain,
  });
  return { ran: chain, from };
}
