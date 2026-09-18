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
/**
 * The 32-byte seed the account secret is derived from, hex-encoded.
 *
 * Stored because it — not the account secret — is what becomes the BIP39 recovery passphrase that
 * links a second device (ADR D2a). cojson's `withNewlyCreatedAccount` defaults to
 * `newRandomAgentSecret()`, which has no seed behind it, so an account created that way can NEVER
 * produce a passphrase: `getCurrentAccountPassphrase` needs the seed and there is none to find.
 * Deriving from an explicit seed costs nothing and is the difference between multi-device being
 * possible later and being impossible for every account created before someone noticed.
 */
const ACCOUNT_SEED = "karta:jazz:accountSeed";

const toHex = (b: Uint8Array): string => [...b].map((n) => n.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string): Uint8Array => new Uint8Array(s.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
const groupKey = (appId: string) => `karta:jazz:group:${appId}`;
/** Which cojson database this app's space lives in. See `openJazzStore`. */
const dbKey = (appId: string) => `karta:jazz:db:${appId}`;
/** The one cojson database a device uses for every space created from here on. */
const DEVICE_DB = "karta-jazz";
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
  /**
   * The device account to open, from `@karta/identity`.
   *
   * Identity is not the store's to invent (ADR D2 amended): `@karta/identity` owns the seed the
   * account is derived from, because that seed is also the recovery passphrase, and one place has
   * to be responsible for the most security-sensitive value we hold. Passing it here also means the
   * account exists *before* any app syncs, so `ctx.me` is answerable on a device that has never
   * opened a database.
   *
   * Omitted, this falls back to minting and remembering an account in `keys` — which is what the
   * store did on its own, kept so the store's tests stay independent of identity.
   */
  account?: { id: string; secret: string };
  /**
   * Relay URL. Attached INSIDE this function, between resolving the account and loading the app's
   * group — the only window that works. Later is too late: joining a space fetches the group over
   * the network, so a relay attached after `createJazzStore` returns leaves the join with nothing to
   * fetch from. Earlier is too early: resolving an absent account with peers attached waits for every
   * peer to disclaim it, which turned "turn sync on" into a 30s stall against a dead relay.
   */
  relay?: string;
}

/** A live relay connection: whether it is up, and a way to be told when that changes. */
export interface RelayConnection {
  readonly connected: boolean;
  subscribe(listener: (connected: boolean) => void): void;
  unsubscribe(listener: (connected: boolean) => void): void;
  /** Detach and stop reconnecting. */
  disable(): void;
}

