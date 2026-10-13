// Where the bundler finds an installed app's libraries and modules (#266, #258): its own file space,
// read through the Store, vouched for by the lock on its `UserApp` record.
//
// Opening an app builds the `ModuleSource` from the store it just opened. Everything else that
// bundles a saved app's source — Ask and Edit checking a change, the Studio's preview, the launcher's
// concurrency check — asks `modulesOf(id)`, which reads the same files once and keeps them in memory
// for as long as the lock stays the same.
//
// ## This device's copy of the code (#281)
//
// The code lives in the app's LOCAL store (`user:<id>`, sync off), whether or not its data syncs. For
// an app that does not sync that is simply its store. For one that does, it is the store its data
// came from when sync was turned on — which already holds the code — and the store a guest or another
// of your devices keeps what it fetched in. Either way a library's bytes never ride the shared space:
// they are megabytes, and every device can fetch them from where the lock says, once, and check them.
// An app whose code reached its space before this is still read from there, after this device's copy.
import { carriedModuleFiles, carryCode, fileSpace, type AppLock, type CarriedCode, type PackagedFile, type Store } from "@potyro/store";
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

/** Opens the app's local store: where this device keeps its code. Injected in tests. */
export type OpenLocal = (appId: string) => Promise<Store>;

const openLocal: OpenLocal = async (appId) => {
  const { openStore } = await import("./open-store.js");
  return openStore(`user:${appId}`, { sync: false });
};

async function withLocal<T>(appId: string, open: OpenLocal, use: (store: Store) => Promise<T>): Promise<T> {
  const store = await open(appId);
  try {
    return await use(store);
  } finally {
    await store.close();
  }
}

/** Keep code files (`.modules/…`, `.src/…`) on this device, as code that came with the app. */
export async function keepCode(appId: string, files: PackagedFile[], open: OpenLocal = openLocal): Promise<void> {
  if (!files.length) return;
  await withLocal(appId, open, async (store) => {
    const space = fileSpace(store);
    for (const f of files) {
      const mime = f.mime ?? (f.path.endsWith(".js") ? "text/javascript" : "text/plain");
      await space.write(f.path, new Blob([f.data as BlobPart], { type: mime }), { origin: "shipped", mime });
    }
  });
}

/**
 * Keep the modules that came with an app's source, each checked against its lock first: one that does
 * not match is refused by name, and nothing is kept.
 */
export async function receiveCode(appId: string, code: CarriedCode, open: OpenLocal = openLocal): Promise<void> {
  await keepCode(appId, await carriedModuleFiles(code), open);
}

type Reader = (file: string) => Promise<Uint8Array | null>;

/** One reader over several, first answer wins. */
function firstOf(...readers: Reader[]): Reader {
  return async (file) => {
    for (const read of readers) {
      const bytes = await read(file);
      if (bytes) return bytes;
    }
    return null;
  };
}

/**
 * The modules an app opens with: this device's copy of its code, then — for an app whose data syncs —
 * its space, where code installed before #281 may be. `store` is the store the app opened. Undefined
 * for an app that is one file.
 */
export async function deviceModules(
  app: Pick<UserApp, "id" | "lock">,
  store: Store,
  synced: boolean,
  open: OpenLocal = openLocal,
): Promise<ModuleSource | undefined> {
  if (!hasEntries(app.lock)) return undefined;
  if (!synced) return storeModules(store, app.lock);
  const lock = app.lock;
  const mine = await withLocal(app.id, open, (local) => snapshotModules(local, lock));
  return { lock, read: firstOf(mine.read, (file) => readFile(store, file)) };
}

/** What to carry with the app's source when it is shared or put on your account (#281). */
export async function codeToCarry(app: Pick<UserApp, "id" | "lock">, also?: Store, open: OpenLocal = openLocal): Promise<CarriedCode> {
  const lock = app.lock;
  if (!hasEntries(lock)) return {};
  if (!Object.keys(lock).some((k) => k.startsWith("src/"))) return { lock };
  const elsewhere: Reader = (file) => (also ? readFile(also, file) : Promise.resolve(null));
  return withLocal(app.id, open, (local) => carryCode(lock, firstOf((file) => readFile(local, file), elsewhere)));
}

/** A `ModuleSource` over an open store. Undefined for an app that is one file with no libraries. */
export function storeModules(store: Store, lock: AppLock | undefined): ModuleSource | undefined {
  if (!hasEntries(lock)) return undefined;
  return { lock, read: (file) => readFile(store, file) };
}

/** Every file a lock names, read into memory now, so the store can close again. */
export async function snapshotModules(store: Store, lock: AppLock): Promise<ModuleSource> {
  return snapshotOf(lock, (file) => readFile(store, file));
}

async function snapshotOf(lock: AppLock, read: Reader): Promise<ModuleSource> {
  const files = new Map<string, Uint8Array>();
  for (const entry of Object.values(lock)) {
    if (files.has(entry.file)) continue;
    const bytes = await read(entry.file);
    if (bytes) files.set(entry.file, bytes);
  }
  return memoryModules(lock, files);
}

/**
 * The files an app's lock names, by their path in its space, for an export bundle to carry (#282): a
 * restore then has its libraries and its own modules without fetching. A file not on this device is
 * left out; adding the app from the bundle then fetches that library, with consent, as a package does.
 * `from` is the app's open store, or the modules it opened with (this device's copy first, #281).
 */
export async function appCode(from: Store | ModuleSource, lock: AppLock | undefined): Promise<Array<{ path: string; data: Uint8Array }>> {
  if (!hasEntries(lock)) return [];
  const modules = "read" in from && "lock" in from ? from : await snapshotModules(from, lock);
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
    const { syncAllowedFor } = await import("./app-store.js");
    const synced = !!app.sync && (await syncAllowedFor(app));
    const store = await opener(app);
    try {
      const here = await deviceModules(app, store, synced);
      return here ? await snapshotOf(app.lock!, here.read) : memoryModules(app.lock!, new Map());
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
