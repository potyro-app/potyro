// Which apps are yours, kept on your ACCOUNT rather than on a device (KA-16 follow-up).
//
// Typing the recovery words on a new device already makes it you — same account, same membership of
// every space you are in. What it could not do was tell it what you HAVE: the list of apps lives in
// each browser's localStorage, and so do the ids of the spaces holding their data. So a linked
// device came up correctly attributed and completely empty, and the only way to get anything onto it
// was to share each app to yourself, by hand, from the device that still had it.
//
// This is the missing half: a map on your account, `appId -> what it takes to open that app`. It is
// written by the device that has the app, encrypted to your account's keys, and stored on the relay
// like any other CoValue — the relay cannot read it. A new device signs in, reads the map, and can
// then ask for exactly the spaces it names.
//
// Deliberately small: what an app IS (its id, name, icon and source — with its lock and its own
// modules when it has them, #281, but never a library's bytes) and WHERE its data is (the
// group and root ids), plus enough about its size for a device to be asked which ones it wants
// before it downloads a phone's worth of photos. Not the data itself — that is already in the
// space, which is the whole point of naming it here.

import type { AppLock } from "./app-lock.js";
import { readCarriedCode } from "./carried-code.js";

/** One app, as your account knows it. */
export interface AccountApp {
  id: string;
  name: string;
  icon?: string;
  /** The app's code, so a new device can run it before any of its data has arrived. */
  source: string;
  /** The space holding its data: the group that owns it, and the root the store hangs off. */
  group: string;
  root: string;
  /** Roughly how much there is to fetch, so "load your apps?" can be honest about a 400 MB one. */
  sizeBytes?: number;
  /** Whether this app is shared with other people, which is a different thing from being yours. */
  shared?: boolean;
  updatedAt: string;
  /**
   * Its code beyond `source` (#281): the lock, and its own modules as text — see `carried-code.ts`.
   * Absent on an entry written before they travelled, or for an app that is one file. A new device
   * fetches the libraries the lock names once, with consent, and keeps only bytes that match it.
   */
  lock?: AppLock;
  modules?: Record<string, string>;
}

/** The key on the account CoMap pointing at the registry. */
const REGISTRY = "potyroApps";

/**
 * The key builds before the rename (#248) used, which renamed it and moved nothing. Every
 * account that recorded an app before then has its list HERE, synced to every device it is on; it
 * is read as part of the registry, and becomes the registry when this account has no other.
 */
const LEGACY_REGISTRY = "kartaApps";

interface CoMapish {
  id: string;
  get(key: string): unknown;
  set(key: string, value: unknown, privacy?: string): void;
  /** cojson's CoMap lists its keys through a METHOD; the first version of this read it as an array
   *  and every write came back invisible. */
  keys(): string[];
}

interface Nodeish {
  expectCurrentAccount(hint: string): Promise<CoMapish>;
  load(id: string): Promise<CoMapish | "unavailable">;
  createGroup(): { id: string; createMap(): CoMapish };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A stored entry, back as an `AccountApp` — or null when it is not one (an older or partial write). */
function parse(id: string, raw: unknown): AccountApp | null {
  if (typeof raw !== "string") return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v)) return null;
    const { name, source, group, root } = v;
    if (typeof name !== "string" || typeof source !== "string" || typeof group !== "string" || typeof root !== "string") {
      return null;
    }
    return {
      id,
      name,
      source,
      group,
      root,
      icon: typeof v.icon === "string" ? v.icon : undefined,
      sizeBytes: typeof v.sizeBytes === "number" ? v.sizeBytes : undefined,
      shared: v.shared === true,
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date(0).toISOString(),
      ...readCarriedCode(v),
    };
  } catch {
    return null;
  }
}

/** The registry under each key, as far as it has arrived. `named` without `map` = not here YET. */
interface Found {
  current: { named: boolean; map: CoMapish | null };
  legacy: { named: boolean; map: CoMapish | null };
}

async function find(node: Nodeish, waitMs: number): Promise<Found> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const account = await node.expectCurrentAccount("potyro apps");
    const at = async (key: string): Promise<Found["current"]> => {
      const id = account.get(key);
      if (typeof id !== "string") return { named: false, map: null };
      const loaded = await node.load(id);
      return { named: true, map: loaded && loaded !== "unavailable" ? loaded : null };
    };
    const found = { current: await at(REGISTRY), legacy: await at(LEGACY_REGISTRY) };
    // Waits while nothing has arrived — a just-linked device reads before the relay's copy reaches
    // it — and while either named one is still on its way.
    const pending =
      (!found.current.map && !found.legacy.map) ||
      (found.current.named && !found.current.map) ||
      (found.legacy.named && !found.legacy.map);
    if (!pending || Date.now() >= deadline) return found;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * The registry CoMap to WRITE to, creating it the first time.
 *
 * Owned by a group of its own with the account as its only member, so it is encrypted to you and to
 * nobody else — unlike the profile, which is deliberately readable by the people you share with.
 * Its id is kept on the account CoMap, which is the only thing a new device can reach knowing just
 * the words. An account with only the pre-rename registry keeps writing to that one (and names it
 * under the current key), so its list is never split in two.
 */
