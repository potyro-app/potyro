// Running an app's live tile (docs/04 §Tile) — while it is open, and from the home screen when it is not.
//
// Two ways in, one result. While an app is open, its own runtime runs the tile again a moment after
// its data changes, so the face you come home to says what you just did. From the home screen, an
// app whose face is missing or old is opened without being shown — its store, its code where it
// runs (directly when it is yours, in its sealed box when it is not), a ctx with no UI — its tile run
// once, and everything put away again. One at a time, after the wall has painted with plain faces,
// and never more than every `TILE_REFRESH_MS` per app.
//
// Every failure is silent (owner, 2026-10-15): a tile that throws, takes longer than its budget, or
// answers nothing the launcher can show leaves the plain face. No toast, no red, no console error —
// it is the app's business, and the person did not ask for the tile.

import type { Store } from "@potyro/store";
import type { PotyroRuntime } from "@potyro/runtime";
import type { LoadedApp } from "@potyro/host";
import { appKey, getEntry, recordTile, sourceHash, type InstalledApp, type TileCache } from "./launcher-store.js";
import { checkTileContent, type CheckedTile } from "./tile-content.js";
import type { UserApp } from "./user-apps.js";

/** How long a tile may take, all of it: its reads, its arithmetic. The realm's own per-call limit is 1 s. */
export const TILE_BUDGET_MS = 1_500;
/** A face older than this is run again when the home screen shows. */
export const TILE_REFRESH_MS = 15 * 60_000;
const DEBOUNCE_MS = 600;
/** The picture kept beside a tile: small enough for the launcher's own storage. */
const THUMB_PX = 240;

class TileTimeout extends Error {}

function withBudget<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TileTimeout()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** A picture as a small JPEG `data:` URL, or nothing if this browser cannot make one. */
async function thumbnail(blob: Blob): Promise<string | undefined> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return undefined;
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, THUMB_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } finally {
    bitmap.close?.();
  }
}

async function pictureOf(tile: CheckedTile, store: Store, runtime: PotyroRuntime): Promise<string | undefined> {
  const ref = tile.image;
  if (!ref) return undefined;
  try {
    let blob: Blob | null = null;
    if (typeof ref === "object" && "key" in ref) blob = await store.getBlob(ref);
    else {
      const bytes = await runtime.ctx.files.bytes(ref);
      if (bytes) blob = new Blob([bytes as BlobPart]);
    }
    return blob ? await thumbnail(blob) : undefined;
  } catch {
    return undefined;
  }
}

/** Run the tile on a composed app. Never throws: what cannot be shown is `{}`, the plain face. */
export async function runTile(loaded: LoadedApp, runtime: PotyroRuntime, store: Store): Promise<Pick<TileCache, "tile" | "image">> {
  try {
    const raw = await withBudget(loaded.callTile(runtime.ctx), TILE_BUDGET_MS);
    const tile = checkTileContent(raw);
    if (!tile) return {};
    const image = await withBudget(pictureOf(tile, store, runtime), TILE_BUDGET_MS).catch(() => undefined);
    return { tile, ...(image ? { image } : {}) };
  } catch {
    return {};
  }
}

const remember = (id: string, source: string, result: Pick<TileCache, "tile" | "image">): void =>
  recordTile(appKey("user", id), { hash: sourceHash(source), at: new Date().toISOString(), ...result });

/**
 * While the app is open: run its tile now and again a moment after any of its records change. The
 * home screen then shows what you just did without opening anything. Returns the stop.
 */
export function watchTile(app: { id: string; source: string }, loaded: LoadedApp, runtime: PotyroRuntime, store: Store): () => void {
  if (!declaresTile(loaded)) return () => {};
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = async (): Promise<void> => {
    const result = await runTile(loaded, runtime, store);
    if (alive) remember(app.id, app.source, result);
  };
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), DEBOUNCE_MS);
  };
  void run();
  const offs = Object.keys(runtime.definition.entities).map((entity) => store.subscribe(entity, schedule));
  return () => {
    alive = false;
    if (timer) clearTimeout(timer);
    for (const off of offs) off();
  };
}

/** Whether the loaded app has a tile function (its own, or the sealed box's placeholder for one). */
export function declaresTile(loaded: LoadedApp): boolean {
  const tile = (loaded.definition as { tile?: unknown }).tile;
  return typeof tile === "function" || tile === "__potyro_fn__";
}

/**
 * Open the app without showing it, run its tile once, and put it all away. The store is read-only
 * for this: a tile reads, and a tile that writes is refused (the write fails, so the tile does).
 */
