// Whether this device keeps every app on the relay — the flag alone, so that everything which needs
// to ask can, without dragging the machinery (or a circular import) behind it.
//
// See `backup-all.ts` for what the setting MEANS and what turning it on does.

const KEY = "potyro:backup:all";

/** Is this device keeping every app on the relay, including the ones made from here on? */
export function backupEnabled(): boolean {
  return globalThis.localStorage?.getItem(KEY) === "on";
}

/**
 * Record the setting.
 *
 * Only ever set to `true` once every app is actually in a space: a device that claims it is backing
 * everything up while one app is still local-only is lying in the one place a lie costs someone
 * their data.
 */
export function setBackupEnabled(on: boolean): void {
  if (on) globalThis.localStorage?.setItem(KEY, "on");
  else globalThis.localStorage?.removeItem(KEY);
}
