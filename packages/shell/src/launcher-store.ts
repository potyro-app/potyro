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

/** There is one kind of app (#152): the examples are seeded into the same registry as yours. The
 *  key keeps its `user:` prefix so entries written before that stay valid. */
export type AppKind = "user";
/** Stable key for an installed app: `user:groceries`. */
export type AppKey = `${AppKind}:${string}`;
export const appKey = (kind: AppKind, id: string): AppKey => `${kind}:${id}`;

export interface LauncherEntry {
  key: AppKey;
  /** User override; falls back to the app's declared name. */
  displayName?: string;
  /** User override; falls back to the app's declared icon. */
  icon?: string;
  /** User override for the tile's colour: a hue on the same twelve-step wheel tiles derive from
   *  their key, chosen from the tile editor (#83). Falls back to the declared accent, then the key. */
  hue?: number;
  pinned?: boolean;
  /** Manual position among pinned. */
  order?: number;
  lastOpenedAt?: string; // ISO
  openCount?: number;
  /** What the app declares about itself, read from its source without running it (#82), cached
   *  against a hash of that source so it is read once per version. */
  identity?: AppIdentity;
  /** Who is in a synced app's space, as last seen while it was open (#87). The launcher cannot
   *  open every app's store to ask, so a tile shows the people you have already seen there. */
  people?: { id: string; name: string }[];
  /** What wants attention in the app, as last known while it was open (#86, phase 1). */
  signals?: AppSignals;
}

/**
 * The "something happened" counts, written by the running app whenever they change. The launcher
 * cannot run every app to ask, so it shows the last known numbers. Chat can only go stale upward
 * while the app is closed; reminders are stored as due TIMES, so one that falls due after the app
 * was closed is still counted.
 *
 * Edits used to be counted here too, and were removed: a badge has to mean "someone did something
 * you would want to know about", and a record count does not. Dragging one item up a list patches
 * every item it passed, so a single move read as five changes; loading a backup read as hundreds.
 * A number nobody can act on is noise on top of the thing they can. Messages are the signal.
 */
export interface AppSignals {
  /** Unread chat messages. */
  chat: number;
  /** When each of the app's reminders falls due (ISO), past ones included, earliest first. */
  due: string[];
}

export interface Attention {
  total: number;
  chat: number;
  due: number;
}

/** The badge's numbers for an entry at `now`: a reminder counts once its time has come. */
export function attentionOf(entry: LauncherEntry, now: number): Attention {
  const s = entry.signals;
  const chat = Math.max(0, s?.chat ?? 0);
  const due = (s?.due ?? []).filter((t) => Date.parse(t) <= now).length;
  return { total: chat + due, chat, due };
}

/** "2 messages · 1 due" — the badge in words. Empty when there is nothing. */
export function describeAttention(a: Attention): string {
  const part = (n: number, one: string, many: string): string | null => (n ? `${n} ${n === 1 ? one : many}` : null);
  return [part(a.chat, "message", "messages"), part(a.due, "due", "due")].filter(Boolean).join(" · ");
}

/** Merge new signal values into the app's entry — only when something changed, so a re-render does not write. */
export function recordSignals(key: AppKey, patch: Partial<AppSignals>): void {
  // A `changes` left on an entry by an older build is simply not read — see `AppSignals`.
  const prev = getEntry(key).signals ?? { chat: 0, due: [] };
  const next: AppSignals = { ...prev, ...patch };
  if (JSON.stringify(next) === JSON.stringify(prev) && getEntry(key).signals) return;
  updateEntry(key, { signals: next });
}

export interface AppIdentity {
  hash: string;
  name?: string;
  icon?: string;
  accent?: string;
}

/** One row of the launcher: what the app is, joined with what this device knows about it. */
export interface InstalledApp {
  key: AppKey;
  kind: AppKind;
  id: string;
  /** What the tile says: the user's override, else the record's name. */
  name: string;
  /** For the tile: the user's own icon for it (#83), else the declared one (#82) once the source
   *  has been read. */
  icon?: string;
  /** The declared accent (#82). */
  accent?: string;
  /** The user's own colour for the tile (#83), a hue. */
  hue?: number;
  trusted: boolean;
  sync: boolean;
  /** The members last seen in the space (synced apps only, once opened). */
  people: { id: string; name: string }[];
  entry: LauncherEntry;
  user: UserApp;
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
      const hash = sourceHash(app.user.source);
      if (app.entry.identity?.hash === hash) return;
      reading.add(app.key);
      try {
        if (getEntry(app.key).identity?.hash === hash) return;
        const shape = await inspect(app.user.source);
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
 * Every installed app as one list, most-recently-updated first (the launcher orders it, #84).
 *
 * Entries for apps that no longer exist are dropped here, so deleting an app anywhere —
 * `removeUserApp` cannot reach this module without a cycle — leaves nothing behind.
 */
export function listInstalledApps(): InstalledApp[] {
  const entries = read();
  const users = listUserApps();
  const live = new Set<string>(users.map((u) => appKey("user", u.id)));
  const stale = Object.keys(entries).filter((k) => !live.has(k));
  if (stale.length) write(Object.fromEntries(Object.entries(entries).filter(([k]) => live.has(k))));

  return users.map((user) => {
    const key = appKey("user", user.id);
    const entry = entries[key] ?? { key };
    // A cached identity counts only while it is for THIS source.
    const identity = entry.identity && entry.identity.hash === sourceHash(user.source) ? entry.identity : undefined;
    // The record's name, not the source's: it starts as the declared one when the app is saved,
    // and Rename in the launcher changes it — which the tile has to show.
    return {
      key,
      kind: "user",
      id: user.id,
      name: entry.displayName ?? user.name,
      ...(entry.icon ?? identity?.icon ? { icon: entry.icon ?? identity?.icon } : {}),
      ...(identity?.accent ? { accent: identity.accent } : {}),
      ...(typeof entry.hue === "number" ? { hue: entry.hue } : {}),
      trusted: user.trusted !== false,
      sync: Boolean(user.sync),
      people: user.sync ? (entry.people ?? []) : [],
      entry,
      user,
    };
  });
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
