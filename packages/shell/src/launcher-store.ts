// The launcher's own data (#81): one installed-app list, and a per-device record per app of what
// this device knows about it — when it was opened and how often, whether it is pinned, what the
// user wants it called. The launcher used to render two unrelated lists (a hardcoded tuple of
// built-ins and `listUserApps()`, sorted by last EDIT) and could show nothing about an app beyond
// `trusted` and `sync`. Ordering (#84), badges (#86), identity (#82, #83) and search (#85) all need
// this record; without it each would have grown its own localStorage key.
//
// Per-device on purpose: pins and recents are about THIS phone. Syncing them is a later question.
//
// Storage: one localStorage key, a map from app key to entry, immutable updates, read tolerant of
// garbage the way `user-apps.ts` is. Every write announces itself as a DOM event, and so does the
// user-apps registry, so a launcher on screen re-renders on a change made anywhere — the class of
// bug in #78 (a list read once) cannot come back.

import { useEffect, useSyncExternalStore } from "react";
import { USER_APPS_CHANGED, listUserApps, type UserApp } from "./user-apps.js";
import { inspect } from "./app-source.js";

/** The bundled example apps, in launcher order. */
export const BUILTIN_APPS = ["recipes", "plants", "places", "workout"] as const;
export type BuiltinId = (typeof BUILTIN_APPS)[number];

export type AppKind = "builtin" | "user";
/** Stable key for an installed app: `builtin:recipes`, `user:groceries`. */
export type AppKey = `${AppKind}:${string}`;
export const appKey = (kind: AppKind, id: string): AppKey => `${kind}:${id}`;

export interface LauncherEntry {
  key: AppKey;
  /** User override; falls back to the app's declared name. */
  displayName?: string;
  /** User override; falls back to the app's declared icon. */
  icon?: string;
  pinned?: boolean;
  /** Manual position among pinned. */
  order?: number;
  lastOpenedAt?: string; // ISO
  openCount?: number;
  /** What the app declares about itself, read from its source without running it (#82), cached
   *  against a hash of that source so it is read once per version. */
  identity?: AppIdentity;
}

export interface AppIdentity {
  hash: string;
  name?: string;
  icon?: string;
  accent?: string;
}

/** One row of the launcher: what the app is, joined with what this device knows about it. */
export type InstalledApp = {
  key: AppKey;
  id: string;
  /** What the tile says. The user's override, else the app's declared name, else its record's. */
  name: string;
  /** Declared for the tile (#82); absent until the source has been read, or when it declares none. */
  icon?: string;
  accent?: string;
  trusted: boolean;
  sync: boolean;
  entry: LauncherEntry;
} & ({ kind: "builtin"; user?: undefined } | { kind: "user"; user: UserApp });

// The example apps' sources, for their identity: loaded lazily, as text, only when a launcher needs
// to read one — never evaluated here.
const EXAMPLE_SOURCES = import.meta.glob("../../../examples/*.app.ts", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

async function sourceOf(app: InstalledApp): Promise<string | undefined> {
  if (app.kind === "user") return app.user.source;
  return EXAMPLE_SOURCES[`../../../examples/${app.id}.app.ts`]?.();
}

/** FNV-1a over the source: short, stable, and enough to notice a different version. */
export function sourceHash(source: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

const reading = new Set<string>();

/**
 * Read the declared identity of every app whose cached one is missing or stale, and store it.
 * Each store write re-renders any launcher on screen, so tiles fill in as sources are read.
 */
export async function ensureIdentities(apps: readonly InstalledApp[]): Promise<void> {
  await Promise.all(
    apps.map(async (app) => {
      if (reading.has(app.key)) return;
      // A user app's hash is known up front; a built-in's needs its source first. Either way the
      // cached identity is used when its hash matches.
      const known = app.kind === "user" ? sourceHash(app.user.source) : undefined;
      if (known && app.entry.identity?.hash === known) return;
      reading.add(app.key);
      try {
        const source = await sourceOf(app);
        if (source === undefined) return;
        const hash = known ?? sourceHash(source);
        if (getEntry(app.key).identity?.hash === hash) return;
        const shape = await inspect(source);
        const identity: AppIdentity = { hash, ...(shape.name ? { name: shape.name } : {}), ...(shape.icon ? { icon: shape.icon } : {}), ...(shape.accent ? { accent: shape.accent } : {}) };
        updateEntry(app.key, { identity });
      } finally {
        reading.delete(app.key);
      }
    }),
  );
}

const KEY = "karta:launcher";
const CHANGED = "karta:launcher:changed";

type Entries = Readonly<Record<string, LauncherEntry>>;

const isKey = (k: unknown): k is AppKey => typeof k === "string" && /^(builtin|user):.+/.test(k);

function read(): Entries {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, LauncherEntry> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isKey(k) || !v || typeof v !== "object") continue;
      out[k] = { ...(v as LauncherEntry), key: k };
    }
    return out;
  } catch {
    return {};
  }
}

