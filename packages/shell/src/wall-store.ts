// Where the tile wall is kept (#96): this device's arrangement of its apps — which are on the wall,
// in what order, at what size, in which groups.
//
// localStorage, beside the launcher's other per-device state (`launcher-store.ts`), and on purpose:
//   - The app registry the wall arranges is itself one localStorage key (`potyro:user-apps`). Kept
//     in the same storage, the arrangement can never survive the apps it describes, or be missing
//     while they are there — clearing site data clears both, a restore restores both.
//   - It is read synchronously, so the wall's first frame is the person's own arrangement. The
//     shell's durable stores (SQLite in OPFS through the storage worker, Jazz) are per app, open
//     asynchronously, and are held by one tab at a time; the home screen would paint a default and
//     then jump, or wait on a lock another tab holds.
//   - It is small (a few hundred bytes a dozen apps) and a write is one key, so a quota error cannot
//     leave half of it: the previous arrangement stays.
//   - Another tab's change arrives as a `storage` event, so two open launchers agree.
// Per device by design, like pins and recents (#81): the wall on your phone is not your desktop's.

import { useSyncExternalStore } from "react";
import { emptyWall, parseWall, type Wall } from "./launcher-wall.js";

export const WALL_KEY = "potyro:launcher:wall";
const CHANGED = "potyro:launcher:wall:changed";

let cache: { raw: string | null; wall: Wall } | null = null;

function rawWall(): string | null {
  try {
    return globalThis.localStorage?.getItem(WALL_KEY) ?? null;
  } catch {
    return null;
  }
}

/** The wall as stored, or an empty one. The same object back while nothing has changed. */
export function getWall(): Wall {
  const raw = rawWall();
  if (cache && cache.raw === raw) return cache.wall;
  let wall = emptyWall();
  if (raw) {
    try {
      wall = parseWall(JSON.parse(raw));
    } catch {
      wall = emptyWall();
    }
  }
  cache = { raw, wall };
  return wall;
}

/** Keep `wall`. Returns false when storage refused it; the previous arrangement then stands. */
export function saveWall(wall: Wall): boolean {
  try {
    globalThis.localStorage?.setItem(WALL_KEY, JSON.stringify(wall));
  } catch {
    return false;
  }
  if (typeof globalThis.dispatchEvent === "function" && typeof Event === "function") globalThis.dispatchEvent(new Event(CHANGED));
  return true;
}

function subscribe(cb: () => void): () => void {
  const target = globalThis as unknown as EventTarget | undefined;
  if (!target?.addEventListener) return () => {};
  const onStorage = (e: Event): void => {
    const k = (e as StorageEvent).key;
    if (k === null || k === WALL_KEY) cb();
  };
  target.addEventListener(CHANGED, cb);
  target.addEventListener("storage", onStorage);
  return () => {
    target.removeEventListener(CHANGED, cb);
    target.removeEventListener("storage", onStorage);
  };
}

/** The wall, live: any write here or in another tab re-renders. */
export function useWall(): Wall {
  return useSyncExternalStore(subscribe, getWall, getWall);
}
