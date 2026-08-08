// Factory for a durable, optionally-synced JazzStore (ADR 0001 D1/D3, KA-08).
//
// Three things have to be remembered across reloads or the store is useless:
//   1. the DEVICE identity   — one account per device, shared by every app (ADR D2)
//   2. the app's GROUP       — the space its data lives in (ADR D3)
//   3. the app's ROOT CoMap  — the entry point into that data
// (1) is deliberately global while (2) and (3) are per-app: the person is the same across their
// apps, but each app's data is its own space with its own membership. Losing (3) is the silent
// failure mode — the CoValues survive in storage but nothing points at them, so the app opens
// empty and looks like data loss.
//
// Sync is opt-in per app: with no `peers`, this is a purely local durable store and no network
// exists at all, which is what keeps docs/01's "no server requirement" literally true.
//
// ## Writes are durable when they return (this was a real bug, now closed)
//
// cojson flushes to storage on its own schedule, so a write that had *returned* could still be lost
// to an immediate reload — add a record, refresh instantly, gone. That is a behavioural difference
// from `SqliteStore`, which commits synchronously, and it would have been a miserable first
// impression for a sync feature.
//
// Rather than expose a "remember to flush" method that every caller must get right, the store now
// awaits durability inside `insert`/`update`/`delete`/`kvSet`/`kvDelete`/`putBlob`/`runMigrations`,
// via the tracker below and cojson's `onLocalStoreDurabilityChange`. A JazzStore write therefore
// means the same thing a SqliteStore write does.
//
// The guarantee is load-bearing and pinned: disabling the awaits makes
// `jazz-backend.test.ts > data written before a reload is still there afterwards` fail immediately.
// `whenDurable` is still exposed on the handle so the shell can also flush on `beforeunload`.

import { LocalNode, getSqliteStorageAsync } from "cojson";
import { JazzStore } from "./jazz-store.js";
import { createJazzSqliteDriver } from "./jazz-sqlite-driver.js";
import type { SqliteDbHandle } from "./sqlite-store.js";

/** Where the ids above are remembered. `localStorage` in the browser; a Map in tests. */
export interface JazzKeyStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const ACCOUNT_ID = "karta:jazz:accountID";
const ACCOUNT_SECRET = "karta:jazz:accountSecret";
const groupKey = (appId: string) => `karta:jazz:group:${appId}`;
const rootKey = (appId: string) => `karta:jazz:root:${appId}`;

export interface CreateJazzStoreOpts {
  /** An open SQLite handle that cojson may own outright (its own file — see the driver module). */
  db: SqliteDbHandle;
  /** A cojson `CryptoProvider` (`WasmCrypto.create()`). Injected so this module picks no platform. */
  crypto: unknown;
  /** Persistence for the device account + this app's group/root ids. Defaults to `localStorage`. */
  keys?: JazzKeyStore;
  /** Sync peers. Omit for a local-only app — the default, and the whole point of opt-in sync. */
  peers?: unknown[];
  /** Display name used only when the device account is first created. */
  profileName?: string;
}

export interface JazzStoreHandle {
  store: JazzStore;
  /** The cojson node, for attaching peers later or reading identity (KA-18). */
  node: unknown;
  /** This device's account id — the raw material for `ctx.me` once KA-18 lands. */
  accountID: string;
  /** The app's space. Membership and roles hang off this (KA-17). */
  groupID: string;
  /** The raw group, for minting invites. */
  group: unknown;
  /** Resolves when every local write has reached storage. Writes already await this; exposed for
   *  the shell to flush on `beforeunload` / `visibilitychange`. */
  whenDurable: () => Promise<void>;
}

/**
 * Tracks whether cojson still has unflushed writes, and lets a caller await the all-clear.
 *
 * cojson reports durability per session via `(hasPending, sessionID)`. A session with pending
 * writes is one whose data would be lost right now.
 *
 * The `setTimeout(0)` matters and is not a fudge: `whenDurable()` is called immediately after a
 * `CoMap.set`, and cojson has not yet marked the session pending at that instant. Checking
 * synchronously would see an empty pending set, report "durable", and return before anything
 * reached disk — reintroducing the exact bug this exists to close. Yielding once lets cojson
 * register the write first.
 */
