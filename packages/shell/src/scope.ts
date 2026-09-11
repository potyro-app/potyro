// The app-wide selection (`ctx.scope`, #134), remembered per device.
//
// Which trip *you* are looking at is not shared state, so this is `localStorage` under the same
// `karta:<feature>:<appId>` convention as the "seen" watermarks — never `ctx.storage`, whose
// key/value store syncs across a space's devices once the app is synced. The runtime owns the
// value (`runtime.setScope`); this owns remembering it.

import type { KartaRuntime } from "@karta/runtime";

const key = (appId: string): string => `karta:scope:${appId}`;

/** The saved selection's record id, or null. */
export function savedScope(appId: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key(appId)) ?? null;
  } catch {
    return null;
  }
}

export function rememberScope(appId: string, id: string | null): void {
  try {
    if (id) globalThis.localStorage?.setItem(key(appId), id);
    else globalThis.localStorage?.removeItem(key(appId));
  } catch {
    // Remembering is a convenience; the selection itself already took effect.
  }
}

/**
 * Select what this device last selected, before the first render — so a page that filters by
 * `ctx.scope` never flashes everything first. A remembered record that no longer exists (deleted on
 * another device, say) clears the memory rather than pinning the app to nothing.
 */
export async function restoreScope(runtime: KartaRuntime, appId: string): Promise<void> {
  const scope = runtime.definition.scope;
  if (!scope) return;
  const id = savedScope(appId);
  if (!id) return;
  await runtime.setScope(scope.entity, id);
  if (!runtime.scope[scope.entity]) rememberScope(appId, null);
}

/** Select a record and remember it. */
export async function chooseScope(runtime: KartaRuntime, appId: string, id: string | null): Promise<void> {
  const scope = runtime.definition.scope;
  if (!scope) return;
  await runtime.setScope(scope.entity, id);
  rememberScope(appId, runtime.scope[scope.entity] ? id : null);
}
