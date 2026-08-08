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

const APP_VERSION_KEY = "__appVersion";

/** The migrations still to run, in order, starting from the version the data was written under. */
export function migrationChain(migrations: readonly Migration[], from: string | null): Migration[] {
  if (!from) return []; // fresh data: written by the current version already
  const chain: Migration[] = [];
  const seen = new Set<string>();
  let at = from;
  for (;;) {
    const next = migrations.find((m) => m.from === at);
    // `seen` guards a definition whose migrations loop (1.0 -> 1.1 -> 1.0); without it this spins
    // forever on app open, which is a far worse failure than an un-migrated field.
    if (!next || seen.has(next.to)) break;
    chain.push(next);
    seen.add(next.to);
    at = next.to;
  }
  return chain;
}

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