function createDurabilityTracker(): {
  listener: (hasPending: boolean, sessionID: string) => void;
  whenDurable: () => Promise<void>;
} {
  const pending = new Set<string>();
  let waiters: Array<() => void> = [];

  return {
    listener(hasPending, sessionID) {
      if (hasPending) pending.add(sessionID);
      else pending.delete(sessionID);
      if (pending.size === 0 && waiters.length) {
        const due = waiters;
        waiters = [];
        for (const resolve of due) resolve();
      }
    },
    async whenDurable() {
      await new Promise<void>((r) => setTimeout(r, 0));
      if (pending.size === 0) return;
      await new Promise<void>((resolve) => waiters.push(resolve));
    },
  };
}

function browserKeys(): JazzKeyStore {
  return {
    get: (k) => globalThis.localStorage?.getItem(k) ?? null,
    set: (k, v) => globalThis.localStorage?.setItem(k, v),
  };
}

/**
 * Open (or reopen) an app's Jazz-backed store.
 *
 * First call for a device creates an account; first call for an app creates its group and root.
 * Every later call reattaches to exactly the same three ids, which is what makes the data durable
 * rather than merely persisted.
 */
export async function createJazzStore(appId: string, opts: CreateJazzStoreOpts): Promise<JazzStoreHandle> {
  const keys = opts.keys ?? browserKeys();
  const crypto = opts.crypto as never;
  const peers = (opts.peers ?? []) as never[];

  const storage = await getSqliteStorageAsync(createJazzSqliteDriver(opts.db) as never);
  const durability = createDurabilityTracker();

  // ---- 1. device identity --------------------------------------------------------------------
  const savedId = keys.get(ACCOUNT_ID);
  const savedSecret = keys.get(ACCOUNT_SECRET);

  let node: InstanceType<typeof LocalNode>;
  let accountID: string;

  if (savedId && savedSecret) {
    accountID = savedId;
    node = await LocalNode.withLoadedAccount({
      accountID: savedId as never,
      accountSecret: savedSecret as never,
      // A fresh session per load: cojson sessions identify a *run* of a device, not the device.
      sessionID: (crypto as { newRandomSessionID(id: unknown): unknown }).newRandomSessionID(savedId) as never,
      crypto,
      storage,
      peers,
      onLocalStoreDurabilityChange: durability.listener as never,
    });
  } else {
    const created = await LocalNode.withNewlyCreatedAccount({
      creationProps: { name: opts.profileName ?? "Me" },
      crypto,
      storage,
      peers,
      onLocalStoreDurabilityChange: durability.listener as never,
    });
    node = created.node;
    accountID = created.accountID as unknown as string;
    keys.set(ACCOUNT_ID, accountID);
    keys.set(ACCOUNT_SECRET, created.accountSecret as unknown as string);
  }

  // ---- 2. the app's space --------------------------------------------------------------------
  const savedGroup = keys.get(groupKey(appId));
  let group: unknown;
  if (savedGroup) {
    const loaded = await node.load(savedGroup as never);
    if (loaded === "unavailable") {
      throw new Error(
        `createJazzStore: group ${savedGroup} for "${appId}" is unavailable. Its storage is missing or unreadable; refusing to silently create a new space and strand the existing data.`,
      );
    }
    group = loaded;
  } else {
    group = node.createGroup();
    keys.set(groupKey(appId), (group as { id: string }).id);
  }

  // ---- 3. the app's root ---------------------------------------------------------------------
  const savedRoot = keys.get(rootKey(appId)) ?? undefined;
  const store = new JazzStore({
    node: node as never,
    group: group as never,
    rootId: savedRoot,
    whenDurable: durability.whenDurable,
  });
  await store.open(appId);
  if (!savedRoot) keys.set(rootKey(appId), store.rootId);

  return { store, node, group, accountID, groupID: (group as { id: string }).id, whenDurable: durability.whenDurable };
}

/**
 * Browser convenience: open an app's Jazz store with everything wired.
 *
 * Exists so the shell never imports cojson. Keeping the engine inside this package is the same
 * boundary `SqliteStore` respects for sqlite-wasm (docs/02: "concrete Store wiring happens once at
 * the composition root" — the root chooses a store, it does not choose a CRDT library). It also
 * means swapping to the Yjs fallback recorded in ADR 0001 would not touch the shell at all.
 *
 * Both the engine and its crypto load lazily, so an app without sync never pays for them.
 */
