// The version gate for a shared app (KA-22, #63).
//
// Everyone in a space runs their OWN copy of the app against ONE shared document. When those copies
// disagree about the shape of the data, the older one is a hazard: every record it writes lands in
// a shape the newer copy does not expect, and every peer replicates it. So:
//
//   - a copy older than the schema the space is published at goes READ-ONLY — on open, and also the
//     moment a newer version is published while it is open (it used to be only on open, which left
//     an old copy writing old-shape records for as long as it stayed on screen);
//   - changing the shared data to a new shape is ASKED, not done as a side effect of opening: the
//     person with the new version is told who else is affected, and "not now" leaves the app
//     read-only rather than half-migrated;
//   - an older copy never writes its version marker over a newer one's, and never publishes itself.
//
// The store half is `guardedStore` reading `AppLock`; this file decides when the lock is set.

import { plural, t } from "@lingui/core/macro";
import type { AppDefinition } from "potyro";
import type { Store } from "@potyro/store";
import type { AppLock } from "./app-lock.js";
import type { PublishedApp } from "./app-sync.js";
import type { UserApp } from "./user-apps.js";
import { shellDialogs } from "./dialog.js";

interface Toast {
  push(message: string): void;
}

/** Install a published version as this device's copy, and open it. */
async function takeUpdate(id: string, update: PublishedApp): Promise<void> {
  const [{ saveUserApp }, { receiveCode }] = await Promise.all([import("./user-apps.js"), import("./app-modules.js")]);
  // Its own modules came with it, checked against its lock before anything is saved; its libraries
  // are fetched when it opens, with consent (#281).
  await receiveCode(id, update);
  await saveUserApp(
    {
      id,
      name: update.name,
      source: update.source,
      ...(update.lock ? { lock: update.lock } : {}),
      origin: "imported",
      // What they asked for, when they published it. The bare "updated by a collaborator" is the
      // fallback for a copy published before notes travelled, not the normal case.
      note: update.note ? `${update.note} — from a collaborator` : "updated by a collaborator",
      ...(update.rationale ? { rationale: update.rationale } : {}),
    },
    new Date().toISOString(),
  );
  location.reload();
}

/** Said at the moment it is shown (a function, not a constant: the language may have changed since this module loaded). */
const newerDetail = (): string => t`Update to keep making changes. Until you do, it stays open read-only, so your older copy can’t damage the shared data.`;

export interface GateResult {
  /** False when the user took an update and the page is reloading into it. */
  proceed: boolean;
  /**
   * Whether this copy may record its version as the data's. False when a newer copy exists: an
   * older one writing its version over a newer one's makes the newer copy re-run its migrations.
   */
  recordVersion: boolean;
  /** Settles once this copy's source is published (or was not ours to publish). */
  published: Promise<unknown>;
  /** Stop watching the space for newer versions. */
  stop: () => void;
}

/**
 * Decide, as a synced app opens, whether this copy may write — and keep deciding while it is open.
 *
 * `rawStore` is the unguarded store: the gate reads the published app through it and must be able
 * to publish while nothing is locked.
 */
