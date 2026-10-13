// Where the bundler finds an installed app's libraries and modules (#266, #258): its own file space,
// read through the Store, vouched for by the lock on its `UserApp` record.
//
// Opening an app builds the `ModuleSource` from the store it just opened. Everything else that
// bundles a saved app's source — Ask and Edit checking a change, the Studio's preview, the launcher's
// concurrency check — asks `modulesOf(id)`, which reads the same files once and keeps them in memory
// for as long as the lock stays the same.
import { fileSpace, type AppLock, type Store } from "@potyro/store";
import { memoryModules, type ModuleSource } from "./package-modules.js";
import { duplicateUserApp, getUserApp, type UserApp } from "./user-apps.js";

const hasEntries = (lock: AppLock | undefined): lock is AppLock => !!lock && Object.keys(lock).length > 0;

/** Read one file of the app's space as bytes, or null when it is not on this device. */
async function readFile(store: Store, path: string): Promise<Uint8Array | null> {
  const space = fileSpace(store);
  const entry = await space.find(path);
  if (!entry) return null;
  const blob = await space.read({ id: entry.id });
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** A `ModuleSource` over an open store. Undefined for an app that is one file with no libraries. */
export function storeModules(store: Store, lock: AppLock | undefined): ModuleSource | undefined {
  if (!hasEntries(lock)) return undefined;
  return { lock, read: (file) => readFile(store, file) };
}

/** Every file a lock names, read into memory now, so the store can close again. */
export async function snapshotModules(store: Store, lock: AppLock): Promise<ModuleSource> {
  const files = new Map<string, Uint8Array>();
  for (const entry of Object.values(lock)) {
    if (files.has(entry.file)) continue;
    const bytes = await readFile(store, entry.file);
    if (bytes) files.set(entry.file, bytes);
  }
  return memoryModules(lock, files);
}

/**
 * The files an app's lock names, by their path in its space, for an export bundle to carry (#282): a
 * restore then has its libraries and its own modules without fetching. A file not on this device is
 * left out; adding the app from the bundle then fetches that library, with consent, as a package does.
 */
export async function appCode(store: Store, lock: AppLock | undefined): Promise<Array<{ path: string; data: Uint8Array }>> {
  if (!hasEntries(lock)) return [];
  const modules = await snapshotModules(store, lock);
  const out: Array<{ path: string; data: Uint8Array }> = [];
  for (const file of new Set(Object.values(lock).map((e) => e.file))) {
    const data = await modules.read(file);
    if (data) out.push({ path: file, data });
  }
  return out;
}

const cache = new Map<string, { lock: AppLock; modules: Promise<ModuleSource> }>();

/**
 * While an app is open, a check on it (Ask, Edit, the preview) reads its code through the store the
 * app has open, rather than opening a second one. Forgotten when the app closes.
 */
export function rememberModules(appId: string, lock: AppLock | undefined, modules: ModuleSource | undefined): void {
  if (!hasEntries(lock) || !modules) return;
  cache.set(appId, { lock, modules: Promise.resolve(modules) });
}

export function forgetModules(appId: string): void {
  cache.delete(appId);
}

/**
 * The modules a saved app's source may import: what bundling it anywhere but its own open needs.
 * Undefined for an app with none. `open` opens its store when nothing has read it yet.
 */
export async function modulesOf(appId: string | undefined, open?: (app: UserApp) => Promise<Store>): Promise<ModuleSource | undefined> {
  if (!appId) return undefined;
  const app = getUserApp(appId);
  if (!app || !hasEntries(app.lock)) return undefined;
  const hit = cache.get(appId);
  // The record is read afresh from storage each time, so the same lock is never the same object.
  if (hit && JSON.stringify(hit.lock) === JSON.stringify(app.lock)) return hit.modules;
  const opener =
    open ??
    (async (a: UserApp) => {
      const { openAppStore, syncAllowedFor } = await import("./app-store.js");
      return openAppStore(a, { sync: await syncAllowedFor(a) });
    });
  const modules = (async () => {
    const store = await opener(app);
    try {
      return await snapshotModules(store, app.lock!);
    } finally {
      await store.close();
    }
  })();
  cache.set(appId, { lock: app.lock, modules });
  modules.catch(() => cache.delete(appId));
  return modules;
}

async function openFor(app: UserApp): Promise<Store> {
  const { openAppStore, syncAllowedFor } = await import("./app-store.js");
  return openAppStore(app, { sync: await syncAllowedFor(app) });
}

/**
 * `duplicateUserApp`, for an app whose code is more than its source: the copy starts empty of DATA,
 * but its libraries and own modules come with it, into its own folder — otherwise it could not open.
 */
export async function duplicateApp(id: string, now: string): Promise<UserApp | null> {
  const copy = await duplicateUserApp(id, now);
  if (!copy || !hasEntries(copy.lock)) return copy;
  const modules = await modulesOf(id, openFor);
  if (!modules) return copy;
  const store = await openFor(copy);
  try {
    const space = fileSpace(store);
    for (const entry of Object.values(copy.lock)) {
      const bytes = await modules.read(entry.file);
      if (bytes) await space.write(entry.file, new Blob([bytes as BlobPart]), { origin: "shipped" });
    }
  } finally {
    await store.close();
  }
  return copy;
}
