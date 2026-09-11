// The launcher's order (#84). It used to be a tuple in main.tsx followed by "last edited first",
// so the app you open every morning sat under one you edited once last week. Now: pinned apps
// first, in the order you put them; everything else by frecency — recent AND frequent — unless
// you ask for A–Z or take the order into your own hands.
//
// Pure functions over the launcher store's entries. Nothing here reads a clock or storage: the
// caller passes `now`, which is how the launcher keeps the order still while you are looking at it
// (it passes the time it mounted, not the time of each render).

import type { InstalledApp, LauncherEntry } from "./launcher-store.js";

export type SortMode = "recent" | "az" | "manual";
export const SORT_MODES: readonly { id: SortMode; label: string; title: string }[] = [
  { id: "recent", label: "Recent", title: "What you open often and lately, first" },
  { id: "az", label: "A–Z", title: "By name" },
  { id: "manual", label: "Manual", title: "Your order: drag tiles, or Alt+arrows" },
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Firefox's idea of frecency, on what the store keeps: the number of opens, weighted by how long
 * ago the last one was. An app opened ten times last month scores under one opened twice today.
 */
export function frecency(entry: Pick<LauncherEntry, "openCount" | "lastOpenedAt">, now: number): number {
  const opens = entry.openCount ?? 0;
  if (opens <= 0 || !entry.lastOpenedAt) return 0;
  const age = now - Date.parse(entry.lastOpenedAt);
  if (Number.isNaN(age)) return 0;
  const weight = age <= 4 * HOUR ? 100 : age <= DAY ? 70 : age <= 3 * DAY ? 50 : age <= 7 * DAY ? 30 : age <= 30 * DAY ? 10 : 5;
  return opens * weight;
}

const byName = (a: InstalledApp, b: InstalledApp): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.key.localeCompare(b.key);
const byOrder = (a: InstalledApp, b: InstalledApp): number =>
  (a.entry.order ?? Number.POSITIVE_INFINITY) - (b.entry.order ?? Number.POSITIVE_INFINITY) || byName(a, b);

export interface OrderedApps {
  pinned: InstalledApp[];
  rest: InstalledApp[];
}

/** Pinned apps in their manual order, then the rest in the chosen order. */
export function orderApps(apps: readonly InstalledApp[], mode: SortMode, now: number): OrderedApps {
  const pinned = apps.filter((a) => a.entry.pinned === true).sort(byOrder);
  const rest = apps.filter((a) => a.entry.pinned !== true);
  if (mode === "az") rest.sort(byName);
  else if (mode === "manual") rest.sort(byOrder);
  else rest.sort((a, b) => frecency(b.entry, now) - frecency(a.entry, now) || byName(a, b));
  return { pinned, rest };
}

/** The keys of `list` with `key` moved to index `to` (clamped). Same order back if nothing moves. */
export function moveKey(list: readonly { key: string }[], key: string, to: number): string[] {
  const keys = list.map((a) => a.key);
  const from = keys.indexOf(key);
  if (from < 0) return keys;
  const target = Math.max(0, Math.min(keys.length - 1, to));
  if (target === from) return keys;
  keys.splice(from, 1);
  keys.splice(target, 0, key);
  return keys;
}
