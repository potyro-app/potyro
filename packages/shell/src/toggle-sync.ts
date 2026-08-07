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

import { copyStoreData, type CopyStoreResult } from "@karta/store";
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
): Promise<ToggleSyncResult> {
  const namespace = `user:${appId}`;
  const from = await openStore(namespace, { sync: !sync });
  const to = await openStore(namespace, { sync });

  const copied = await copyStoreData(from, to, { entities });

  const warnings: string[] = [];
  if (copied.skippedBlobs.length) {
    warnings.push(
      `${copied.skippedBlobs.length} media file(s) could not be moved: ${copied.skippedBlobs[0]!.reason}.`,
    );
  }

  // Only now — the app's data is already where the new setting will look for it.
  setUserAppSync(appId, sync, now);
  await from.close();
  return { copied, warnings };
}