function announce(name: string): void {
  if (typeof globalThis.dispatchEvent === "function" && typeof Event === "function") globalThis.dispatchEvent(new Event(name));
}

function write(entries: Entries): void {
  globalThis.localStorage?.setItem(KEY, JSON.stringify(entries));
  announce(CHANGED);
}

export function getEntry(key: AppKey): LauncherEntry {
  return read()[key] ?? { key };
}

/** Merge `patch` into the app's entry. A field set to `undefined` is removed. */
export function updateEntry(key: AppKey, patch: Partial<Omit<LauncherEntry, "key">>): LauncherEntry {
  const next: LauncherEntry = { ...getEntry(key), ...patch, key };
  for (const k of Object.keys(next) as (keyof LauncherEntry)[]) if (next[k] === undefined) delete next[k];
  write({ ...read(), [key]: next });
  return next;
}

/** An app was opened — from a tile, a deep link or a reload alike, so this is called from boot. */
export function recordOpen(key: AppKey, now: string): LauncherEntry {
  const prev = getEntry(key);
  return updateEntry(key, { lastOpenedAt: now, openCount: (prev.openCount ?? 0) + 1 });
}

/** Give `keys` positions 0…n in one write (a pinned row, or the manual order of the rest). */
export function setOrder(keys: readonly AppKey[]): void {
  const entries = read();
  const next: Record<string, LauncherEntry> = { ...entries };
  keys.forEach((key, i) => {
    next[key] = { ...(entries[key] ?? { key }), order: i };
  });
  write(next);
}

/** Pin puts an app at the end of the pinned row; unpin drops it back among the rest. */
export function setPinned(key: AppKey, pinned: boolean): void {
  const entries = read();
  const last = Math.max(-1, ...Object.values(entries).filter((e) => e.pinned).map((e) => e.order ?? -1));
  updateEntry(key, pinned ? { pinned: true, order: last + 1 } : { pinned: undefined, order: undefined });
}

const SORT_KEY = "karta:launcher:sort";
const SORT_MODES = new Set(["recent", "az", "manual"]);

/** How the unpinned apps are ordered on this device. `recent` (frecency) unless chosen otherwise. */
export function getSortMode(): "recent" | "az" | "manual" {
  const raw = globalThis.localStorage?.getItem(SORT_KEY);
  return raw && SORT_MODES.has(raw) ? (raw as "recent" | "az" | "manual") : "recent";
}

export function setSortMode(mode: "recent" | "az" | "manual"): void {
  globalThis.localStorage?.setItem(SORT_KEY, mode);
  announce(CHANGED);
}

export function removeEntry(key: AppKey): void {
  const entries = read();
  if (!(key in entries)) return;
  const { [key]: _gone, ...rest } = entries;
  write(rest);
}

/**
 * Every installed app as one list: the built-ins in their declared order, then the user's apps
 * most-recently-updated first. Built-ins and user apps are one list to the user; provenance is an
 * attribute of a row, not a section (#87 decides how it shows).
 *
 * Entries for user apps that no longer exist are dropped here, so deleting an app anywhere —
 * `removeUserApp` cannot reach this module without a cycle — leaves nothing behind.
 */
