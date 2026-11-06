// Turning sync on or off for one app — and moving its data across.
//
// The two stores keep their data in DIFFERENT files, so flipping the flag alone would open the app
// empty. That is indistinguishable from data loss, so the flag and the copy are one operation and
// this module is the only place allowed to do it.
//
// Order matters: copy FIRST, flip the flag only once the copy succeeded. Flipping first and then
// failing to copy would leave the app pointed at an empty store with its data stranded in a file
// nothing opens any more. Nothing is deleted from the old store either — a migration that turns
// out to be wrong must be reversible by flipping back.

import { plural } from "@lingui/core/macro";
import { copyStoreData, isReservedPath, type CopyStoreResult, type Store, type StoreSchema } from "@potyro/store";
import type { AppDefinition } from "potyro";
import { openStore } from "./open-store.js";
import { setUserAppSync } from "./user-apps.js";

export interface ToggleSyncResult {
  copied: CopyStoreResult;
  /** Media that could not be moved. Non-empty means the caller must tell the user. */
  warnings: string[];
}

/**
 * Move an app between the local store and the CRDT store, then record the new setting.
 *
 * `entities` must come from the app itself — the `Store` interface cannot enumerate them, and a
 * hand-written list would silently copy an incomplete app. Callers derive it from the source via
 * `inspect()` (no evaluation needed) or from a loaded definition.
 */
export async function toggleAppSync(
  appId: string,
  entities: readonly string[],
  sync: boolean,
  now: string,
  /** The app's source: with it, the synced store learns the app's fields before the copy (below). */
  source?: string,
): Promise<ToggleSyncResult> {
  const namespace = `user:${appId}`;
  const from = await openStore(namespace, { sync: !sync });
  const to = await openStore(namespace, { sync });
  if (sync && source) await describeTo(to, appId, source);

  // The app's code (`.modules/`, `.src/`) stays where it is: in the local store, which is where this
  // device keeps it whether or not the app syncs (#281). Copied into the space, a library's bytes —
  // megabytes, for p5 — would ride to the relay and every member, who fetch their own copy anyway.
  const copied = await copyStoreData(from, to, { entities, ...(sync ? { skipFile: isReservedPath } : {}) });

  const warnings: string[] = [];
  if (copied.skippedBlobs.length) {
    const reason = copied.skippedBlobs[0]!.reason;
    warnings.push(
      plural(copied.skippedBlobs.length, {
        one: `# media file could not be moved: ${reason}.`,
        other: `# media files could not be moved: ${reason}.`,
      }),
    );
  }

  // Only now — the app's data is already where the new setting will look for it.
  setUserAppSync(appId, sync, now);
  await from.close();
  return { copied, warnings };
}

/**
 * Tell the synced store what the app declared BEFORE its records are copied in.
 *
 * A `text` field with `collaborative: true` lives in a text CoValue of its own (docs/04 "Writing
 * together"); a store that has not been told which fields those are copies the words in as plain
 * strings, and the first two people to type then each make a text CoValue for the same field at
 * once — one of them loses. Made here, once, by the device that shares, there is nothing to race.
 * The definition is read in the sealed box, as Add an app reads it (#253); a source that cannot be
 * read leaves the store undescribed, which still works, one lost first keystroke aside.
 */
async function describeTo(to: Store, appId: string, source: string): Promise<void> {
  if (!to.describe) return;
  try {
    const [{ inspectSource }, { modulesOf }] = await Promise.all([import("./validate-app.js"), import("./app-modules.js")]);
    const def = (await inspectSource(source, await modulesOf(appId))).definition as Partial<AppDefinition> | null | undefined;
    const entities = def?.entities;
    if (!entities || typeof entities !== "object") return;
    const schema: StoreSchema = Object.fromEntries(Object.entries(entities).map(([entity, e]) => [entity, e?.fields ?? {}]));
    const creatorOnly = Object.entries(entities)
      .filter(([, e]) => e?.editableBy === "creator")
      .map(([entity]) => entity);
    const sharedRecords = Object.entries(entities)
      .filter(([, e]) => e?.share === "record")
      .map(([entity]) => entity);
    to.describe(schema, { creatorOnly, sharedRecords });
  } catch (e) {
    console.warn("[potyro] the synced store was not told the app's fields before the copy:", e);
  }
}
