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

import { copyStoreData, createSqliteStore, LocalStore, SqliteStore, openWorkerSqliteHandle, workersAvailable, type CarriedCode, type Store } from "@potyro/store";

/**
 * The handle from the most recent synced `openStore`, so the composition root can read the space
 * (`ctx.space`) without the shell importing cojson.
 *
 * A module-level value rather than a return field because `openStore` is the seam every caller uses
 * and its `Store` return type is deliberately engine-free — widening it would leak Jazz into every
 * call site for the benefit of one. Read immediately after the call that set it.
 */
let lastSyncHandle: Awaited<ReturnType<typeof import("@potyro/store").openJazzStore>> | null = null;

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

  const { subscribeSpace, subscribeMemberProfiles } = await import("@potyro/store");

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
  if (handle) {
    const { publishName, publishNameToAccount } = await import("@potyro/store");
    await publishName(handle, name);
    // And on the account's registry, which is the copy a device linked later actually finds.
    const node = await openAccountNodeForDevice();
    if (node) await publishNameToAccount(node, name);
    return;
  }
  // No app open — which is the usual case, since the control that renames you lives on the launcher.
  // The name belongs to the ACCOUNT, so it goes there directly; otherwise it reaches this browser
  // and nothing else, and the next device to be linked introduces you as "Me".
  const node = await openAccountNodeForDevice();
  if (!node) return;
  const { publishAccountName, publishNameToAccount } = await import("@potyro/store");
  // Both channels: the profile, which is what members of a shared space read, and the account's own
  // registry, which is what a newly linked device reads before it has anything else.
  await publishAccountName(node, name);
}

/**
 * Remove a person from the open app's space (#58). Refused unless this device is the admin. Revokes
 * outstanding invites too, so a link shared before stops working. See `removeSpaceMember`.
 */
export async function removeMember(accountId: string): Promise<{ invitesRevoked: number }> {
  const handle = lastSyncHandle;
  if (!handle) throw new Error("This app is not shared.");
  const { removeSpaceMember } = await import("@potyro/store");
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
  const { spaceMembers, myRole } = await import("@potyro/store");
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
export const RELAY_KEY = "potyro:sync:relay";

/**
 * Sync relay URL, or undefined for local-only.
 *
 * Four sources, most specific first (KA-28):
 *
 *   1. **This device's setting.** `localStorage`, written by the ⌾ You panel. "Bring your own relay"
 *      is the free self-host escape hatch the ethos promises (business plan §8.4), and it must not
 *      require a rebuild.
 *   2. **A build-time default**, `VITE_POTYRO_RELAY`, for a deployment that puts its relay elsewhere.
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

  const built = (import.meta.env?.VITE_POTYRO_RELAY as string | undefined)?.trim();
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
/** Was this device told who it is with the recovery words? Then its account exists somewhere else. */
function linkedDevice(): boolean {
  return globalThis.localStorage?.getItem("potyro:identity:origin") === "passphrase";
}

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
    // The account comes from `@potyro/identity`, never from the store (ADR D2 amended). Identity is
    // minted with crypto alone, so it already exists here whether or not this device has ever
    // synced — and `ctx.me` therefore names the same person before and after sync is switched on.
    // An id that changed on toggle would orphan every `createdBy` already stamped.
    const [{ openJazzStore }, identity] = await Promise.all([
      import("@potyro/store"),
      import("@potyro/identity"),
    ]);
    // Awaited before the name is read, not inline: `identityAccount()` mints the identity on a
    // device that has never had one, and `peekIdentity()` answers null until it has.
    const account = await identity.identityAccount();
    const handle = await openJazzStore(namespace, {
      relay: syncRelayUrl(),
      account,
      // Told who it is by the recovery words: its account exists elsewhere, so "not in this
      // browser" must not be read as "does not exist" — see `expectExisting`.
      expectExisting: linkedDevice(),
      // Your display name, so peers see a person rather than a truncated account id. Passed on
      // EVERY open, because renaming yourself must reach people you already share with.
      profileName: identity.peekIdentity()?.name,
    });
    lastSyncHandle = handle;
    modes.set(namespace, "crdt-worker");
    return handle.store;
  }

  // A worker first, because it is the only place OPFS opens at all (see `sqlite-worker.ts`). The
  // two paths below it are what every local app used to get: a main-thread OPFS open that has never
  // succeeded in any browser, and then `localStorage` — five megabytes shared with everything else
  // the app remembers, which is why adding a photo reported "the quota has been exceeded".
  if (workersAvailable()) {
    try {
      const store = new SqliteStore(await openWorkerSqliteHandle(namespace));
      await store.open(namespace);
      await adoptLocalStorageData(store, namespace);
      modes.set(namespace, "worker");
      return store;
    } catch (err) {
      console.info(`[potyro] no worker database for "${namespace}" (${err instanceof Error ? err.message : String(err)}), falling back`);
    }
  }

  try {
    const store = await createSqliteStore(namespace);
    modes.set(namespace, "opfs");
    return store;
  } catch {
    // Expected on Firefox / no-OPFS browsers — data still persists via localStorage.
    console.info(`[potyro] Using local storage for "${namespace}" (OPFS SQLite unavailable in this browser).`);
    const store = new LocalStore();
    await store.open(namespace);
    modes.set(namespace, "local-storage");
    return store;
  }
}

/**
 * Which storage each namespace actually got.
 *
 * Every fallback here is silent by design — losing speed beats losing the app — which is exactly how
 * "OPFS never opens on the main thread" went unnoticed for so long. Recording the answer means a
 * device can be asked what it is really using instead of being assumed.
 */