export async function openVersionGate(opts: {
  id: string;
  saved: UserApp;
  rawStore: Store;
  lock: AppLock;
  canWrite: boolean;
}): Promise<GateResult> {
  const { id, saved, rawStore, lock, canWrite } = opts;
  const appSync = await import("./app-sync.js");
  // The newest version's own record of WHY this source looks like this, so it travels with it.
  // Read from history rather than kept on `UserApp`: history is already the one place that answers
  // "what was asked for", and duplicating it onto the app record would give it two answers to
  // disagree about.
  const { listVersions } = await import("./app-history.js");
  const latest = (await listVersions(id))[0];
  const { codeToCarry } = await import("./app-modules.js");
  const mine: PublishedApp = {
    // Its code beyond the source travels with it (#281): the lock, and its own modules as text.
    ...(await codeToCarry(saved, rawStore)),
    source: saved.source,
    name: saved.name,
    updatedAt: saved.updatedAt,
    schemaVersion: appSync.schemaVersionOf(saved.source),
    // Only when they describe THIS source. A stale note from an older version would be worse than
    // none: it would explain a change that is not the one you are looking at.
    ...(latest?.source === saved.source ? { note: latest.note, rationale: latest.rationale } : {}),
  };

  const lockBehind = (published: PublishedApp): void =>
    lock.set({ kind: "version", resolve: () => takeUpdate(id, published) });

  const published = await appSync.readPublishedApp(rawStore);
  const update = await appSync.pendingAppUpdate(rawStore, mine);
  // A newer SCHEMA is not merely a nicer version — writing with the old one puts records into the
  // shared document in a shape the current app does not expect, and every peer replicates them.
  const behind = appSync.isSchemaBehind(mine, published);

  if (update) {
    const name = update.name;
    const ok = t({ message: "Update", comment: "Button: take the newer version of a shared app" });
    const take = await shellDialogs.confirm(
      behind ? t`“${name}” has been updated to a newer version.` : t`“${name}” was updated by someone you share it with.`,
      behind
        ? { detail: newerDetail(), ok, cancel: t`Not now` }
        : { detail: t`Update your copy? Your version is kept in History, so you can go back.`, ok, cancel: t`Not now` },
    );
    if (take) {
      await takeUpdate(id, update);
      return { proceed: false, recordVersion: false, published: Promise.resolve(), stop: () => {} };
    }
  }
  // Behind locks whether or not an update was offered. Offering depends on `updatedAt`, which is a
  // device clock; the schema number is not, and it is the one that decides whether writing is safe.
  if (behind && published) lockBehind(published);

  // Only publishes when this copy is strictly newer, so declining an update above does not push the
  // older source back over the newer one — and a copy that is behind never publishes at all.
  const publishing = !behind && !update && canWrite ? appSync.publishAppSource(rawStore, mine).catch(() => false) : Promise.resolve(false);

  // Live: a newer version published while this copy is open locks it NOW, and asks.
  let seen = published?.updatedAt;
  let asking = false;
  const check = async (): Promise<void> => {
    const now = await appSync.readPublishedApp(rawStore);
    if (!now || now.updatedAt === seen) return;
    seen = now.updatedAt;
    if (!appSync.isSchemaBehind(mine, now) || lock.get()?.kind === "version" || asking) return;
    lockBehind(now);
    asking = true;
    try {
      const name = now.name;
      const take = await shellDialogs.confirm(t`“${name}” was just updated to a newer version.`, {
        detail: newerDetail(),
        ok: t({ message: "Update", comment: "Button: take the newer version of a shared app" }),
        cancel: t`Not now`,
      });
      if (take) await takeUpdate(id, now);
    } finally {
      asking = false;
    }
  };
  const stop = rawStore.subscribeKv?.(() => void check().catch(() => {})) ?? (() => {});

  return { proceed: true, recordVersion: !update, published: publishing, stop };
}

/**
 * Bring the data up to this app's version — asking first when other people share it.
 *
 * Runs against `rawStore` directly: this IS the sanctioned write that the lock exists to hold back
 * until someone says yes.
 */
export async function migrateShared(opts: {
  definition: AppDefinition;
  rawStore: Store;
  lock: AppLock;
  gate: GateResult;
  canWrite: boolean;
  /** Everyone else in the space, by name. */
  others: string[];
  toast: Toast;
  refresh: () => void;
}): Promise<void> {
  const { definition, rawStore, lock, gate, canWrite, others, toast, refresh } = opts;
  // A viewer cannot change the data, and an older copy must not.
  if (!canWrite || lock.get()) return;

  const { pendingMigrations, migrateOnLoad } = await import("./migrate-on-load.js");
  const { chain, behind } = await pendingMigrations(rawStore, definition);
  if (behind) {
    // The data is already in a newer shape than this copy knows — someone migrated it with a newer
    // version that is not (yet) published to us. Nothing to take, but writing would still corrupt.
    lock.set({ kind: "version", resolve: async () => location.reload() });
    return;
  }

  const run = async (): Promise<void> => {
    // Publish first, so every other copy locks BEFORE it can see a record in the new shape.
    await gate.published;
    try {
      const { ran, from } = await migrateOnLoad(rawStore, definition, { recordVersion: gate.recordVersion });
      if (ran.length) {
        const to = definition.version;
        const was = from ?? "";
        toast.push(t`Updated your data from ${was} to ${to}.`);
      }
      lock.set(null);
      refresh();
    } catch (e) {
      // `runMigrations` computes every change before it writes the first one, so a migration that
      // throws leaves the data as it was. Stay read-only rather than let a new-version app write
      // into data that is still in the old shape.
      console.warn("[potyro] migration failed:", e);
      const why = e instanceof Error ? e.message : String(e);
      toast.push(t`Could not update your data: ${why}`);
      lock.set({ kind: "data", resolve: run });
    }
  };

  if (!chain.length || others.length === 0) return run();

  const first = others[0]!;
  const who = others.length === 1 ? first : plural(others.length - 1, { one: `${first} and # other person`, other: `${first} and # other people` });
  const name = definition.name;
  const yes = await shellDialogs.confirm(t`This version changes how “${name}” stores its data.`, {
    detail: t`Update the shared data now? ${who} will need to update their copy too — until they do, it opens read-only for them. Your previous version stays in History.`,
    ok: t`Update data`,
    cancel: t`Not now`,
  });
  if (yes) return run();
  lock.set({ kind: "data", resolve: run });
}
