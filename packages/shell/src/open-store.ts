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
 * Reads once, then re-reads on every group change AND on every member rename. Nothing polls: both
 * are CoValues and these are their own subscriptions.
 *
 * TWO subscriptions, because there are two CoValues and watching only one was a bug people saw.
 * The group fires on a join or a role change; a rename writes to that person's account profile,
 * which the group does not contain — so a peer who renamed themselves stayed "Me" on your screen
 * until you reloaded, which is exactly when chat made it obvious.
 */
export async function watchSpace(): Promise<void> {
  stopWatchingSpace?.();
  stopWatchingSpace = null;
  cachedSpace = null;

  const handle = lastSyncHandle;
  if (!handle) return;

  const { subscribeSpace, subscribeMemberProfiles } = await import("@karta/store");

  let stopProfiles: (() => void) | null = null;
  /** Whose profiles are currently watched, so the set is only rebuilt when the PEOPLE change. */
  let watching = "";

  const rewatchProfiles = async (next: { members: Array<{ id: string }> }): Promise<void> => {
    const ids = next.members.map((m) => m.id).sort().join(",");
    // Only when the membership itself changed. A rename fires these subscriptions, and tearing them
    // down and rebuilding them inside their own callback would churn on every keystroke-sized edit.
    if (ids === watching) return;
    watching = ids;
    stopProfiles?.();
    stopProfiles = await subscribeMemberProfiles(handle, () => void refresh(true));
  };

  const refresh = async (notify: boolean): Promise<void> => {
    const next = await currentSpace().catch(() => null);
    if (!next) return;
    // Only when it really changed: a group CoValue fires for role changes and key rotations too, and
    // re-rendering every view on each of those would be noise dressed as reactivity.
    const changed = JSON.stringify(next.members) !== JSON.stringify(cachedSpace?.members);
    cachedSpace = next;
    await rewatchProfiles(next);
    if (notify && changed) for (const cb of spaceListeners) cb();
  };
  await refresh(false);

  const stopGroup = subscribeSpace(handle, () => void refresh(true));
  stopWatchingSpace = () => {
    stopGroup();
    stopProfiles?.();
  };
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

/**
 * Remove a person from the open app's space (#58). Refused unless this device is the admin. Revokes
 * outstanding invites too, so a link shared before stops working. See `removeSpaceMember`.
 */
export async function removeMember(accountId: string): Promise<{ invitesRevoked: number }> {
  const handle = lastSyncHandle;
  if (!handle) throw new Error("This app is not shared.");
  const { removeSpaceMember } = await import("@karta/store");
  const result = removeSpaceMember(handle, accountId);
  await handle.whenDurable();
  return result;
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

/** Where a device's own choice of relay is kept. Exported so the settings UI writes the same key. */
export const RELAY_KEY = "karta:sync:relay";

/**
 * Sync relay URL, or undefined for local-only.
 *
 * Four sources, most specific first (KA-28):
 *
 *   1. **This device's setting.** `localStorage`, written by the ⌾ You panel. "Bring your own relay"
 *      is the free self-host escape hatch the ethos promises (business plan §8.4), and it must not
 *      require a rebuild.
 *   2. **A build-time default**, `VITE_KARTA_RELAY`, for a deployment that puts its relay elsewhere.
 *   3. **`ws://localhost:4201` in dev**, because `pnpm dev` starts one alongside the shell. Without
 *      it, turning sync on appeared to do nothing until you knew to set a key by hand.
 *   4. **Same origin, `/sync`.** A deployment that terminates TLS and proxies that path gets working
 *      sync by deploying, with no build flag at all.
 *
 * (4) is what made this worth changing. A production build previously returned `undefined` here, so
 * every deployed app was local-only and the only way to say otherwise was typing a `localStorage`
 * key into devtools — on every device, for every person. Sync could not be tried on a domain at all.
 *
 * An unreachable relay is not a failure: `JazzStore` is durable on its own, the socket retries, and
 * the app works throughout. So defaulting to a URL that might not answer is safe in a way that
 * defaulting to "no sync" was not.
 */
export function syncRelayUrl(): string | undefined {
  const configured = globalThis.localStorage?.getItem(RELAY_KEY);
  if (configured) return configured;

  const built = (import.meta.env?.VITE_KARTA_RELAY as string | undefined)?.trim();
  if (built) return built;

  if (import.meta.env?.DEV) return "ws://localhost:4201";

  const loc = globalThis.location;
  // `file:` and any other non-http origin have no host to derive one from.
  if (!loc?.host || !/^https?:$/.test(loc.protocol)) return undefined;
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/sync`;
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


/**
 * Record an app on your ACCOUNT, so a device linked with the recovery words can find it.
 *
 * Only a synced app can be recorded: what is written is where its DATA lives, and a local-only app's
 * data lives nowhere but this device. (That is the next piece — every app on the CRDT store, so
 * every app qualifies.) Best-effort throughout: a backup that cannot be written is not a reason to
 * fail opening an app.
 *
 * See `publishAppListToAccount` for the list as a whole, which is what actually keeps a new device
 * useful: recording only the app you happen to open would mean a backup that depends on remembering
 * to open things.
 */
export async function rememberAppOnAccount(app: { id: string; name: string; icon?: string; source: string; shared?: boolean }): Promise<boolean> {
  const handle = lastSyncHandle;
  if (!handle) return false;
  try {
    const { publishAppToAccount } = await import("@karta/store");
    return await publishAppToAccount(handle.node, {
      id: app.id,
      name: app.name,
      icon: app.icon,
      source: app.source,
      group: handle.groupID,
      root: handle.store.rootId,
      shared: app.shared,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return false;
  }
}

/** Forget an app you deleted, so a new device is not offered it back. */
export async function forgetAppOnAccount(appId: string): Promise<boolean> {
  const handle = lastSyncHandle;
  if (!handle) return false;
  try {
    const { removeAppFromAccount } = await import("@karta/store");
    return await removeAppFromAccount(handle.node, appId);
  } catch {
    return false;
  }
}

/**
 * A node for reading your ACCOUNT, with no app open.
 *
 * The one moment this is needed is the first boot after signing in with the recovery words: there is
 * no app to hang a node off. `null` where this device cannot sync, or has no identity yet.
 */
export async function openAccountNodeForDevice(): Promise<unknown | null> {
  if (!canSync()) return null;
  try {
    const [{ openAccountNodeInBrowser }, identity] = await Promise.all([import("@karta/store"), import("@karta/identity")]);
    const saved = identity.peekIdentity();
    if (!saved) return null;
    const opened = await openAccountNodeInBrowser({
      account: await identity.identityAccount(),
      relay: syncRelayUrl(),
      profileName: saved.name,
    });
    return opened?.node ?? null;
  } catch {
    return null;
  }
}

/**
 * Publish EVERY synced app this device has to your account, without opening any of them.
 *
 * The first version of this recorded an app when that app was opened, which is a backup you have to
 * remember to make: a laptop with four synced apps that had opened one of them this month put one of
 * them on the account, and a new device — or a replacement for a laptop that died — was offered that
 * one. The space ids are already written down per app (`karta:jazz:group:user:<id>`), so the whole
 * list can be published in a single pass from what the device already knows.
 *
 * Returns how many were recorded. Best-effort: never throws, never blocks boot.
 */
export async function publishAppListToAccount(node: unknown): Promise<number> {
  try {
    const [{ publishAppToAccount }, { listUserApps }] = await Promise.all([import("@karta/store"), import("./user-apps.js")]);
    const { getEntry, appKey } = await import("./launcher-store.js");
    const now = new Date().toISOString();
    let recorded = 0;
    for (const app of listUserApps()) {
      if (!app.sync) continue;
      const group = globalThis.localStorage?.getItem(`karta:jazz:group:user:${app.id}`);
      const root = globalThis.localStorage?.getItem(`karta:jazz:root:user:${app.id}`);
      // No ids means this device has never actually opened its space — there is nothing to point a
      // new device at, and pointing it at a space that does not exist is worse than not listing it.
      if (!group || !root) continue;
      const entry = getEntry(appKey("user", app.id));
      const ok = await publishAppToAccount(node, {
        id: app.id,
        name: entry.displayName ?? app.name,
        icon: entry.icon ?? entry.identity?.icon,
        source: app.source,
        group,
        root,
        updatedAt: app.updatedAt ?? now,
      });
      if (ok) recorded += 1;
    }
    return recorded;
  } catch {
    return 0;
  }
}