const modes = new Map<string, StorageMode>();
export type StorageMode = "worker" | "opfs" | "indexeddb-snapshot" | "local-storage" | "crdt-worker";

export function storageModes(): ReadonlyMap<string, StorageMode> {
  return modes;
}

/** Where `LocalStore` keeps an app, and the note saying its contents have been moved out. */
const localKey = (namespace: string) => `potyro:${namespace}`;
const movedKey = (namespace: string) => `potyro:moved:${namespace}`;

/**
 * Bring across what an app wrote while it was living in `localStorage`.
 *
 * Every local-only app has been storing there — the OPFS path it was supposed to use could never
 * open — so switching to a real database without this would show people an empty app and leave
 * years of notes in a key nothing reads. Runs once, guarded by a marker, and only into a database
 * with nothing in it.
 *
 * The old copy is NOT deleted. It costs nothing to leave (nothing writes there any more) and it is
 * the only copy of that data until someone is sure this worked.
 */
export async function adoptLocalStorageData(store: Store, namespace: string): Promise<void> {
  const raw = globalThis.localStorage?.getItem(localKey(namespace));
  if (!raw || globalThis.localStorage?.getItem(movedKey(namespace))) return;

  let entities: string[];
  try {
    entities = Object.keys((JSON.parse(raw) as { records?: Record<string, unknown> }).records ?? {});
  } catch {
    return; // not something this wrote; leave it alone
  }
  if (entities.length === 0) {
    globalThis.localStorage?.setItem(movedKey(namespace), new Date().toISOString());
    return;
  }

  const old = new LocalStore();
  await old.open(namespace);
  const moved = await copyStoreData(old, store, { entities });
  globalThis.localStorage?.setItem(movedKey(namespace), new Date().toISOString());
  console.info(`[potyro] moved "${namespace}" out of local storage: ${moved.records} records, ${moved.blobs} files.`);
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
    const { publishAppToAccount } = await import("@potyro/store");
    const code = await accountCode(app.id, handle.store);
    return await publishAppToAccount(handle.node, {
      ...code,
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

/**
 * The app's code beyond its source, for its entry on your account (#281): its lock and its own
 * modules, so another of your devices can open it — fetching the libraries there, once, with consent.
 * Never the library bytes. Nothing when the app is one file, or is not on this device.
 */
async function accountCode(appId: string, store?: Store): Promise<CarriedCode> {
  const [{ getUserApp }, { codeToCarry }] = await Promise.all([import("./user-apps.js"), import("./app-modules.js")]);
  const app = getUserApp(appId);
  return app ? codeToCarry(app, store) : {};
}

/** Forget an app you deleted, so a new device is not offered it back. */
export async function forgetAppOnAccount(appId: string): Promise<boolean> {
  const handle = lastSyncHandle;
  if (!handle) return false;
  try {
    const { removeAppFromAccount } = await import("@potyro/store");
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
    const [{ openAccountNodeInBrowser }, identity] = await Promise.all([import("@potyro/store"), import("@potyro/identity")]);
    const saved = identity.peekIdentity();
    if (!saved) return null;
    const opened = await openAccountNodeInBrowser({
      account: await identity.identityAccount(),
      relay: syncRelayUrl(),
      profileName: saved.name,
      expectExisting: linkedDevice(),
    });
    return opened?.node ?? null;
  } catch {
    return null;
  }
}

let accountNodeOpening: { who: string; node: Promise<unknown | null> } | null = null;

/**
 * This device's node on your account, opened once per page and kept: what reads and writes the data
 * that is yours rather than an app's — your Studio conversations (#283). Null where this device has
 * no account to reach; asked again next time, since an identity can appear later in the session. A
 * different identity (this device was linked to another account) gets a node of its own.
 */
export async function accountNode(): Promise<unknown | null> {
  const { peekIdentity } = await import("@potyro/identity");
  const who = peekIdentity()?.id;
  if (!who) return null;
  if (accountNodeOpening?.who !== who) {
    const node = openAccountNodeForDevice().then((n) => {
      if (!n && accountNodeOpening?.node === node) accountNodeOpening = null;
      return n;
    });
    accountNodeOpening = { who, node };
  }
  return accountNodeOpening.node;
}

/**
 * Publish EVERY synced app this device has to your account, without opening any of them.
 *
 * The first version of this recorded an app when that app was opened, which is a backup you have to
 * remember to make: a laptop with four synced apps that had opened one of them this month put one of
 * them on the account, and a new device — or a replacement for a laptop that died — was offered that
 * one. The space ids are already written down per app (`potyro:jazz:group:user:<id>`), so the whole
 * list can be published in a single pass from what the device already knows.
 *
 * Returns how many were recorded. Best-effort: never throws, never blocks boot.
 */
export async function publishAppListToAccount(node: unknown): Promise<number> {
  try {
    const [{ publishAppToAccount }, { listUserApps }] = await Promise.all([import("@potyro/store"), import("./user-apps.js")]);
    const { getEntry, appKey } = await import("./launcher-store.js");
    const now = new Date().toISOString();
    let recorded = 0;
    for (const app of listUserApps()) {
      if (!app.sync) continue;
      const group = globalThis.localStorage?.getItem(`potyro:jazz:group:user:${app.id}`);
      const root = globalThis.localStorage?.getItem(`potyro:jazz:root:user:${app.id}`);
      // No ids means this device has never actually opened its space — there is nothing to point a
      // new device at, and pointing it at a space that does not exist is worse than not listing it.
      if (!group || !root) continue;
      const entry = getEntry(appKey("user", app.id));
      const ok = await publishAppToAccount(node, {
        ...(await accountCode(app.id)),
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
