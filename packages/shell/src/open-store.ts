// Durable store opener, shared by the boot composition root and the Studio runner.
//
// Two paths, chosen per app (ADR 0001 D3 — sync is opt-in, not a property of the product):
//
//   sync OFF (default)  SqliteStore over OPFS (KA-01), falling back to LocalStore where OPFS is
//                       unavailable. No network, no identity, no cojson. This keeps docs/01's
//                       "no server requirement" literally true for every app that hasn't asked
//                       for sync.
//   sync ON             JazzStore — CRDT-backed, durable on cojson's own OPFS SQLite file, with
//                       per-field merge across devices (KA-08). Still no network until a relay
//                       peer is attached; a solo synced app is just a space with one member.
//
// Firefox (and headless Chrome) lack the OPFS sync-access-handle pool the SAH VFS needs, so they
// take the LocalStore path by design — that's expected, not an error. A sync-enabled app cannot
// degrade that way, because LocalStore has no CRDT: rather than silently drop the guarantee the
// user switched on, it fails loudly and the caller decides.

import { createSqliteStore, LocalStore, type Store } from "@karta/store";

/**
 * The handle from the most recent synced `openStore`, so the composition root can read the space
 * (`ctx.space`) without the shell importing cojson.
 *
 * A module-level value rather than a return field because `openStore` is the seam every caller uses
 * and its `Store` return type is deliberately engine-free — widening it would leak Jazz into every
 * call site for the benefit of one. Read immediately after the call that set it.
 */
let lastSyncHandle: Awaited<ReturnType<typeof import("@karta/store").openJazzStore>> | null = null;

type SpaceShape = {
  id: string;
  role: "admin" | "writer" | "reader";
  members: Array<{ id: string; name: string; role: "admin" | "writer" | "reader" }>;
};

/**
 * The last space read, kept current.
 *
 * `ctx.space` used to be a value captured at boot, so an app opened before someone joined listed
 * only the people who were there then — and every later edit of theirs rendered as an account id.
 * This cache is refreshed whenever the GROUP changes (a join, a role change), and `liveSpace()`
 * hands out the current contents, so each evaluation pass sees the membership as it is now.
 */
let cachedSpace: SpaceShape | null = null;
let stopWatchingSpace: (() => void) | null = null;
/**
 * Told when membership actually changed.
 *
 * Separate from the cache because the runtime is composed AFTER the space is first read, so the
 * thing that wants to know does not exist yet at that point.
 */
const spaceListeners = new Set<() => void>();

/** Be told when this app's membership changes. Returns an unsubscribe. */
export function onSpaceChange(cb: () => void): () => void {
  spaceListeners.add(cb);
  return () => spaceListeners.delete(cb);
}

/** Synchronous, for `ctx` — app code reads `ctx.space.members` inline and cannot await. */
export function liveSpace(): SpaceShape | undefined {
  return cachedSpace ?? undefined;
}

/**
 * Start keeping `liveSpace()` up to date for the app just opened.
 *
 * Reads once, then re-reads on every group change. Nothing polls: a group is a CoValue and this is
 * its own subscription.
 */
export async function watchSpace(): Promise<void> {
  stopWatchingSpace?.();
  stopWatchingSpace = null;
  cachedSpace = null;

  const handle = lastSyncHandle;
  if (!handle) return;

  const refresh = async (notify: boolean): Promise<void> => {
    const next = await currentSpace().catch(() => null);
    if (!next) return;
    // Only when it really changed: a group CoValue fires for role changes and key rotations too, and
    // re-rendering every view on each of those would be noise dressed as reactivity.
    const changed = JSON.stringify(next.members) !== JSON.stringify(cachedSpace?.members);
    cachedSpace = next;
    if (notify && changed) for (const cb of spaceListeners) cb();
  };
  await refresh(false);

  const { subscribeSpace } = await import("@karta/store");
  stopWatchingSpace = subscribeSpace(handle, () => void refresh(true));
}

/**
 * Push a new display name to the app that is open, if one is synced.
 *
 * A name is published on every open, so it would reach people eventually — but "eventually" here
 * means the next reload, and someone who has just renamed themselves is usually looking at a screen
 * with their old name on it. No-op when nothing is synced: there is nobody to tell.
 */
export async function republishName(name: string): Promise<void> {
  const handle = lastSyncHandle;
  if (!handle) return;
  const { publishName } = await import("@karta/store");
  await publishName(handle, name);
}

