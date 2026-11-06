// What deleting an app on this device takes with it: the app's own storage.
//
// Deleting an app removed it from the launcher and left everything else where it was — the database
// in the storage worker's pool, the copy in `localStorage` where that was the home, and the ids of
// the space the app synced through. Adding the same app again then opened on the old records
// ("looks like the app deletion didn't remove all the data"), and joining it again through a link
// put this device back in the space it had just left. The question had said "This deletes the app
// AND its data"; this makes that true.
//
// The database file goes once the app is closed, not while it is open: the Studio deletes an app
// from inside it, and removing the file under a store that is still answering the screen made the
// app's last reads fail on their way out. The keys go at once; the file is written down as owed
// and removed when the app closes, or at the next boot if the tab went first.
//
// What stays: the device database shared by every synced app (`karta-jazz`) keeps the values it
// holds for a space this device has forgotten; they are unreachable from here and go when the
// browser's storage does. And the relay keeps a shared app for the others — leaving is not deleting.

import { deleteWorkerSqlite, workersAvailable } from "@potyro/store";

export interface EraseAppDataDeps {
  /** Remove the worker's database file. Defaults to the real one; a test passes its own. */
  deleteDatabase?: (namespace: string) => Promise<void>;
  /** The browser's origin-private file system root, for the fallback that keeps a directory per app. */
  opfsRoot?: () => Promise<{ getDirectoryHandle(name: string): Promise<{ removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> }> }>;
  storage?: Pick<Storage, "removeItem" | "getItem" | "setItem">;
}

/** The apps whose database is still owed its removal: deleted while open, or while the tab was going. */
const OWED = "potyro:erase-owed";

/** The apps open in this tab right now (`bootUserApp` says). A deleted app's file waits for its close. */
const open = new Set<string>();

/** Every `localStorage` key an app's namespace owns, in the shell and the store. */
export function appStorageKeys(namespace: string): string[] {
  return [
    `potyro:${namespace}`, // the localStorage store, where that was the home
    `potyro:moved:${namespace}`, // ...and the note that it moved into the worker
    `potyro:store-home:${namespace}`, // where the database lives on this device
    `potyro:jazz:group:${namespace}`, // the space this app synced through
    `potyro:jazz:root:${namespace}`,
    `potyro:jazz:db:${namespace}`,
  ];
}

/**
 * Erase an app's data on this device. The keys go now; the database file goes now too unless the
 * app is open in this tab, in which case it goes when the app closes. Best-effort and loud: each
 * part that cannot go is logged and the rest still goes, because a key left behind is better than
 * an app left behind whole.
 */
export async function eraseAppData(appId: string, deps: EraseAppDataDeps = {}): Promise<void> {
  const storage = deps.storage ?? globalThis.localStorage;
  for (const key of appStorageKeys(`user:${appId}`)) {
    try {
      storage?.removeItem(key);
    } catch {
      /* storage that cannot be written cannot have held the app either */
    }
  }
  owe(appId, deps);
  await settleOwed(deps);
}

/** `bootUserApp` opened this app's store: its file, if it is deleted meanwhile, waits. */
export function appOpened(appId: string): void {
  open.add(appId);
}

/** ...and closed it: whatever is owed can go now. */
export function appClosed(appId: string, deps: EraseAppDataDeps = {}): Promise<void> {
  open.delete(appId);
  return settleOwed(deps);
}

/** Remove every owed database whose app is not open in this tab. Called on close and at boot. */
export async function settleOwed(deps: EraseAppDataDeps = {}): Promise<void> {
  const deleteDatabase = deps.deleteDatabase ?? ((ns: string) => (workersAvailable() ? deleteWorkerSqlite(ns) : Promise.resolve()));
  for (const appId of owed(deps)) {
    if (open.has(appId)) continue;
    const namespace = `user:${appId}`;
    try {
      await deleteDatabase(namespace);
      await removeOpfsDirectory(namespace, deps);
      settle(appId, deps);
    } catch (e) {
      console.warn(`[potyro] could not remove the database of "${appId}" (will try again):`, e);
    }
  }
}

function owed(deps: EraseAppDataDeps): string[] {
  try {
    const raw = (deps.storage ?? globalThis.localStorage)?.getItem(OWED);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeOwed(list: string[], deps: EraseAppDataDeps): void {
  try {
    const storage = deps.storage ?? globalThis.localStorage;
    if (list.length) storage?.setItem(OWED, JSON.stringify(list));
    else storage?.removeItem(OWED);
  } catch {
    /* without storage there is no file to owe either */
  }
}

const owe = (appId: string, deps: EraseAppDataDeps) => writeOwed([...new Set([...owed(deps), appId])], deps);
const settle = (appId: string, deps: EraseAppDataDeps) => writeOwed(owed(deps).filter((id) => id !== appId), deps);

/** The OPFS fallback of older builds kept a pool of its own per app, in a directory of its own. */
async function removeOpfsDirectory(namespace: string, deps: EraseAppDataDeps): Promise<void> {
  const root = deps.opfsRoot ?? (() => (navigator.storage?.getDirectory ? navigator.storage.getDirectory() : Promise.reject(new Error("no OPFS"))));
  try {
    const potyro = await (await root()).getDirectoryHandle("potyro");
    await potyro.removeEntry(namespace, { recursive: true });
  } catch {
    /* no such directory on most devices — and no OPFS at all on some */
  }
}
