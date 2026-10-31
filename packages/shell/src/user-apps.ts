// "My Apps" registry — the apps a user has generated, edited, or imported, persisted locally so they
// survive reloads and can be re-opened and used (not just previewed once). This is the local library
// behind the Studio; a shared/community registry (KA-10) is a separate, later layer.
//
// Storage: a single localStorage key holding a JSON array. The app *source* lives here; each app's
// *data* lives in its own durable store namespaced `user:<id>` (see open-store.ts). Immutable ops.
//
// Every source change is also appended to the app's history (app-history.ts) so an AI edit can be
// reviewed and rolled back. That happens inside `saveUserApp` on purpose: it is the only path that
// writes source, so no caller can quietly skip the audit trail.

import { t } from "@lingui/core/macro";
import { clearHistory, recordVersion, type VersionOrigin } from "./app-history.js";
import { clearDiagnoses } from "./app-diagnoses.js";
import { clearCases } from "./app-cases.js";
import { clearChat } from "./studio-chat.js";
import { backupEnabled } from "./backup-setting.js";
import { libraryLock, lockJson, parseLock, type AppCredit, type AppLock } from "@potyro/store";
import { newLine } from "./app-line.js";
import { sameSeed, seedThatFits, type Entities as SeedEntities } from "./app-seed.js";

const KEY = "potyro:user-apps";
/** Dispatched on `globalThis` after every write, so a launcher on screen can follow along (#81). */
export const USER_APPS_CHANGED = "potyro:user-apps:changed";

export interface UserApp {
  id: string;
  name: string;
  source: string;
  updatedAt: string; // ISO
  /** Runs directly (trusted) rather than in the isolate. Apps authored in the Studio are the user's
   *  own, so this defaults to TRUE; an app that arrived from someone else is saved with
   *  `trusted: false` and must be promoted explicitly. */
  trusted?: boolean;
  /** Opt this app into the CRDT store (ADR 0001 D3). Off by default: sync is a choice the user
   *  makes per app, not a property of the product. Flipping it changes which `Store` the
   *  composition root opens, and the two stores hold data in different files — so a flip does NOT
   *  migrate existing records. See `setUserAppSync`. */
  sync?: boolean;
  /** Where the app was installed from, when that was a link (#253): what "check for updates" asks. */
  link?: string;
  /**
   * This app's data lives in a space that came from ELSEWHERE — someone's invite, or this user's own
   * account on another device — rather than one this device created.
   *
   * It exists to stop the first-run seeder writing into it. The seeders are keyed on the app id, so
   * a guest who joined "split" ran `seedSplit` against the space they had just joined: if the
   * owner's records had not replicated in that instant the store looked empty, and a rival "Flat"
   * group was written into someone else's app. Both people then saw only their own rows, because
   * Split scopes every view by the selected group — while the chat, which is one unscoped thread,
   * worked perfectly and made it look like a sync bug.
   */
  joined?: boolean;
  /**
   * What the app's code is made of beyond `source` (#266, #258): each library it imports by URL and
   * each of its package's own modules, by the file in its space that holds it and that file's digest.
   * The bundler runs nothing that does not match. It lives HERE, beside the source, rather than in
   * the app's file space, because that space syncs: someone sharing the app must not be able to
   * change code that runs on this device by changing a file.
   */
  lock?: AppLock;
  /**
   * The files its package shipped into its folder (`levels.json`), by path — the person's files, not
   * its code. Opening the app checks they are there: an app missing a file it shipped with is told
   * apart from an app with a bug, and can get the file back from its package.
   */
  shipped?: string[];
  /**
   * Who made it, when it came from someone who said (docs/24 §6): a kept demo, an added package. Said
   * on, and passed on with, a link to it — so sharing someone's app on does not claim it.
   */
  credit?: AppCredit;
  /** The app this one is a remix of, and who made that (docs/24 §6). Passed on when it is shared. */
  remixOf?: AppCredit;
  /**
   * Which app this is across devices (docs/24 §11): every copy of it has the same line, so a link one
   * person makes opens the other's copy. Absent: it is known by its declared `id` (`id:<id>`), as an
   * example or an app that arrived from a package that did not say. An app made here, a duplicate and
   * a remix get one of their own (`newLine`).
   */
  line?: string;
  /** A remix's: the line of the app it remixed, so a link to that app opens the remix when it is all there is. */
  lineOf?: string;
  /**
   * The sample records its package came with (`seed.json`, #253), or, for an app made in the Studio,
   * the ones its run check passed on (#486): the app's own demo data, never the person's. Kept so a
   * demo link of it opens on them, as the package did (docs/24 §3), and so a package saved from it
   * carries them. Only a small one is kept (`MAX_KEPT_SEED`): this record lives in the device's settings.
   */
  seed?: Record<string, Array<Record<string, unknown>>>;
}

