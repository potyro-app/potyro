// Bringing a moved Potyro in, on the new site (docs/16 §Moving to a new home).
//
// Through the paths everything else uses: records, photos and files with `copyStoreData`, which keeps
// their ids, so this is a merge and never a second copy; apps through `saveUserApp`, so they are in
// History like any other; who you are through `adoptPortableIdentity`, which checks it first.
//
// Resumable by being idempotent: every write is an upsert by id, and where each app went is written
// down as soon as it is in (`potyro:move:received`), so a window closed halfway is finished by doing it
// again, and doing it again after it finished changes nothing that was not changed there since.

import { t } from "@lingui/core/macro";
import { copyStoreData, createMemorySqliteStore, isReservedPath, type Store } from "@potyro/store";
import { adoptPortableIdentity, type AdoptOutcome } from "@potyro/identity";
import { openStore } from "./open-store.js";
import { syncAllowedFor } from "./app-store.js";
import { getUserApp, listUserApps, saveUserApp } from "./user-apps.js";
import { appKey, getEntry, updateEntry } from "./launcher-store.js";
import { exampleState } from "./examples.js";
import { siteName } from "./move-origins.js";
import { APP_PREF_PREFIXES, SHARED_STORES, SHARED_STORE_NAMES, appIdOfPref, isMovablePref, type MoveArchive, type MovedApp, type MovedTile } from "./move-archive.js";
import { idMap, planMove, receivedKey, sourceHash, type AppPlan, type MoveVia, type Received, type TargetApp } from "./move-plan.js";

const RECEIVED = "potyro:move:received";
/** The last move that came in here: where from, when, and what it came to. */
export const LAST_MOVE = "potyro:move:last";

export interface BringInProgress {
  done: number;
  total: number;
  name: string;
}

export interface BringInResult {
  apps: number;
  records: number;
  files: number;
  /** What became of who you are. `none` when nothing came (a saved file never carries it). */
  identity: AdoptOutcome | "none";
  plans: AppPlan[];
  /** Apps that could not be brought in, by name, with the reason: never fatal to the rest. */
  failed: Array<{ name: string; reason: string }>;
}

function readReceived(): Record<string, Received> {
  try {
    const raw = globalThis.localStorage?.getItem(RECEIVED);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, Received>) : {};
  } catch {
    return {};
  }
}

function remember(from: string, appId: string, received: Received): void {
  globalThis.localStorage?.setItem(RECEIVED, JSON.stringify({ ...readReceived(), [receivedKey(from, appId)]: received }));
}

/** The apps here, as the plan needs to see them. */
function appsHere(): Map<string, TargetApp> {
  return new Map(listUserApps().map((a) => [a.id, { id: a.id, source: a.source, example: exampleState(a) }]));
}

/** What the move will do to each app, before anything is written — what the confirmation shows. */
export function previewPlans(archive: Pick<MoveArchive, "manifest">, via: MoveVia): AppPlan[] {
  return planMove(archive.manifest.apps, appsHere(), { via, from: archive.manifest.from, received: readReceived() });
}

/**
 * The rows of the stores that are the person's rather than one app's. An app that joins one already
 * here keeps its own history and conversation; the rest arrive under the id their app has here.
 * A conversation that never became an app (a Studio draft) comes as it is.
 */
async function bringInShared(archive: MoveArchive, plans: readonly AppPlan[]): Promise<void> {
  const ids = idMap(plans);
  const kept = new Set(plans.filter((p) => p.kind === "merge").map((p) => p.app.id));
  for (const name of SHARED_STORE_NAMES) {
    const rows = archive.shared[name];
    if (!rows?.length) continue;
    const { entity, owner } = SHARED_STORES[name];
    const store = await openStore(name);
    try {
      for (const row of rows) {
        const whose = row[owner] as string;
        if (kept.has(whose)) continue;
        const id = ids.get(whose);
        if (!id && name !== "studio-chat") continue; // history of an app that did not come
        await store.insert(entity, id ? { ...row, [owner]: id } : row);
      }
    } finally {
      await store.close().catch(() => {});
    }
  }
}

/** One app's records, files and code, into where it lives here. */
async function bringInData(plan: AppPlan, bytes: Uint8Array): Promise<{ records: number; files: number }> {
  const namespace = `user:${plan.id}`;
  const bundle = await createMemorySqliteStore(namespace, { bytes });
  const opened: Store[] = [];
  try {
    const existing = getUserApp(plan.id);
    // An app already here that syncs keeps its data in its space and its code on the device.
    const synced = existing ? await syncAllowedFor(existing) : false;
    const local = await openStore(namespace, { sync: false });
    opened.push(local);
    const target = synced ? await openStore(namespace, { sync: true }) : local;
    if (synced) opened.push(target);
    const keepCode = plan.kind === "merge";
    const copied = await copyStoreData(bundle.store, target, { entities: plan.app.entities, ...(keepCode || synced ? { skipFile: isReservedPath } : {}) });
    if (synced && !keepCode) await copyStoreData(bundle.store, local, { entities: [], skipFile: (p) => !isReservedPath(p) });
    return { records: copied.records, files: (await bundle.store.listFiles()).filter((f) => !isReservedPath(f.path)).length };
  } finally {
    bundle.destroy();
    for (const s of opened) await s.close().catch(() => {});
  }
}

