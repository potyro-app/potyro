// Syncing the APP ITSELF, not just its data (KA-22, follow-up to the share link).
//
// The share link carries a snapshot of the source, so once sent it never changes: the author edits
// their copy and the guest keeps running the old one. Worse than stale UI — if the edit changed
// entities or fields, the guest's app quietly misreads records written by the new one.
//
// The source rides in the space's `kv`, which is already a CoMap in the shared root, so it
// replicates through the same channel as the data with no new machinery.
//
// ## Direction is decided by timestamp, not by who opened the app
//
// The naive version — "publish whenever my copy differs" — loses data: a guest who DECLINES an
// update would then publish their older source right back over the author's. Each side only
// publishes when its own copy is strictly newer, so declining is a no-op rather than a rollback.
//
// ## Updating is never silent
//
// Accepting an update replaces code that runs on this device. Even sandboxed that deserves a
// prompt, and the new version is written through `saveUserApp` so it lands in History and can be
// rolled back like any other edit.

import { readCarriedCode, sameCode, type AppLock, type Store } from "@potyro/store";

const KEY = "__appSource";

export interface PublishedApp {
  source: string;
  name: string;
  /** ISO. The `UserApp.updatedAt` of the copy that published it. */
  updatedAt: string;
  /** The app's declared `schemaVersion`. Drives the read-only gate (KA-22). */
  schemaVersion?: number;
  /**
   * What was ASKED FOR, and what the agent said it did — carried with the source.
   *
   * Without these, an update adopted from a collaborator landed in History as the bare string
   * "updated by a collaborator": the app changed under you and the record of WHY existed only on the
   * device that made the change. History's whole purpose is answering "what happened to my app", and
   * on every device but one it could not.
   *
   * They describe a change to code that is already shared with these exact people, so nothing
   * private is newly exposed by sending them — the source itself is the more revealing half, and it
   * has always crossed.
   */
  note?: string;
  rationale?: string;
  /**
   * The app's code beyond `source` (#281): its lock, and its own modules as text — `carried-code.ts`
   * in the store says why those travel and library bytes do not. Absent from a copy published before
   * they travelled; such a copy reads as an app with no code beyond its source.
   */
  lock?: AppLock;
  modules?: Record<string, string>;
}

/**
 * Read `schemaVersion` straight out of the source text.
 *
 * Deliberately a regex rather than an evaluation: this runs before the app is loaded, on source
 * that may have come from someone else, and the whole point of the gate is to decide whether that
 * code is safe to run against our data. Executing it to find out would defeat the exercise.
 * Unreadable → `undefined`, and the gate stays open rather than locking someone out on a guess.
 */
export function schemaVersionOf(source: string): number | undefined {
  const m = /schemaVersion\s*:\s*(\d+)/.exec(source);
  return m ? Number(m[1]) : undefined;
}

/**
 * Is this device's copy behind the schema the space is now written with?
 *
 * Behind means: do not write. An old schema writing into the shared document produces records the
 * current app does not expect, and every peer replicates them.
 */
export function isSchemaBehind(local: PublishedApp, published: PublishedApp | null): boolean {
  const mine = local.schemaVersion ?? schemaVersionOf(local.source);
  const theirs = published?.schemaVersion ?? (published ? schemaVersionOf(published.source) : undefined);
  if (mine == null || theirs == null) return false; // unknown: do not lock anyone out
  return theirs > mine;
}

export async function readPublishedApp(store: Store): Promise<PublishedApp | null> {
  try {
    const raw = await store.kvGet(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PublishedApp;
    if (typeof parsed?.source !== "string" || typeof parsed?.updatedAt !== "string") return null;
    // Read leniently: a broken lock is dropped, never the app it came with.
    const app: PublishedApp = { ...parsed };
    delete app.lock;
    delete app.modules;
    return { ...app, ...readCarriedCode(parsed as unknown as Record<string, unknown>) };
  } catch {
    // A corrupt entry must not stop the app from opening.
    return null;
  }
}

/** Publish this device's copy if it is strictly newer than what the space holds. */
export async function publishAppSource(store: Store, app: PublishedApp): Promise<boolean> {
  const published = await readPublishedApp(store);
  if (published && published.updatedAt >= app.updatedAt) return false;
  await store.kvSet(KEY, JSON.stringify(app));
  return true;
}

/**
 * Whether `app`, as read from the space, was published by this person's own account (another of
 * their devices) rather than by someone they share the app with.
 *
 * Asked of the store's signed log, then the published copy is read AGAIN and compared: a version
 * written by someone else between the two reads must not borrow the answer given for ours.
 */
export async function publishedByOwnAccount(store: Store, app: PublishedApp): Promise<boolean> {
  try {
    if ((await store.kvOwn?.(KEY)) !== true) return false;
    const now = await readPublishedApp(store);
    return now?.source === app.source && now.updatedAt === app.updatedAt;
  } catch {
    return false;
  }
}

/** The space's copy, when it is newer than this device's and actually different. */
export async function pendingAppUpdate(store: Store, local: PublishedApp): Promise<PublishedApp | null> {
  const published = await readPublishedApp(store);
  if (!published) return null;
  if (published.updatedAt <= local.updatedAt) return null;
  if (published.source !== local.source) return published;
  // The same source with different libraries is an update too (a library upgrade changes no line of
  // the source). A copy published without a lock says nothing about its libraries: not an update.
  return published.lock && !sameCode(published.lock, local.lock) ? published : null;
}