/** The largest package seed kept beside an app, as JSON: a demo link has to carry it. */
export const MAX_KEPT_SEED = 64 * 1024;

/** A package's seed, when it is worth keeping beside its app: rows in it, and small enough. */
export function seedToKeep(seed: UserApp["seed"]): UserApp["seed"] {
  if (!seed || !Object.values(seed).some((rows) => rows.length > 0)) return undefined;
  return JSON.stringify(seed).length <= MAX_KEPT_SEED ? seed : undefined;
}

function read(): UserApp[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Records written before trust defaulted to true have `trusted: undefined`. They are all
    // Studio-authored (nothing else writes here yet), so read them as the user's own rather than
    // stranding them in the isolate — where their custom views would render blank.
    return (parsed as UserApp[])
      .filter((a) => a && a.id && a.source)
      .map((a) => (a.trusted === undefined ? { ...a, trusted: true } : a));
  } catch {
    return [];
  }
}

function write(apps: UserApp[]): void {
  globalThis.localStorage?.setItem(KEY, JSON.stringify(apps));
  if (typeof globalThis.dispatchEvent === "function" && typeof Event === "function") globalThis.dispatchEvent(new Event(USER_APPS_CHANGED));
}

function slug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return base || "app";
}

/** All saved apps, most-recently-updated first. */
export function listUserApps(): UserApp[] {
  return read().slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** Whether an app's code includes modules of its own (`src/<path>` in its lock), beyond its source. */
export const hasOwnModules = (lock: AppLock | undefined): boolean => Object.keys(lock ?? {}).some((key) => key.startsWith("src/"));

export function getUserApp(id: string): UserApp | undefined {
  return read().find((a) => a.id === id);
}

/** Create or update a saved app. A new app gets a unique id derived from its name; passing an
 *  existing `id` updates that app in place. Returns the stored record.
 *
 *  Async because it also appends to the app's history. Callers that reload the page afterwards
 *  (Edit mode does) must await it — a reload mid-write loses the version. `origin` and `note` say
 *  where the new source came from; they are what the History panel shows next to each version. */
export async function saveUserApp(
  input: {
    id?: string;
    name: string;
    source: string;
    trusted?: boolean;
    sync?: boolean;
    joined?: boolean;
    link?: string;
    lock?: AppLock;
    shipped?: string[];
    credit?: AppCredit;
    remixOf?: AppCredit;
    line?: string;
    lineOf?: string;
    /** `null` takes the seed away (none of its rows fits the app any more); absent keeps it. */
    seed?: UserApp["seed"] | null;
    origin?: VersionOrigin;
    note?: string;
    rationale?: string;
    /**
     * The app's own modules as text, when the caller has them and they are not on this device yet (a
     * package being installed). Left out, they are read from this device as the saved lock names them.
     */
    modules?: Record<string, string>;
  },
  now: string,
): Promise<UserApp> {
  const apps = read();
  const name = input.name.trim() || t({ message: "Untitled app", comment: "The name an app gets when it was given none" });
  let id = input.id;
  if (!id) {
    const base = slug(name);
    id = base;
    let n = 2;
    const taken = new Set(apps.map((a) => a.id));
    while (taken.has(id)) id = `${base}-${n++}`;
  }
  // An app authored here is the USER'S OWN, so it is trusted by default (CLAUDE.md rule 3:
  // provenance decides execution; trusted = user's own → direct). The isolate exists for code that
  // arrived from someone else — an importer passes `trusted: false` explicitly. Editing your own app
  // does NOT demote it; you are still the author.
  const prev = apps.find((a) => a.id === id);
  const trusted = input.trusted ?? prev?.trusted ?? true;
  // `sync` is carried over explicitly: this function REBUILDS the record, so any field not listed
  // here is silently dropped. Losing it would switch an app back to the non-CRDT store on the next
  // edit and open it empty — indistinguishable from data loss.
  // `sync` is carried over unless the caller says otherwise. Saying otherwise matters for an app
  // arriving from your account: it is synced BECAUSE that is where its data is, and setting the flag
  // in a second call afterwards puts it behind this function's history write — which is a write to
  // another database, and an app that never got the flag opens the empty local copy instead.
  // A NEW app on a device that backs everything up is backed up too. A switch that covered only
  // what existed when it was flipped would quietly stop being true, and the app you write tomorrow
  // is exactly the one you would miss when the laptop dies.
  const backedUpByDefault = !prev && backupEnabled();
  // History keeps the app's own modules with each version (#448): the device holds only the current
  // ones. Read here, before the record changes, the modules the app had: the "before" when history is
  // empty. `app-modules` imports this file, so it is loaded when an app has modules, not at the top.
  const ownModules = async (lock: AppLock | undefined) =>
    hasOwnModules(lock) ? (await import("./app-modules.js")).ownModuleTexts(id!, lock) : undefined;
  const baselineModules = await ownModules(prev?.lock);
  const record: UserApp = {
    id,
    name,
    source: input.source,
    updatedAt: now,
    trusted,
    sync: input.sync ?? prev?.sync ?? (backedUpByDefault || undefined),
    // Carried like `sync`, and for the same reason: this function REBUILDS the record, so a field
    // left out is dropped — and an app that forgot it had joined someone's space would be seeded
    // into that space on its next open.
    joined: input.joined ?? prev?.joined,
    // Carried for the same reason: a link the app came from is how it can be updated later.
    link: input.link ?? prev?.link,
    // Carried too: an edit to the source must not cut the app off from the libraries it imports.
    lock: input.lock ?? prev?.lock,
    // And what it shipped with: an edit of the source does not take its files away.
    shipped: input.shipped ?? prev?.shipped,
    // And who made it: an edit does not change whose app it was, or what it remixed.
    credit: input.credit ?? prev?.credit,
    remixOf: input.remixOf ?? prev?.remixOf,
    // And which app it is: an edit is the same app, so links to it keep opening it.
    line: prev?.line ?? input.line,
    lineOf: prev?.lineOf ?? input.lineOf,
    // And the sample records its package came with: a demo of it still opens on them.
    seed: input.seed === null ? undefined : (input.seed ?? prev?.seed),
  };
  write([record, ...apps.filter((a) => a.id !== id)]);
  const modules = hasOwnModules(record.lock) ? (input.modules ?? (await ownModules(record.lock))) : undefined;
  // `prev?.source` is the baseline: for an app that predates history, it becomes the "before" the
  // first diff needs. A brand-new app has none — its first version IS the creation.
  await recordVersion(
    id,
    {
      source: input.source,
      origin: input.origin ?? (prev ? "edited" : "created"),
      note: input.note,
      rationale: input.rationale,
      baseline: prev?.source,
      // Which bytes its libraries are: an upgrade is a version even when no line of source changed.
      lock: lockJson(record.lock),
      baselineLock: lockJson(prev?.lock),
      modules,
      baselineModules,
    },
    now,
  );
  return record;
}

/**
 * The lock to put back with a version from History: the libraries that version ran with, and the
 * app's own modules as they are now — History keeps the entry source, not the package's other files
 * (#258). The libraries the app has now stay too, under the version's: those modules are the current
 * ones, and may import a library the version never did; without it the restored app would not open.
 * Their bytes are still on the device (an update never removes `.modules/`), so this needs no network.
 */
export function lockToRestore(version: { lock?: string }, app: Pick<UserApp, "lock">): AppLock | undefined {
  const own = app.lock ?? {};
  let libraries: AppLock = {};
  try {
    libraries = version.lock ? parseLock(version.lock) : {};
  } catch {
    libraries = libraryLock(app.lock ?? {});
  }
  const lock = { ...own, ...libraries };
  return Object.keys(lock).length ? lock : app.lock && Object.keys(app.lock).length ? {} : undefined;
}

export async function removeUserApp(id: string): Promise<void> {
  write(read().filter((a) => a.id !== id));
  await clearHistory(id);
  await clearDiagnoses(id);
  // Ids are name slugs (see `slug` above), so a deleted app's id can be reused by an unrelated app
  // created later. Without this, that new app would silently inherit the dead app's cases.
  await clearCases(id);
  // And for the same reason its conversation: the next app called this must start its own.
  await clearChat(id);
}

/**
 * Replace an app's sample records (#486): what fits it after it changed (app-seed.ts). Not a new
 * version of the app: the source is the same, so it keeps its `updatedAt`.
 */
export function setUserAppSeed(id: string, seed: UserApp["seed"]): void {
  write(read().map((a) => (a.id === id ? { ...a, seed: seedToKeep(seed) } : a)));
}

/**
 * Fit a saved app's seed to the app as it now loads (#486): run where its definition is at hand — the
 * app opening, a version put back from History — so a change made anywhere (an edit, a fix, a version
 * restored, a newer copy synced in) cannot leave a demo link opening on rows that no longer fit.
 * Writes only when a row was dropped. Never adds one, and never reads the app's records.
 */
export function refitSeed(appId: string, entities: SeedEntities): void {
  const app = getUserApp(appId);
  if (!app?.seed || !entities) return;
  const fitted = seedThatFits(app.seed, entities);
  if (!sameSeed(fitted, app.seed)) setUserAppSeed(appId, fitted);
}

/** Record the files an app's package shipped (see `UserApp.shipped`). Not a new version of the app. */
export function setUserAppShipped(id: string, shipped: string[]): void {
  write(read().map((a) => (a.id === id ? { ...a, shipped: shipped.length ? shipped : undefined } : a)));
}

/** Promote/demote a saved app's trust. Trusted apps run directly (not in the isolate). */
export function setUserAppTrusted(id: string, trusted: boolean, now: string): void {
  write(read().map((a) => (a.id === id ? { ...a, trusted, updatedAt: now } : a)));
}

/**
 * Record the lock an app's libraries were fetched under on THIS device (#281) — an app that arrived
 * without one, or whose libraries this device locked afresh. Not a new version of the app: it keeps
 * its `updatedAt`, so this copy does not start looking newer than the one it was shared from.
 */
export function setUserAppLock(id: string, lock: AppLock | undefined): void {
  write(read().map((a) => (a.id === id ? { ...a, lock } : a)));
}

/** Turn the CRDT store on or off for an app.
 *
 *  NOTE: SqliteStore and JazzStore keep their data in separate files, so this does not move
 *  existing records — an app switched on will open empty until data is migrated across. Callers
 *  must warn before flipping it; silently showing an empty app reads as data loss. Migrating the
 *  rows across is tracked with KA-08's remaining work. */
export function setUserAppSync(id: string, sync: boolean, now: string): void {
  write(read().map((a) => (a.id === id ? { ...a, sync, updatedAt: now } : a)));
}

/**
 * An id nothing on this device is using, derived from a name.
 *
 * Exported because joining a space has to know the id BEFORE it joins — the space is remembered
 * under `user:<id>`, so the decision cannot wait until the record is saved.
 */
export function freeAppId(name: string): string {
  const base = slug(name) || "app";
  const taken = new Set(read().map((a) => a.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * A second app with the same source, under a new id — the fork that had to be done by hand.
 *
 * The copy starts EMPTY. Duplicating is how you take an app someone sent you and make it yours to
 * fill in; carrying their records across is a different thing, and a slow one for an app with
 * photos in it.
 *
 * Trust is NOT granted here (CLAUDE.md rule 3: provenance decides execution). Copying someone
 * else's code does not make it yours to run with ambient authority — the copy keeps running in the
 * isolate until it is promoted deliberately, exactly as the original did. Neither does the copy
 * inherit `sync` or `joined`: it is a new app on this device, in nobody's space.
 */
export async function duplicateUserApp(id: string, now: string): Promise<UserApp | null> {
  const app = read().find((a) => a.id === id);
  if (!app) return null;
  const original = app.name;
  const name = t({ message: `${original} (copy)`, comment: "The name of a duplicated app" });
  return saveUserApp(
    // The lock is the code's, not the data's: the copy runs the same libraries (`duplicateApp` copies their files).
    // A copy is another app from now on: links to the original keep opening the original.
    { id: freeAppId(name), name, source: app.source, trusted: app.trusted, lock: app.lock, line: newLine(), origin: "created", note: `copied from “${original}”` /* English on purpose: SYSTEM_NOTES matches it */ },
    now,
  );
}

/** Rename a saved app in place (keeps its id, source, and data namespace). */
export function renameUserApp(id: string, name: string, now: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  write(read().map((a) => (a.id === id ? { ...a, name: trimmed, updatedAt: now } : a)));
}
