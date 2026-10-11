// "If my laptop dies I just lost all my apps and data!" — the switch that makes that untrue.
//
// Sync has always been per app, and a person who has not turned it on for anything has nothing on
// the relay: the recovery words restore a name and nothing else. The owner's decision was that this
// is backwards — a new device should bring back EVERY app, not only the ones someone remembered to
// tick.
//
// What "backed up" means, concretely: the app's data lives in a CRDT space (rather than the local
// database) and that space is pushed to the relay, so another device signed in with the same words
// can be pointed at it. That is exactly what turning sync on already does, so this is not a second
// mechanism — it is the same one, applied to everything, and to everything made from here on.
//
// It is OFF until asked for, because nothing in Potyro sends data anywhere until someone says so
// (docs/01). Turning it on is a decision with a size: the apps move one at a time and photos are
// slow, so it reports progress rather than pretending to be instant.

import { listUserApps, setUserAppSync, type UserApp } from "./user-apps.js";
import { toggleAppSync } from "./toggle-sync.js";

export { backupEnabled, setBackupEnabled } from "./backup-setting.js";

export interface EnrolProgress {
  /** 1-based, so it reads as "3 of 7". */
  done: number;
  total: number;
  /** The app being moved right now. */
  name: string;
}

export interface EnrolResult {
  moved: number;
  records: number;
  /** Apps that could not be moved, with the reason — never swallowed, never fatal to the rest. */
  failed: Array<{ name: string; reason: string }>;
  warnings: string[];
}

/** Apps that still live only on this device. Already-synced ones are where they need to be. */
export function localOnlyApps(): UserApp[] {
  return listUserApps().filter((a) => !a.sync);
}

/**
 * Move every local-only app into a space, one at a time.
 *
 * One at a time on purpose: each app's copy is a stream of writes through one storage worker, and
 * running them together would make the slowest one the length of all of them with no way to say
 * what is happening. `onProgress` is what turns a long wait into a legible one.
 *
 * A failure moves on to the next app rather than abandoning the rest. `toggleAppSync` copies before
 * it flips the flag and deletes nothing, so an app that fails here is exactly as it was.
 */
export async function enrolEveryApp(onProgress?: (p: EnrolProgress) => void): Promise<EnrolResult> {
  const apps = localOnlyApps();
  const result: EnrolResult = { moved: 0, records: 0, failed: [], warnings: [] };
  const { inspect } = await import("./app-source.js");

  for (const [index, app] of apps.entries()) {
    onProgress?.({ done: index + 1, total: apps.length, name: app.name });
    try {
      const shape = await inspect(app.source);
      const entities = shape.entities.map((e) => e.key);
      if (entities.length === 0) {
        // Nothing to copy, but it still belongs on the account — an app with no records is still an
        // app you would want back.
        setUserAppSync(app.id, true, new Date().toISOString());
        result.moved += 1;
        continue;
      }
      const { copied, warnings } = await toggleAppSync(app.id, entities, true, new Date().toISOString());
      result.moved += 1;
      result.records += copied.records;
      result.warnings.push(...warnings.map((w) => `${app.name}: ${w}`));
    } catch (e) {
      result.failed.push({ name: app.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  // And tell the account, now rather than at the next boot. "Backed up" has to be true when the
  // switch says so — a device that moved the apps and then waited to be restarted before listing
  // them is one power cut away from having done nothing at all.
  try {
    const { openAccountNodeForDevice, publishAppListToAccount } = await import("./open-store.js");
    const node = await openAccountNodeForDevice();
    if (node) await publishAppListToAccount(node);
  } catch {
    // The apps are in their spaces either way; the next boot publishes them.
  }
  return result;
}