export async function openJazzStore(
  appId: string,
  opts?: { keys?: JazzKeyStore; peers?: unknown[]; profileName?: string; relay?: string },
): Promise<JazzStoreHandle> {
  const [{ openOpfsDb }, { openIdbSqliteDb, idbAvailable }, { WasmCrypto }] = await Promise.all([
    import("./sqlite-backend.js"),
    import("./idb-sqlite.js"),
    import("cojson/crypto/WasmCrypto"),
  ]);

  // OPFS first (fastest), IndexedDB otherwise. Gating sync on OPFS made it unavailable to most
  // browsers — including many Chrome contexts, where `createSyncAccessHandle` is worker-only — so
  // the fallback is the difference between a feature that exists and one that does not.
  // cojson gets its own database, separate from the app's SqliteStore.
  let db: Awaited<ReturnType<typeof openOpfsDb>>;
  let whenPersisted: (() => Promise<void>) | undefined;
  try {
    db = await openOpfsDb(`${appId}-jazz`);
  } catch {
    if (!idbAvailable()) throw new Error("This browser has neither OPFS nor IndexedDB, so sync cannot be enabled.");
    const idb = await openIdbSqliteDb(`${appId}-jazz`);
    db = idb.db;
    whenPersisted = idb.whenPersisted;
  }
  const crypto = await WasmCrypto.create();

  // A relay is OPTIONAL and additive. With none, this is a durable local-only store and no socket
  // is ever opened — ADR D3's "solo = a space with one member, no transport". The relay only ever
  // sees ciphertext (measured: docs/spikes/jazz-selfhost-e2e.mjs), so pointing this at a
  // self-hosted `jazz-run sync` is the whole self-host story.
  const peers = [...(opts?.peers ?? [])];
  if (opts?.relay) peers.push(await createRelayPeer(opts.relay));

  const handle = await createJazzStore(appId, { db, crypto, keys: opts?.keys, profileName: opts?.profileName, peers });
  if (!whenPersisted) return handle;

  // On the IndexedDB path a cojson flush only reaches the in-memory database; the snapshot to IDB
  // is what actually survives a reload. Both must complete before a write is called durable.
  const cojsonDurable = handle.whenDurable;
  const both = async (): Promise<void> => {
    await cojsonDurable();
    await whenPersisted!();
  };
  handle.store.setWhenDurable?.(both);
  return { ...handle, whenDurable: both };
}

/** A reconnecting WebSocket peer pointed at a sync relay. */
async function createRelayPeer(url: string): Promise<unknown> {
  const { createWebSocketPeer } = await import("cojson-transport-ws");
  return createWebSocketPeer({
    id: `relay-${url}`,
    websocket: new WebSocket(url),
    role: "server",
    expectPings: true,
  } as never);
}

/** Mint an invite to this app's space. `writer` lets the guest edit; `reader` is read-only. */
export function createSpaceInvite(handle: JazzStoreHandle, role: "writer" | "reader" = "writer"): string {
  const group = (handle as unknown as { group?: unknown }).group;
  const g = (group ?? null) as { createInvite(role: string): string } | null;
  if (!g) throw new Error("createSpaceInvite: no group on this handle");
  return g.createInvite(role);
}

/**
 * Join someone else's space and open it as `appId`.
 *
 * `acceptInvite` grants this device the role the inviter minted, using a secret that travelled in a
 * URL *fragment* and therefore never reached the relay. Afterwards the group and root ids are
 * remembered exactly as for a space we created, so subsequent opens are indistinguishable.
 */
export async function joinSpace(
  appId: string,
  invite: { group: string; root: string; secret: string },
  opts?: { keys?: JazzKeyStore; relay?: string; profileName?: string },
): Promise<JazzStoreHandle> {
  const keys = opts?.keys ?? browserKeys();
  // Remember the shared ids BEFORE opening, so `openJazzStore` attaches to the invited space
  // instead of minting a fresh one.
  keys.set(groupKey(appId), invite.group);
  keys.set(rootKey(appId), invite.root);

  const handle = await openJazzStore(appId, { keys, relay: opts?.relay, profileName: opts?.profileName });
  await (handle.node as { acceptInvite(id: string, secret: string): Promise<void> }).acceptInvite(
    invite.group,
    invite.secret,
  );
  return handle;
}