export function listInstalledApps(): InstalledApp[] {
  const entries = read();
  const users = listUserApps();
  const live = new Set<string>([...BUILTIN_APPS.map((id) => appKey("builtin", id)), ...users.map((u) => appKey("user", u.id))]);
  const stale = Object.keys(entries).filter((k) => !live.has(k));
  if (stale.length) write(Object.fromEntries(Object.entries(entries).filter(([k]) => live.has(k))));

  const entryOf = (key: AppKey): LauncherEntry => entries[key] ?? { key };
  // A cached identity counts only while it is for THIS source. A built-in's source is not at hand
  // here, so its cache is trusted as is: the sources ship with the app and change with it.
  const identityOf = (entry: LauncherEntry, source?: string): AppIdentity | undefined =>
    entry.identity && (source === undefined || entry.identity.hash === sourceHash(source)) ? entry.identity : undefined;
  const declared = (identity: AppIdentity | undefined): { icon?: string; accent?: string } => ({
    ...(identity?.icon ? { icon: identity.icon } : {}),
    ...(identity?.accent ? { accent: identity.accent } : {}),
  });
  const builtins: InstalledApp[] = BUILTIN_APPS.map((id) => {
    const key = appKey("builtin", id);
    const entry = entryOf(key);
    const identity = identityOf(entry);
    return { key, kind: "builtin", id, name: entry.displayName ?? identity?.name ?? id, ...declared(identity), trusted: true, sync: false, entry };
  });
  const mine: InstalledApp[] = users.map((user) => {
    const key = appKey("user", user.id);
    const entry = entryOf(key);
    const identity = identityOf(entry, user.source);
    // The record's name, not the source's: it starts as the declared one when the Studio saves,
    // and Rename in the launcher changes it — which the tile has to show.
    return { key, kind: "user", id: user.id, name: entry.displayName ?? user.name, ...declared(identity), trusted: user.trusted !== false, sync: Boolean(user.sync), entry, user };
  });
  return [...builtins, ...mine];
}

/** Called back after any change to the launcher entries or the user-apps registry, in any tab. */
export function subscribe(cb: () => void): () => void {
  const target = globalThis as unknown as EventTarget | undefined;
  if (!target?.addEventListener) return () => {};
  const onStorage = (e: Event): void => {
    const k = (e as StorageEvent).key;
    if (k === null || k === KEY || k === SORT_KEY || k === "karta:user-apps") cb();
  };
  target.addEventListener(CHANGED, cb);
  target.addEventListener(USER_APPS_CHANGED, cb);
  target.addEventListener("storage", onStorage);
  return () => {
    target.removeEventListener(CHANGED, cb);
    target.removeEventListener(USER_APPS_CHANGED, cb);
    target.removeEventListener("storage", onStorage);
  };
}

// `useSyncExternalStore` needs the same array back while nothing changed, or it re-renders forever.
// The raw JSON of both keys is the fingerprint: cheap to compare, and it changes iff the list does.
let snapshot: { raw: string; apps: InstalledApp[] } | null = null;
function getSnapshot(): InstalledApp[] {
  const raw = `${globalThis.localStorage?.getItem(KEY) ?? ""} ${globalThis.localStorage?.getItem("karta:user-apps") ?? ""}`;
  if (!snapshot || snapshot.raw !== raw) snapshot = { raw, apps: listInstalledApps() };
  return snapshot.apps;
}

/** The sort mode, live. */
export function useSortMode(): "recent" | "az" | "manual" {
  return useSyncExternalStore(subscribe, getSortMode, getSortMode);
}

/** The installed-app list, live: re-renders on any write to either registry, and has each app's
 *  declared identity read and cached in the background, which is itself such a write. */
export function useInstalledApps(): InstalledApp[] {
  const apps = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void ensureIdentities(apps).catch((e) => console.warn("[karta] could not read an app's identity:", e));
  }, [apps]);
  return apps;
}
