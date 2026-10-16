// Packing everything a person has on this site, for their new home (docs/16 §Moving to a new home).
//
// Every app, the way Export packs one (main.tsx `exportApp`): its records, photos, files and
// `ctx.storage` copied into a fresh in-memory SQLite with their ids intact, plus its own code. A
// synced app is packed from its SPACE — that is where its records are — with its code from this
// device's local store, where a synced app keeps it (toggle-sync.ts), and the files it kept on this
// device only. It arrives as an ordinary app of the new site's own; sharing it again is a choice
// made there.
//
// Nothing is changed or removed here: packing reads. The old site keeps all of it.

import {
  copyStoreData,
  createMemorySqliteStore,
  isReservedPath,
  type Store,
} from "@potyro/store";
import { portableIdentity } from "@potyro/identity";
import { openStore } from "./open-store.js";
import { syncAllowedFor } from "./app-store.js";
import { listUserApps, type UserApp } from "./user-apps.js";
import { appKey, getEntry } from "./launcher-store.js";
import { exampleState } from "./examples.js";
import { deviceFilesNamespace } from "./device-files.js";
import {
  MOVE_FORMAT,
  SHARED_STORES,
  SHARED_STORE_NAMES,
  isMovablePref,
  packMoveArchive,
  type MoveArchive,
  type MoveManifest,
  type MovedApp,
  type MovedTile,
} from "./move-archive.js";

export interface PackProgress {
  /** 1-based. */
  done: number;
  total: number;
  name: string;
}

export interface Packed {
  bytes: Uint8Array;
  manifest: MoveManifest;
}

/** Copy only the app's own code files (`.modules/`, `.src/`): a synced app keeps them on the device. */
async function copyCode(from: Store, to: Store): Promise<void> {
  if (!to.putBlobWithKey) return;
  for (const entry of await from.listFiles()) {
    if (!isReservedPath(entry.path)) continue;
    const blob = await from.getBlob({ key: entry.blob, mime: entry.mime });
    if (!blob) continue;
    await to.putBlobWithKey(entry.blob, blob);
    const { earlier: _earlier, ...bare } = entry;
    await to.setFile(bare);
  }
}

async function entitiesOf(app: UserApp): Promise<string[]> {
  try {
    const { inspect } = await import("./app-source.js");
    return (await inspect(app.source)).entities.map((e) => e.key);
  } catch {
    return [];
  }
}

function tileOf(app: UserApp): MovedTile | undefined {
  const e = getEntry(appKey("user", app.id));
  const tile: MovedTile = {
    ...(e.displayName ? { displayName: e.displayName } : {}),
    ...(e.icon ? { icon: e.icon } : {}),
    ...(e.hue !== undefined ? { hue: e.hue } : {}),
    ...(e.pinned ? { pinned: true } : {}),
    ...(e.order !== undefined ? { order: e.order } : {}),
    ...(e.lastOpenedAt ? { lastOpenedAt: e.lastOpenedAt } : {}),
    ...(e.openCount ? { openCount: e.openCount } : {}),
  };
  return Object.keys(tile).length ? tile : undefined;
}