async function registry(node: Nodeish, create: boolean, waitMs = 0): Promise<CoMapish | null> {
  const { current, legacy } = await find(node, waitMs);
  if (current.map) return current.map;
  // Named but not here YET. Creating a second one would split the list in two and leave a later
  // device reading whichever won the race — so this waits, and never makes another.
  if (current.named) return null;
  const account = await node.expectCurrentAccount("potyro apps");
  if (legacy.map) {
    if (create) account.set(REGISTRY, legacy.map.id, "private");
    return legacy.map;
  }
  if (legacy.named || !create || typeof account.get(REGISTRY) === "string") return null;
  const map = node.createGroup().createMap();
  account.set(REGISTRY, map.id, "private");
  return map;
}

/**
 * Every entry the account holds, read across both registries.
 *
 * Two exist only where a device created a new one after the rename while the old list was still on
 * the account. The current one decides for every key it has — including a removal, which is an
 * empty value — and the old one fills in the rest.
 */
async function entries(node: Nodeish, waitMs: number): Promise<Map<string, unknown>> {
  const { current, legacy } = await find(node, waitMs);
  const out = new Map<string, unknown>();
  for (const map of [current.map, legacy.map]) {
    if (!map) continue;
    const keys = typeof map.keys === "function" ? map.keys() : [];
    for (const key of keys) if (!out.has(key)) out.set(key, map.get(key));
  }
  return out;
}

/**
 * Your display name, kept beside your apps.
 *
 * It belongs in the account profile, and it is published there — but that profile is a CoValue of
 * cojson's own, and on a device that has just been linked it arrives late or not at all, so a phone
 * introduced itself as "Me" while the laptop had a name. This registry is the channel that demonstrably
 * reaches a new device, because it is how the apps get there. Written here as well, read here first.
 *
 * Prefixed so it cannot collide with an app id, which is what every other key here is.
 */
const NAME_KEY = "\u0000name";

export async function publishNameToAccount(node: unknown, name: string): Promise<boolean> {
  try {
    const map = await registry(node as Nodeish, true);
    if (!map) return false;
    map.set(NAME_KEY, name, "private");
    return true;
  } catch {
    return false;
  }
}

/** The name on this account, or null when it has never been set (or has not arrived). */
export async function readAccountName(node: unknown, opts?: { waitMs?: number }): Promise<string | null> {
  try {
    const value = (await entries(node as Nodeish, opts?.waitMs ?? 0)).get(NAME_KEY);
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    return null;
  }
}

/** Record (or update) one app on your account. Best-effort: never fail an app over its backup. */
export async function publishAppToAccount(node: unknown, app: AccountApp): Promise<boolean> {
  try {
    const map = await registry(node as Nodeish, true);
    if (!map) return false;
    const { id, ...rest } = app;
    map.set(id, JSON.stringify(rest), "private");
    return true;
  } catch {
    return false;
  }
}

/**
 * Forget an app: it was deleted, and a new device should not offer to bring it back.
 *
 * `waitMs` as for `readAccountApps`: a node opened just for this has not necessarily got the
 * registry yet, and a removal that finds nothing to remove from is a removal that did not happen.
 */
export async function removeAppFromAccount(node: unknown, appId: string, opts?: { waitMs?: number }): Promise<boolean> {
  try {
    const waitMs = opts?.waitMs ?? 0;
    const map = await registry(node as Nodeish, false, waitMs);
    if (!map) return false;
    map.set(appId, "", "private");
    // And in the pre-rename list, if it is a different map: it must not offer the app back.
    const { legacy } = await find(node as Nodeish, waitMs);
    if (legacy.map && legacy.map.id !== map.id && legacy.map.get(appId)) legacy.map.set(appId, "", "private");
    return true;
  } catch {
    return false;
  }
}

/**
 * Every app your account knows about. Empty when there is no registry, or it has not arrived.
 *
 * `waitMs` is why this takes an option at all: a device that has just signed in with the words
 * materialises its account locally and only then does the relay's copy — the one with this list in
 * it — reach it. Reading once, immediately, is reading before the post has arrived.
 */
export async function readAccountApps(node: unknown, opts?: { waitMs?: number }): Promise<AccountApp[]> {
  try {
    const out: AccountApp[] = [];
    for (const [key, value] of await entries(node as Nodeish, opts?.waitMs ?? 0)) {
      if (key === NAME_KEY) continue; // your name lives here too; it is not an app
      const app = parse(key, value);
      if (app) out.push(app);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
