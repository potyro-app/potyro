// Is Ask (#213) offered in this app, on this device?
//
// On until the person turns it off. Their choice, not the app's builder's, and per device — a
// device-level preference like the "seen" watermarks, so `localStorage` under the
// `karta:<feature>:<appId>` convention, never `ctx.storage` (which syncs across a space).

import { useSyncExternalStore } from "react";

const key = (appId: string): string => `karta:ask-off:${appId}`;
const listeners = new Set<() => void>();

export function askEnabled(appId: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key(appId)) !== "1";
  } catch {
    return true;
  }
}

export function setAskEnabled(appId: string, on: boolean): void {
  try {
    if (on) globalThis.localStorage?.removeItem(key(appId));
    else globalThis.localStorage?.setItem(key(appId), "1");
  } catch {
    // Storage refused: the choice lasts until the page goes, which is still the person's choice.
  }
  for (const l of listeners) l();
}

/** `askEnabled`, live: the menu entry goes the moment Ask is turned off. */
export function useAskEnabled(appId: string | undefined): boolean {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => (appId ? askEnabled(appId) : false),
  );
}