/** One app's snapshot: its SQLite bytes and what is in them. */
async function packApp(app: UserApp): Promise<{ bytes: Uint8Array; moved: MovedApp }> {
  const entities = await entitiesOf(app);
  const namespace = `user:${app.id}`;
  const snapshot = await createMemorySqliteStore(namespace);
  const opened: Store[] = [];
  const open = async (ns: string, sync: boolean): Promise<Store> => {
    const s = await openStore(ns, { sync });
    opened.push(s);
    return s;
  };
  try {
    const local = await open(namespace, false);
    const synced = Boolean(app.sync) && (await syncAllowedFor(app));
    let records = 0;
    let missingFiles = 0;
    if (synced) {
      await copyCode(local, snapshot.store);
      const space = await open(namespace, true);
      const copied = await copyStoreData(space, snapshot.store, { entities, skipFile: isReservedPath });
      records = copied.records;
      missingFiles = copied.skippedFiles.length;
      // The files it kept on this device only, because its space was full (device-files.tsx).
      await copyStoreData(await open(deviceFilesNamespace(app.id), false), snapshot.store, { entities: [] });
    } else {
      const copied = await copyStoreData(local, snapshot.store, { entities });
      records = copied.records;
      missingFiles = copied.skippedFiles.length;
    }
    const files = (await snapshot.store.listFiles()).filter((f) => !isReservedPath(f.path)).length;
    const example = exampleState(app);
    const tile = tileOf(app);
    const moved: MovedApp = {
      id: app.id,
      name: app.name,
      source: app.source,
      trusted: app.trusted !== false,
      ...(app.joined ? { joined: true } : {}),
      ...(app.link ? { link: app.link } : {}),
      ...(app.lock ? { lock: app.lock } : {}),
      ...(app.shipped?.length ? { shipped: app.shipped } : {}),
      ...(app.credit ? { credit: app.credit } : {}),
      ...(app.remixOf ? { remixOf: app.remixOf } : {}),
      wasShared: Boolean(app.sync),
      ...(example ? { example } : {}),
      entities,
      records,
      files,
      missingFiles,
      ...(tile ? { tile } : {}),
    };
    return { bytes: snapshot.export(), moved };
  } finally {
    snapshot.destroy();
    for (const s of opened) await s.close().catch(() => {});
  }
}

async function packShared(): Promise<{ shared: MoveArchive["shared"]; conversations: number }> {
  const shared: MoveArchive["shared"] = {};
  let conversations = 0;
  for (const name of SHARED_STORE_NAMES) {
    const { entity, owner } = SHARED_STORES[name];
    let store: Store | null = null;
    try {
      store = await openStore(name);
      const rows = (await store.all(entity)) as Array<Record<string, unknown>>;
      if (rows.length) shared[name] = rows;
      if (name === "studio-chat") conversations = new Set(rows.map((r) => r[owner])).size;
    } catch (e) {
      // A store that cannot be read is left behind, said in the console; the apps still move.
      console.warn(`[potyro] could not pack ${name} for the move:`, e);
    } finally {
      await store?.close().catch(() => {});
    }
  }
  return { shared, conversations };
}

function packPrefs(): Record<string, string> {
  const prefs: Record<string, string> = {};
  const ls = globalThis.localStorage;
  if (!ls) return prefs;
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i);
    if (!key || !isMovablePref(key)) continue;
    const value = ls.getItem(key);
    if (value != null) prefs[key] = value;
  }
  return prefs;
}

/**
 * Pack everything for the move.
 *
 * `withIdentity` carries who the person is — the window hand-over does, a saved file never does: a
 * file in Downloads holding the secret would let whoever finds it sign as them.
 */
export async function packEverything(opts: { from: string; withIdentity: boolean; onProgress?: (p: PackProgress) => void }): Promise<Packed> {
  const apps = listUserApps();
  const data = new Map<string, Uint8Array>();
  const moved: MovedApp[] = [];
  for (const [i, app] of apps.entries()) {
    opts.onProgress?.({ done: i + 1, total: apps.length, name: app.name });
    const packed = await packApp(app);
    data.set(app.id, packed.bytes);
    moved.push(packed.moved);
  }
  const { shared, conversations } = await packShared();
  const identity = opts.withIdentity ? await portableIdentity() : null;
  const manifest: MoveManifest = {
    format: MOVE_FORMAT,
    from: opts.from,
    createdAt: new Date().toISOString(),
    apps: moved,
    shared: Object.fromEntries(SHARED_STORE_NAMES.filter((n) => shared[n]?.length).map((n) => [n, shared[n]!.length])),
    conversations,
    prefs: packPrefs(),
    ...(identity ? { identity } : {}),
  };
  return { bytes: packMoveArchive({ manifest, data, shared }), manifest };
}