export async function runTileHeadless(app: UserApp): Promise<void> {
  const [{ openAppStore, syncAllowedFor }, { ensureIdentity }, { readOnlyStore }, { shellCaps }, { compose }, { createNavBridge, createUiBridge }] = await Promise.all([
    import("./app-store.js"),
    import("@potyro/identity"),
    import("./read-only-store.js"),
    import("./shell-caps.js"),
    import("./compose.js"),
    import("./ui-bridge.js"),
  ]);
  const me = await ensureIdentity();
  const sync = await syncAllowedFor(app);
  const raw = await openAppStore(app, { sync, me: me.id });
  let composed: Awaited<ReturnType<typeof compose>> | undefined;
  try {
    const store = readOnlyStore(raw, "a launcher tile only reads");
    const modules = await modulesWithoutAsking(app, raw, sync);
    if (modules === null) return;
    // A ctx with no person on the other end: nothing is shown, nothing is confirmed.
    const ui = createUiBridge(() => {});
    const nav = createNavBridge(() => {});
    const caps = shellCaps();
    if (app.trusted !== false) {
      const { loadTrustedModule } = await import("./trusted-loader.js");
      composed = await compose({ provenance: "trusted", app: await loadTrustedModule(app.source, modules), store, caps, ui, nav, me });
    } else {
      const [{ createAppBundler }, { createSharedAppLoader }] = await Promise.all([import("./app-bundler.js"), import("./isolate-bridge.js")]);
      const bundleCode = await (await createAppBundler())(app.source, modules);
      composed = await compose({ provenance: "untrusted", bundleCode, store, caps, ui, nav, me, loadIsolated: await createSharedAppLoader(store) });
    }
    if (!declaresTile(composed.loaded)) {
      remember(app.id, app.source, {});
      return;
    }
    remember(app.id, app.source, await runTile(composed.loaded, composed.runtime, store));
  } finally {
    if (composed) {
      composed.runtime.close();
      composed.loaded.dispose();
    }
    await raw.close().catch(() => {});
  }
}

/** The app's libraries and modules as this device holds them — never fetched for a tile, never asked about. */
async function modulesWithoutAsking(app: UserApp, store: Store, synced: boolean): Promise<import("./package-modules.js").ModuleSource | undefined | null> {
  const [{ deviceModules }, { librariesForOpen }] = await Promise.all([import("./app-modules.js"), import("./open-libraries.js")]);
  const ready = await librariesForOpen(app, await deviceModules(app, store, synced), { ask: async () => false, keep: async () => {} });
  return ready.ok ? ready.modules : null;
}

// ─── the home screen's queue ─────────────────────────────────────────────────────────────────

let queue: InstalledApp[] = [];
let running: Promise<void> | null = null;
let paused = 0;

/** Whether this app's face should be run again: never run, run on another version, or old. */
export function tileIsStale(app: Pick<InstalledApp, "user" | "entry">, now: number, maxAge = TILE_REFRESH_MS): boolean {
  const cache = app.entry.tile;
  if (!cache || cache.hash !== sourceHash(app.user.source)) return true;
  return now - Date.parse(cache.at) >= maxAge;
}

async function drain(): Promise<void> {
  while (queue.length && !paused) {
    const app = queue.shift()!;
    // It may have been run meanwhile — opened, and run by its own runtime.
    const entry = getEntry(app.key);
    if (!tileIsStale({ user: app.user, entry }, Date.now())) continue;
    try {
      await withBudget(runTileHeadless(app.user), TILE_BUDGET_MS * 6);
    } catch {
      // Silent, by design: the plain face stays. Remember the try, so it is not retried at once.
      remember(app.id, app.user.source, entry.tile?.hash === sourceHash(app.user.source) ? { tile: entry.tile.tile, image: entry.tile.image } : {});
    }
  }
  running = null;
}

/**
 * Queue the stale faces among `apps` (those that declare a tile) to be run one by one. Returns at
 * once; the wall re-renders as each face is written.
 */
export function refreshTiles(apps: readonly InstalledApp[], now = Date.now()): void {
  const wanted = apps.filter((a) => a.entry.identity?.tile && tileIsStale(a, now) && !queue.some((q) => q.key === a.key));
  if (!wanted.length) return;
  queue = [...queue, ...wanted];
  if (!running && !paused) running = drain();
}

/**
 * Stop starting tiles and wait for the one running, before an app opens its own store: the two
 * must not hold one database at once. Returns the resume.
 */
export async function pauseTiles(): Promise<() => void> {
  paused++;
  // What was waiting was for the home screen; it asks again when it shows.
  queue = [];
  await running?.catch(() => {});
  let resumed = false;
  return () => {
    if (resumed) return;
    resumed = true;
    paused = Math.max(0, paused - 1);
    if (!paused && queue.length && !running) running = drain();
  };
}

/** For tests: forget the queue. */
export function resetTileQueue(): void {
  queue = [];
  running = null;
  paused = 0;
}