export interface JazzStoreHandle {
  store: JazzStore;
  /** Present only when a relay URL was given. Reports the real transport state. */
  relay?: RelayConnection;
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
/**
 * The account half of opening a store: the device's identity, its profile, and the relay — without
 * any app's space.
 *
 * Split out because a device that has just been linked with the recovery words has NO apps yet, and
 * the one thing it needs before it can have any is to read its own account (see `account-apps.ts`).
 * Going through `createJazzStore` for that would have meant inventing an app id and leaving a space
 * behind for an app that does not exist.
 */
export async function openAccountNode(opts: Omit<CreateJazzStoreOpts, "peers"> & { peers?: unknown[] }): Promise<{
  node: InstanceType<typeof LocalNode>;
  accountID: string;
  relay?: RelayConnection;
  whenDurable: () => Promise<void>;
}> {
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

  const loadAccount = async (
    id: string,
    secret: string,
    withPeers: never[],
  ): Promise<InstanceType<typeof LocalNode>> =>
    LocalNode.withLoadedAccount({
      accountID: id as never,
      accountSecret: secret as never,
      // A fresh session per load: cojson sessions identify a *run* of a device, not the device.
      sessionID: (crypto as { newRandomSessionID(id: unknown): unknown }).newRandomSessionID(id) as never,
      crypto,
      storage,
      peers: withPeers,
      onLocalStoreDurabilityChange: durability.listener as never,
    });

  if (opts.account) {
    // Identity was minted by `@karta/identity` with crypto alone — no database, no node — so the
    // FIRST time any app syncs there is no account CoValue in storage yet and loading it fails.
    // Creating it from the same secret produces the same id (that derivation is what makes
    // passphrase linking work at all), so materialising here is a no-op for identity and simply
    // gives cojson the CoValue it needs.
    //
    // Resolved with NO PEERS, then peers attached afterwards. Loading an absent account with a peer
    // list means waiting for every peer to disclaim it before falling through to create — so an
    // unreachable relay turned "turn sync on" into a stall of tens of seconds, and the first sync on
    // a flaky network is exactly when that is least forgivable. Locally it fails in milliseconds.
    accountID = opts.account.id;
    try {
      node = await loadAccount(opts.account.id, opts.account.secret, [] as never[]);
    } catch (e) {
      // Narrow on purpose: only "there is no account here" is a reason to create one. Any other
      // failure (corrupt storage, bad secret) must surface rather than silently mint a second
      // identity and strand the person's spaces.
      if (!/unavailable/i.test(e instanceof Error ? e.message : String(e))) throw e;
      const created = await LocalNode.withNewlyCreatedAccount({
        creationProps: { name: opts.profileName ?? "Me" },
        crypto,
        storage,
        peers: [] as never[],
        initialAgentSecret: opts.account.secret as never,
        onLocalStoreDurabilityChange: durability.listener as never,
      });
      node = created.node;
      if ((created.accountID as unknown as string) !== opts.account.id) {
        throw new Error(
          `createJazzStore: materialised account ${String(created.accountID)} does not match the identity's ${opts.account.id}.`,
        );
      }
    }
    // cojson does this itself in both of its own constructors, so it is the supported way in.
    const sync = (node as unknown as { syncManager: { addPeer(p: unknown): void } }).syncManager;
    for (const peer of peers) sync.addPeer(peer);
  } else if (savedId && savedSecret) {
    accountID = savedId;
    node = await loadAccount(savedId, savedSecret, peers);
  } else {
    // Derive from an explicit seed, and keep the seed — see ACCOUNT_SEED above. Without this the
    // account has no recoverable passphrase and the device can never be linked to another.
    const c = crypto as unknown as {
      newRandomSecretSeed(): Uint8Array;
      agentSecretFromSecretSeed(seed: Uint8Array): unknown;
    };
    const seed = c.newRandomSecretSeed();
    const created = await LocalNode.withNewlyCreatedAccount({
      creationProps: { name: opts.profileName ?? "Me" },
      crypto,
      storage,
      peers,
      initialAgentSecret: c.agentSecretFromSecretSeed(seed) as never,
      onLocalStoreDurabilityChange: durability.listener as never,
    });
    node = created.node;
    accountID = created.accountID as unknown as string;
    keys.set(ACCOUNT_ID, accountID);
    keys.set(ACCOUNT_SECRET, created.accountSecret as unknown as string);
    keys.set(ACCOUNT_SEED, toHex(seed));
  }

  // ---- 1a. make sure other people can see your name --------------------------------------------
  //
  // The display name a peer renders comes from the ACCOUNT PROFILE, which is the only copy that
  // syncs. Renaming yourself locally therefore reached nobody: everyone you shared with kept seeing
  // a truncated account id, which is exactly what the rename control exists to prevent. Published
  // here, on every open, so the name catches up wherever it was changed.
  if (opts.profileName) await publishProfileName(node, opts.profileName);

  // ---- 1b. the relay ---------------------------------------------------------------------------
  // Between the account and the group, for the reasons on `CreateJazzStoreOpts.relay`.
  let relay: RelayConnection | undefined;
  if (opts.relay) relay = await attachRelay(node, opts.relay);

  return { node, accountID, relay, whenDurable: durability.whenDurable };
}

export async function createJazzStore(appId: string, opts: CreateJazzStoreOpts): Promise<JazzStoreHandle> {
  const keys = opts.keys ?? browserKeys();
  const { node, accountID, relay, whenDurable } = await openAccountNode(opts);
  const durability = { whenDurable };

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

  return {
    store,
    node,
    group,
    relay,
    accountID,
    groupID: (group as { id: string }).id,
    whenDurable: durability.whenDurable,
  };
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
  opts?: {
    keys?: JazzKeyStore;
    peers?: unknown[];
    profileName?: string;
    relay?: string;
    /** The device account from `@karta/identity`. See `CreateJazzStoreOpts.account`. */
    account?: { id: string; secret: string };
  },
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
  //
  // ONE database per DEVICE, not per app — `karta-jazz`, not `${appId}-jazz`.
  //
  // The device account is global (see the header) but its CoValue is only ever written to the
  // database that created it. With a database per app, the SECOND synced app read the saved
  // `accountID`/`accountSecret` against an empty store and cojson answered
  // `Account unavailable from all peers` — so the second app a person synced simply failed to open.
  // It was invisible because a dev relay can serve the account CoValue back, and every test passed
  // both apps one shared `db`; a local-only synced app (no relay — ADR D3's default) had no such
  // luck. Pinned by `jazz-account-portability.test.ts`.
  //
  // Apps stay isolated by GROUP, not by file (`jazz-backend.test.ts` pins that two apps get separate
  // spaces and cannot read each other). The cost of sharing a file is that deleting one app's data
  // no longer means deleting a file — tracked as a follow-up.
  //
  // ## Apps that predate the move keep their own file
  //
  // Changing the name orphaned every space that already existed: the group and root CoValues live in
  // `${appId}-jazz`, so opening `karta-jazz` found nothing and the guard below correctly refused to
  // mint a replacement over live data ("group … is unavailable"). A rename is a migration, and this
  // one shipped without one.
  //
  // `karta:jazz:db:<ns>` records which file an app uses, written the first time it is opened from
  // here on. If that marker is ABSENT but a group id is present, the space was created before this
  // existed and its data is in the legacy per-app file — so that is what gets opened, permanently.
  // Deterministic, with no probing of storage that would create the very file it is testing for.
  const keys = opts?.keys ?? browserKeys();
  const recorded = keys.get(dbKey(appId));
  const predatesMove = !recorded && !!keys.get(groupKey(appId));
  const dbName = recorded ?? (predatesMove ? `${appId}-jazz` : DEVICE_DB);
  keys.set(dbKey(appId), dbName);

  let db: Awaited<ReturnType<typeof openOpfsDb>>;
  let whenPersisted: (() => Promise<void>) | undefined;
  try {
    db = await openOpfsDb(dbName);
  } catch {
    if (!idbAvailable()) throw new Error("This browser has neither OPFS nor IndexedDB, so sync cannot be enabled.");
    const idb = await openIdbSqliteDb(dbName);
    db = idb.db;
    whenPersisted = idb.whenPersisted;
  }
  const crypto = await WasmCrypto.create();

  // A relay is OPTIONAL and additive. With none, this is a durable local-only store and no socket
  // is ever opened — ADR D3's "solo = a space with one member, no transport". The relay only ever
  // sees ciphertext (measured: docs/spikes/jazz-selfhost-e2e.mjs), so pointing this at a
  // self-hosted `jazz-run sync` is the whole self-host story.
  // The relay is NOT put in this list. It is attached to the node afterwards, because reconnecting
  // means replacing the peer repeatedly and only the node can be given a new one.
  const peers = [...(opts?.peers ?? [])];

  const handle = await createJazzStore(appId, {
    db,
    crypto,
    keys,
    profileName: opts?.profileName,
    account: opts?.account,
    relay: opts?.relay,
    peers,
  });
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

/**
 * Attach a relay to a live node, and KEEP it attached.
 *
 * This used to build one `createWebSocketPeer` over a raw `new WebSocket(url)` and hand it to the
 * node at construction. That socket is never replaced, so the first disconnection — a sleeping
 * laptop, a wifi blip, a relay restart — ended sync permanently for that page, silently, until
 * someone happened to reload. Writes kept working and kept being durable locally, which is exactly
 * what makes it hard to notice: nothing looks wrong until two devices are compared.
 *
 * `WebSocketPeerWithReconnection` (already in `cojson-transport-ws`) reconnects with a linear
 * backoff and re-adds the peer each time, which is why it needs the node rather than a socket.
 */
async function attachRelay(node: unknown, url: string): Promise<RelayConnection> {
  const { WebSocketPeerWithReconnection } = await import("cojson-transport-ws");
  const sync = (node as { syncManager: { addPeer(p: unknown): void; removePeer(id: string): void } }).syncManager;

  const relay = new WebSocketPeerWithReconnection({
    peer: url,
    reconnectionTimeout: undefined, // library default (500ms, growing per attempt)
    addPeer: (peer: { id: string }) => sync.addPeer(peer),
    // The wrapper hands back the whole peer; cojson removes by id.
    removePeer: (peer: { id: string }) => sync.removePeer(peer.id),
  } as never) as unknown as {
    enable(): void;
    disable(): void;
    connected: boolean;
    subscribe(l: (connected: boolean) => void): void;
    unsubscribe(l: (connected: boolean) => void): void;
  };

  relay.enable();
  return {
    get connected() {
      return relay.connected;
    },
    subscribe: (l) => relay.subscribe(l),
    unsubscribe: (l) => relay.unsubscribe(l),
    disable: () => relay.disable(),
  };
}

/** Mint an invite to this app's space. `writer` lets the guest edit; `reader` is read-only. */
export function createSpaceInvite(handle: JazzStoreHandle, role: "writer" | "reader" = "writer"): string {
  const group = (handle as unknown as { group?: unknown }).group;
  const g = (group ?? null) as { createInvite(role: string): string } | null;
  if (!g) throw new Error("createSpaceInvite: no group on this handle");

  // Only an admin may invite, and someone who JOINED is a writer. Checked here rather than left to
  // cojson, which fails with `Failed to set role writerInvite to sealer_z… (role of current account
  // is writer)` — true, and useless to the person reading it.
  const mine = myRole(handle);
  if (mine !== "admin") {
    throw new Error(
      "Only the person who created this app can share it. You joined it, so you can add and edit " +
        "records, but not invite other people.",
    );
  }
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
  opts?: {
    keys?: JazzKeyStore;
    relay?: string;
    profileName?: string;
    /** The device account from `@karta/identity` — you join a space AS someone. */
    account?: { id: string; secret: string };
  },
): Promise<JazzStoreHandle> {
  const keys = opts?.keys ?? browserKeys();
  // Claim the database FIRST, and only then the shared ids.
  //
  // Order is load-bearing. `openJazzStore` decides an app predates the database rename by seeing a
  // group id with no database marker — and the two lines below are the one place a group id is
  // written for a space this device never had. Without this, every JOIN was misread as a legacy app
  // and opened a per-app file the invite knows nothing about, so the guest joined into an empty
  // store and saw none of the shared data.
  keys.set(dbKey(appId), DEVICE_DB);
  // Remember the shared ids BEFORE opening, so `openJazzStore` attaches to the invited space
  // instead of minting a fresh one.
  keys.set(groupKey(appId), invite.group);
  keys.set(rootKey(appId), invite.root);

  const handle = await openJazzStore(appId, {
    keys,
    relay: opts?.relay,
    profileName: opts?.profileName,
    account: opts?.account,
  });
  await (handle.node as { acceptInvite(id: string, secret: string): Promise<void> }).acceptInvite(
    invite.group,
    invite.secret,
  );
  return handle;
}


/**
 * Write this account's display name where peers can read it.
 *
 * Best-effort on purpose: a profile that will not load is not a reason to fail opening an app. The
 * name is a nicety; the data is not.
 */
async function publishProfileName(node: unknown, name: string): Promise<void> {
  try {
    const n = node as {
      expectCurrentAccount(hint: string): Promise<{ get(k: string): unknown }>;
      load(id: string): Promise<unknown>;
    };
    const account = await n.expectCurrentAccount("profile");
    const profileId = account.get("profile");
    if (typeof profileId !== "string") return;
    const profile = (await n.load(profileId)) as
      | { get(k: string): unknown; set(k: string, v: unknown, privacy?: string): void }
      | "unavailable";
    if (!profile || profile === "unavailable") return;
    // Written `trusting` (plaintext): a display name has to be readable by members of every space
    // you are in, and they do not share one key. This is the same metadata visibility recorded in
    // KA-33 — it is a name, not content.
    if (profile.get("name") !== name) profile.set("name", name, "trusting");
  } catch {
    // Never block opening an app on this.
  }
}

/**
 * Publish a new display name to an app that is already open.
 *
 * Every open publishes the name, which is enough for the name to *eventually* be right — but "wait
 * for a reload" is not a thing to tell someone who has just renamed themselves in front of a chat
 * window with their old name in it. This is the same write, on demand.
 */
export async function publishName(handle: JazzStoreHandle, name: string): Promise<void> {
  await publishProfileName(handle.node, name);
}

/**
 * Who is in this app's space, for `ctx.space.members` (KA-18/KA-17).
 *
 * Membership is read from the GROUP, which is what makes a `member` field unforgeable: the invite
 * and key machinery maintains this list, not rows the app can write.
 *
 * Names are best-effort. A member's display name lives in their account profile, which is a
 * separate CoValue that may not be local yet on a device that has only just joined — so a name that
 * has not arrived reads as `undefined` and the caller shows the id. Blocking the whole app on
 * fetching every peer's profile would be a worse trade: you can settle up with someone whose
 * display name has not synced, but not with an app that will not open.
 */
export async function spaceMembers(
  handle: JazzStoreHandle,
): Promise<Array<{ id: string; name?: string; role: "admin" | "writer" | "reader" }>> {
  const group = handle.group as {
    getMemberKeys(): string[];
    roleOf(id: string): string | undefined;
  } | null;
  if (!group?.getMemberKeys) return [];

  const node = handle.node as { load(id: string): Promise<unknown> };
  const out: Array<{ id: string; name?: string; role: "admin" | "writer" | "reader" }> = [];

  for (const key of group.getMemberKeys()) {
    // Member keys include non-account agents (e.g. the relay's server agent). Only accounts are
    // people, and listing a relay as a housemate would be a memorable bug.
    if (!key.startsWith("co_")) continue;
    const role = group.roleOf(key);
    if (role !== "admin" && role !== "writer" && role !== "reader") continue;

    let name: string | undefined;
    try {
      const account = (await node.load(key)) as { get?(k: string): unknown } | "unavailable";
      if (account && account !== "unavailable") {
        const profileId = account.get?.("profile");
        if (typeof profileId === "string") {
          const profile = (await node.load(profileId)) as { get?(k: string): unknown } | "unavailable";
          if (profile && profile !== "unavailable") {
            const n = profile.get?.("name");
            if (typeof n === "string" && n) name = n;
          }
        }
      }
    } catch {
      // A profile that will not load is not a reason to fail; the id still identifies the person.
    }
    out.push(name ? { id: key, name, role } : { id: key, role });
  }
  return out;
}

/**
 * Be told when the space's membership changes — someone joined, a role changed.
 *
 * A group IS a CoValue, so this is its own `subscribe`; nothing polls. Returns a no-op unsubscribe
 * for a handle without a group, so a caller never has to branch.
 */
export function subscribeSpace(handle: JazzStoreHandle, cb: () => void): () => void {
  const group = handle.group as { subscribe?(l: () => void): () => void } | null;
  return group?.subscribe?.(cb) ?? (() => {});
}

/**
 * Be told when a MEMBER's display name changes.
 *
 * Separate from `subscribeSpace` because they watch different CoValues, and only one of them was
 * being watched: the group fires on a join or a role change, but renaming yourself writes to your
 * ACCOUNT PROFILE, which the group does not contain. So a peer's new name reached everyone's storage
 * immediately and appeared on nobody's screen until they happened to reload.
 *
 * Best-effort, member by member: a profile that will not load is skipped rather than failing the
 * whole subscription — the same trade `spaceMembers` makes, for the same reason. Losing one person's
 * live rename is survivable; losing everyone's is not.
 */
export async function subscribeMemberProfiles(
  handle: JazzStoreHandle,
  cb: () => void,
): Promise<() => void> {
  const group = handle.group as { getMemberKeys(): string[] } | null;
  const node = handle.node as { load(id: string): Promise<unknown> };
  if (!group?.getMemberKeys) return () => {};

  const stops: Array<() => void> = [];
  for (const key of group.getMemberKeys()) {
    // Member keys include non-account agents (a relay's server agent); only accounts have profiles.
    if (!key.startsWith("co_")) continue;
    try {
      const account = (await node.load(key)) as { get?(k: string): unknown } | "unavailable";
      if (!account || account === "unavailable") continue;
      const profileId = account.get?.("profile");
      if (typeof profileId !== "string") continue;
      const profile = (await node.load(profileId)) as
        | { subscribe?(l: () => void): () => void }
        | "unavailable";
      if (!profile || profile === "unavailable") continue;
      const stop = profile.subscribe?.(cb);
      if (stop) stops.push(stop);
    } catch {
      // One unreachable profile is not a reason to watch none of them.
    }
  }
  return () => {
    for (const stop of stops) stop();
  };
}

/**
 * Remove a person from an app's space (KA-17, #58) — so access can be taken back.
 *
 * Three things, in this order, because the order is what makes it real:
 *
 * 1. **Every outstanding invite is revoked first.** An invite is a member entry of its own (a
 *    `writerInvite` / `readerInvite` agent whose secret travelled in a link). Left in place, the
 *    removed person could simply accept their old link again — and the key rotation below reveals
 *    the new read key to every member that can still read, invites included.
 * 2. **The person's role is revoked and the read key rotated** (`removeMember`): they can no longer
 *    write, and nothing written from now on is readable to them. What already reached their devices
 *    stays there — encryption cannot reach back into a copy someone already holds.
 * 3. Only an admin may do this, and not to themselves.
 *
 * Returns how many open invites were revoked, so the UI can say a new link is needed.
 */
export function removeSpaceMember(handle: JazzStoreHandle, accountId: string): { invitesRevoked: number } {
  const group = handle.group as {
    getMemberKeys(): string[];
    get(key: string): unknown;
    set(key: string, value: string, privacy: "trusting"): void;
    removeMember(account: string): void;
  } | null;
  if (!group) throw new Error("removeSpaceMember: no group on this handle");
  if (myRole(handle) !== "admin") throw new Error("Only the person who created this app can remove people from it.");
  if (accountId === handle.accountID) throw new Error("You can't remove yourself from an app you created.");
  const role = group.get(accountId);
  if (role !== "admin" && role !== "writer" && role !== "reader") throw new Error("That person is not in this app's space.");

  let invitesRevoked = 0;
  for (const key of group.getMemberKeys()) {
    const r = group.get(key);
    if (typeof r === "string" && r.endsWith("Invite")) {
      group.set(key, "revoked", "trusting");
      invitesRevoked++;
    }
  }
  group.removeMember(accountId);
  return { invitesRevoked };
}

/** This device's own role in an app's space. */
export function myRole(handle: JazzStoreHandle): "admin" | "writer" | "reader" | undefined {
  const group = handle.group as { myRole(): string | undefined } | null;
  const role = group?.myRole?.();
  return role === "admin" || role === "writer" || role === "reader" ? role : undefined;
}