/** The space of the app just opened with `{ sync: true }`, or null. See `lastSyncHandle`. */
export async function currentSpace(): Promise<
  { id: string; role: "admin" | "writer" | "reader"; members: Array<{ id: string; name: string; role: "admin" | "writer" | "reader" }> } | null
> {
  const handle = lastSyncHandle;
  if (!handle) return null;
  const { spaceMembers, myRole } = await import("@karta/store");
  const raw = await spaceMembers(handle);
  return {
    id: handle.groupID,
    role: myRole(handle) ?? "reader",
    // A name that has not synced yet shows as the id rather than blanking the person — you can
    // still tell two people apart, which is what the chip is for.
    members: raw.map((m) => ({ id: m.id, name: m.name ?? m.id.slice(0, 10), role: m.role })),
  };
}

export interface OpenStoreOpts {
  /** Opt this app into the CRDT store. Off = today's behaviour, byte for byte. */
  sync?: boolean;
}

/**
 * Sync relay URL, or null for local-only.
 *
 * Read from `localStorage` so a self-hoster can point Karta at their own `jazz-run sync` without a
 * rebuild — the free self-host escape hatch the ethos requires (business plan §8.4). Absent by
 * default: a synced app with no relay is still useful (durable, CRDT, ready for a peer) and opens
 * no socket at all.
 */
export function syncRelayUrl(): string | undefined {
  const configured = globalThis.localStorage?.getItem("karta:sync:relay");
  if (configured) return configured;
  // `pnpm dev` starts a relay alongside the shell, so sync works with ZERO configuration while
  // developing. Without this default, turning sync on appeared to do nothing until you knew to
  // set a URL by hand — which is not a feature anyone can test.
  if (import.meta.env?.DEV) return "ws://localhost:4201";
  return undefined;
}

/**
 * Whether this browser can run the CRDT store at all.
 *
 * `openJazzStore` needs the OPFS sync-access-handle pool. Firefox and Safari do not have it, and
 * without this check they got a raw `Missing required OPFS APIs` from deep inside sqlite-wasm.
 * Callers use it to say something true instead.
 */
export function canSync(): boolean {
  // OPFS is preferred but no longer required: the store falls back to an IndexedDB-backed SQLite.
  // The previous check demanded `createSyncAccessHandle`, which is worker-only in many Chrome
  // contexts — so it reported "unsupported" in browsers that could in fact sync perfectly well.
  return typeof indexedDB !== "undefined";
}

export const CANNOT_SYNC_MESSAGE = "Sync needs IndexedDB, which this browser has disabled or blocked.";

export async function openStore(namespace: string, opts?: OpenStoreOpts): Promise<Store> {
  if (opts?.sync) {
    // Deliberately NOT wrapped in a fallback. Falling back to a non-CRDT store would look like it
    // worked and then lose a peer's concurrent edits — the exact failure the engine was chosen to
    // prevent. A clear error beats silent divergence.
    // Imported lazily so the default (non-sync) path never pays for the CRDT engine — the same
    // treatment the SQLite engine and MapLibre already get. The shell deliberately does not import
    // cojson itself: the engine stays behind the store seam.
    // The account comes from `@karta/identity`, never from the store (ADR D2 amended). Identity is
    // minted with crypto alone, so it already exists here whether or not this device has ever
    // synced — and `ctx.me` therefore names the same person before and after sync is switched on.
    // An id that changed on toggle would orphan every `createdBy` already stamped.
    const [{ openJazzStore }, identity] = await Promise.all([
      import("@karta/store"),
      import("@karta/identity"),
    ]);
    // Awaited before the name is read, not inline: `identityAccount()` mints the identity on a
    // device that has never had one, and `peekIdentity()` answers null until it has.
    const account = await identity.identityAccount();
    const handle = await openJazzStore(namespace, {
      relay: syncRelayUrl(),
      account,
      // Your display name, so peers see a person rather than a truncated account id. Passed on
      // EVERY open, because renaming yourself must reach people you already share with.
      profileName: identity.peekIdentity()?.name,
    });
    lastSyncHandle = handle;
    return handle.store;
  }

  try {
    return await createSqliteStore(namespace);
  } catch {
    // Expected on Firefox / no-OPFS browsers — data still persists via localStorage.
    console.info(`[karta] Using local storage for "${namespace}" (OPFS SQLite unavailable in this browser).`);
    const store = new LocalStore();
    await store.open(namespace);
    return store;
  }
}