async function bringInApp(plan: AppPlan, from: string, now: string): Promise<void> {
  if (plan.kind === "merge") return;
  const app = plan.app;
  const site = siteName(from);
  const original = app.name;
  await saveUserApp(
    {
      id: plan.id,
      name: plan.kind === "copy" ? t({ message: `${original} (from ${site})`, comment: "An app brought over from the old Potyro site, beside one of the same name here" }) : app.name,
      source: app.source,
      trusted: plan.trusted,
      // Its own copy here. An app already here that syncs goes on syncing.
      ...(plan.kind === "replace" ? {} : { sync: false }),
      ...(app.joined ? { joined: true } : {}),
      ...(app.link ? { link: app.link } : {}),
      ...(app.lock ? { lock: app.lock } : {}),
      ...(app.shipped ? { shipped: app.shipped } : {}),
      ...(app.credit ? { credit: app.credit } : {}),
      ...(app.remixOf ? { remixOf: app.remixOf } : {}),
      origin: "imported",
    },
    now,
  );
}

/** The tile as it was there, where nothing here says otherwise. */
function bringInTile(plan: AppPlan, tile: MovedTile | undefined): void {
  if (!tile) return;
  const key = appKey("user", plan.id);
  const here = getEntry(key);
  const patch: Partial<MovedTile> = {};
  for (const [k, v] of Object.entries(tile) as Array<[keyof MovedTile, MovedTile[keyof MovedTile]]>) {
    if (here[k] === undefined) (patch as Record<string, unknown>)[k] = v;
  }
  if (Object.keys(patch).length) updateEntry(key, patch);
}

/** Preferences, where this site has none of its own yet; an app's under the id it has here. */
function bringInPrefs(prefs: Record<string, string>, plans: readonly AppPlan[]): void {
  const ls = globalThis.localStorage;
  if (!ls) return;
  const ids = idMap(plans);
  for (const [key, value] of Object.entries(prefs)) {
    if (!isMovablePref(key)) continue;
    const owner = appIdOfPref(key);
    let target = key;
    if (owner) {
      const id = ids.get(owner);
      if (!id) continue;
      const prefix = APP_PREF_PREFIXES.find((pre) => key.startsWith(pre))!;
      target = `${prefix}${id}${key.slice(prefix.length + owner.length)}`;
    }
    if (ls.getItem(target) == null) ls.setItem(target, value);
  }
}

/** May a moved identity replace the one here? Only one nothing here is shared under. */
function identityHereUnused(): boolean {
  const origin = globalThis.localStorage?.getItem("potyro:identity:origin");
  if (origin && origin !== "minted") return false;
  return !listUserApps().some((a) => a.sync || a.joined);
}

/** Bring everything in. Apps one at a time, each finished and written down before the next. */
export async function bringInEverything(
  archive: MoveArchive,
  opts: { via: MoveVia; onProgress?: (p: BringInProgress) => void },
): Promise<BringInResult> {
  const { manifest } = archive;
  const now = new Date().toISOString();
  const plans = previewPlans(archive, opts.via);
  const result: BringInResult = { apps: 0, records: 0, files: 0, identity: "none", plans, failed: [] };

  // Who you are first: the apps' records name the person who made them, and they should be this one.
  if (manifest.identity && opts.via === "window") {
    try {
      result.identity = await adoptPortableIdentity(manifest.identity, { replaceOwn: identityHereUnused() });
    } catch (e) {
      result.failed.push({ name: t`Who you are`, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  await bringInShared(archive, plans);

  const failedIds = new Set<string>();
  for (const [i, plan] of plans.entries()) {
    opts.onProgress?.({ done: i + 1, total: plans.length, name: plan.app.name });
    try {
      const got = await bringInData(plan, archive.data.get(plan.app.id)!);
      await bringInApp(plan, manifest.from, now);
      bringInTile(plan, plan.app.tile);
      remember(manifest.from, plan.app.id, { id: plan.id, sourceHash: sourceHash(getUserApp(plan.id)?.source ?? plan.app.source) });
      result.apps += 1;
      result.records += got.records;
      result.files += got.files;
    } catch (e) {
      failedIds.add(plan.app.id);
      result.failed.push({ name: plan.app.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  bringInPrefs(manifest.prefs, plans.filter((p) => !failedIds.has(p.app.id)));
  globalThis.localStorage?.setItem(
    LAST_MOVE,
    JSON.stringify({ from: manifest.from, at: now, apps: result.apps, records: result.records, files: result.files }),
  );
  return result;
}

/** Re-exported for the page: what an app's arrival will look like. */
export type { AppPlan, MovedApp };
