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

import { LocalNode, getSqliteStorageAsync, logger as cojsonLogger } from "cojson";
import { JazzStore } from "./jazz-store.js";
import { createJazzSqliteDriver, type SqliteDriverAsync } from "./jazz-sqlite-driver.js";
import type { SqliteDbHandle } from "./sqlite-store.js";
import { isStorageElsewhere } from "./storage-owner.js";

/** Where the ids above are remembered. `localStorage` in the browser; a Map in tests. */
export interface JazzKeyStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** What cojson calls someone who has not named themselves. A placeholder, not a name. */
const DEFAULT_PROFILE_NAME = "Me";

const ACCOUNT_ID = "potyro:jazz:accountID";
const ACCOUNT_SECRET = "potyro:jazz:accountSecret";
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
const ACCOUNT_SEED = "potyro:jazz:accountSeed";

const toHex = (b: Uint8Array): string => [...b].map((n) => n.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string): Uint8Array => new Uint8Array(s.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
const groupKey = (appId: string) => `potyro:jazz:group:${appId}`;
/** Which cojson database this app's space lives in. See `openJazzStore`. */
const dbKey = (appId: string) => `potyro:jazz:db:${appId}`;
/** The one cojson database a device uses for every space created from here on. */
// The name predates the rename to Potyro and stays: it is the file on every device, and the
// `…:jazz:db:` keys moved by the shell still name it (packages/shell/src/rename-migration.ts).
const DEVICE_DB = "karta-jazz";
const rootKey = (appId: string) => `potyro:jazz:root:${appId}`;

export interface CreateJazzStoreOpts {
  /** How many bytes this app's shared space may hold on the relay (#255). `SPACE_BUDGET` when absent. */
  spaceBudget?: number;
  /**
   * An open SQLite handle that cojson may own outright (its own file — see the driver module).
   *
   * Optional only because {@link CreateJazzStoreOpts.driver} can stand in its place: the database
   * that lives in a worker has no handle to pass. Exactly one of the two is required.
   */
  db?: SqliteDbHandle;
  /**
   * A ready-made cojson driver, used instead of building one over `db`.
   *
   * This is how worker-hosted SQLite reaches cojson (`sqlite-worker-client.ts`). It is the fast
   * path and the intended one: OPFS only works in a worker, and the main-thread fallbacks either
   * rewrite the whole database per write or run out of quota.
   */
  driver?: SqliteDriverAsync;
  /** A cojson `CryptoProvider` (`WasmCrypto.create()`). Injected so this module picks no platform. */
  crypto: unknown;
  /** Persistence for the device account + this app's group/root ids. Defaults to `localStorage`. */
  keys?: JazzKeyStore;
  /** Sync peers. Omit for a local-only app — the default, and the whole point of opt-in sync. */
  peers?: unknown[];
  /** Display name used only when the device account is first created. */
  profileName?: string;
  /**
   * The device account to open, from `@potyro/identity`.
   *
   * Identity is not the store's to invent (ADR D2 amended): `@potyro/identity` owns the seed the
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
   * This account already exists somewhere else — do not mint a local one without asking the relay.
   *
   * Set by a device linked with the recovery words. Without it such a device loads the account with
   * no peers, fails (it has never seen it), and creates a fresh account CoValue from the same
   * secret: the same id, but its own profile, named "Me". The person then exists twice — their
   * laptop's name on one side and "Me" on the other — and nothing they rename later reconciles it.
   */
  expectExisting?: boolean;
  /**
   * Relay URL. Attached INSIDE this function, between resolving the account and loading the app's
   * group — the only window that works. Later is too late: joining a space fetches the group over
   * the network, so a relay attached after `createJazzStore` returns leaves the join with nothing to
   * fetch from. Earlier is too early: resolving an absent account with peers attached waits for every
   * peer to disclaim it, which turned "turn sync on" into a 30s stall against a dead relay.
   */
  relay?: string;
  /**
   * The device's node, already open on this database: the space is opened on it instead of on a node
   * of its own. `openJazzStore` passes it so a page has ONE node per database (see `deviceNode`).
   * Everything above that only shapes how a node is opened is then already decided.
   */
  opened?: OpenedAccountNode;
}

/** A node on the device account, as `openAccountNode` opens it. */
export type OpenedAccountNode = Awaited<ReturnType<typeof openAccountNode>>;

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
 * Fetch an account that exists elsewhere, through a relay connection made only for that.
 *
 * The relay is normally attached AFTER the node exists, because the node's sync manager is what it
 * attaches to — which is fine until the thing you need from the relay is the account itself. A
 * device linked with the recovery words has never seen its own account, and without asking the relay
 * it concludes there is none and mints a second one: same id, new profile, called "Me".
 *
 * So: a throwaway connection, a bounded wait, and the peer handed straight to the load. It is
 * disabled afterwards whatever happens — the real one is attached in the usual place, in the usual
 * way, and reconnects on its own.
 */
async function loadAccountThroughRelay<T>(
  url: string,
  load: (peers: never[]) => Promise<T>,
  waitMs = 8_000,
): Promise<T | null> {
  const { WebSocketPeerWithReconnection } = await import("cojson-transport-ws");
  const peers: unknown[] = [];
  let arrived: () => void = () => {};
  const connected = new Promise<void>((r) => (arrived = r));
  const temporary = new WebSocketPeerWithReconnection({
    peer: url,
    reconnectionTimeout: undefined,
    addPeer: (peer: unknown) => {
      peers.push(peer);
      arrived();
    },
    removePeer: () => {},
  } as never) as unknown as { enable(): void; disable(): void };

  temporary.enable();
  try {
    await Promise.race([connected, new Promise((r) => setTimeout(r, 3_000))]);
    if (peers.length === 0) return null; // nothing answered; the caller falls back
    return await Promise.race([
      load(peers as never[]).catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), waitMs)),
    ]);
  } catch {
    return null;
  } finally {
    temporary.disable();
  }
}

// cojson logs `console.error("Error withLoadedAccount", …)` for every account load that fails, and
// then throws. One failure is expected on every device's first sync: `openAccountNode` loads the
// account from local storage first and creates it when it is not there yet ("unavailable"), which
// is the designed path, not an error. Left alone it put an error in the console of every first
// sync (found by e2e/console-guard.ts). Only that one message is dropped, and only for
// "unavailable": every other failure is still logged, and an unavailable account that is NOT
// created reaches the caller as the error it is.
cojsonLogger.setLogSystem({
  debug: (message, attributes) => console.debug(message, attributes),
  info: (message, attributes) => console.info(message, attributes),
  warn: (message, attributes) => console.warn(message, attributes),
  error: (message, attributes) => {
    const err = (attributes as { err?: unknown } | undefined)?.err;
    if (message === "Error withLoadedAccount" && /unavailable/i.test(err instanceof Error ? err.message : String(err))) return;
    console.error(message, attributes);
  },
});

/** The storage opening in progress, if any: the next one waits for it. */
let lastStorageOpening: Promise<unknown> = Promise.resolve();

/**
 * cojson's storage over a driver, one opening at a time.
 *
 * Opening storage runs cojson's schema migrations: it reads `user_version`, then runs every migration
 * past it. The worker database is SHARED — one connection per name for every caller, each with its
 * own driver wrapper (see `openWorkerSqlite`) — so an app's store and the launcher's account read can
 * open storage over the same database at the same moment. Both then read version 0, both run the
 * migrations, and the second dies on "duplicate column name: bytesSinceLastSignature", failing the
 * app's boot on a device's first sync. Queued, the second reads the version the first wrote and runs
 * nothing. Openings are a handful per boot, so one queue for all of them costs nothing measurable.
 */
export function storageOver(driver: SqliteDriverAsync): ReturnType<typeof getSqliteStorageAsync> {
  const opening = lastStorageOpening.then(() => getSqliteStorageAsync(driver as never));
  lastStorageOpening = opening.catch(() => undefined);
  return opening;
}

/**
 * The account half of opening a store: the device's identity, its profile, and the relay — without
 * any app's space.
 *
 * Split out because a device that has just been linked with the recovery words has NO apps yet, and
 * the one thing it needs before it can have any is to read its own account (see `account-apps.ts`).
 * Going through `createJazzStore` for that would have meant inventing an app id and leaving a space
 * behind for an app that does not exist.
 */
export async function openAccountNode(
  opts: Omit<CreateJazzStoreOpts, "peers" | "expectExisting"> & {
    peers?: unknown[];
    /**
     * See `CreateJazzStoreOpts.expectExisting`. A function is asked at the moment it matters, which
     * is how a shared opening (`deviceNode`) hears a caller that joined it after it began.
     */
    expectExisting?: boolean | (() => boolean);
  },
): Promise<{
  node: InstanceType<typeof LocalNode>;
  accountID: string;
  relay?: RelayConnection;
  whenDurable: () => Promise<void>;
}> {
  const keys = opts.keys ?? browserKeys();
  const crypto = opts.crypto as never;
  const peers = (opts.peers ?? []) as never[];

  // A driver the caller already holds (worker-hosted SQLite) is used as it is; otherwise one is
  // built over the handle it passed. Only the storage differs — everything below is identical.
  const driver = opts.driver ?? (opts.db ? createJazzSqliteDriver(opts.db) : null);
  if (!driver) throw new Error("createJazzStore needs either a database handle or a driver.");
  const storage = await storageOver(driver);
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
    // Identity was minted by `@potyro/identity` with crypto alone — no database, no node — so the
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
    // A device that was linked asks the relay FIRST, because for it "not here" means "not yet",
    // never "does not exist". Bounded, so a dead relay costs seconds rather than the tens of seconds
    // the no-peers path exists to avoid — and if the wait runs out, the paths below still apply.
    const expecting = (): boolean =>
      typeof opts.expectExisting === "function" ? opts.expectExisting() : Boolean(opts.expectExisting);
    const throughRelay = (): Promise<InstanceType<typeof LocalNode> | null> =>
      opts.relay ? loadAccountThroughRelay(opts.relay, (p) => loadAccount(opts.account!.id, opts.account!.secret, p)) : Promise.resolve(null);
    const askedRelay = expecting() && !!opts.relay;
    const fromPeers = askedRelay ? await throughRelay() : null;
    try {
      node = fromPeers ?? (await loadAccount(opts.account.id, opts.account.secret, [] as never[]));
    } catch (e) {
      // Narrow on purpose: only "there is no account here" is a reason to create one. Any other
      // failure (corrupt storage, bad secret) must surface rather than silently mint a second
      // identity and strand the person's spaces.
      if (!/unavailable/i.test(e instanceof Error ? e.message : String(e))) throw e;
      // Asked once more before minting: someone sharing this opening may have said, since the first
      // answer, that the account exists elsewhere (see `deviceNode`).
      const late = !askedRelay && expecting() ? await throughRelay() : null;
      if (late) node = late;
      else {
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
  // A node opened by an earlier caller has already published the name; this caller's name may be
  // newer (renaming yourself must reach everyone), so it is published again, as every open does.
  if (opts.opened && opts.profileName) await publishProfileName(opts.opened.node, opts.profileName);
  const { node, accountID, relay, whenDurable } = opts.opened ?? (await openAccountNode(opts));
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
    spaceBudget: opts.spaceBudget,
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
/**
 * A node for reading the ACCOUNT in a browser, with no app open — the browser half of
 * {@link openAccountNode}, wired the way {@link openJazzStore} wires an app.
 *
 * Needed at exactly one moment: the first boot after signing in with the recovery words, when the
 * device is you but has no apps. Opening an app to get a node would create a space for an app that
 * does not exist, and the shell cannot build a node itself — cojson stays inside this package.
 */
/**
 * Write down where an app's space lives, for an app arriving from somewhere other than this device.
 *
 * Three keys, not two. The group and the root are the obvious ones — without them the store mints a
 * fresh empty space and the data already on the relay is stranded beside it. The third is the
 * database MARKER, and leaving it out is its own kind of stranding: `openJazzStore` reads "a group
 * id, but no marker" as an app created before the device database existed, and sends it to a
 * per-app file that was never there. The app then opens, empty, next to its own data.
 *
 * Exported because the two callers that need it — a restored app and a joined space — are in the
 * shell, and the shape of these keys is this module's business.
 */
export function peekAppSpace(namespace: string, keys?: JazzKeyStore): { group: string; root: string } | null {
  const store = keys ?? browserKeys();
  const group = store.get(groupKey(namespace));
  const root = store.get(rootKey(namespace));
  return group && root ? { group, root } : null;
}

export function rememberAppSpace(namespace: string, ids: { group: string; root: string }, keys?: JazzKeyStore): void {
  const store = keys ?? browserKeys();
  store.set(groupKey(namespace), ids.group);
  store.set(rootKey(namespace), ids.root);
  store.set(dbKey(namespace), DEVICE_DB);
}

/**
 * Start the device database's worker now, so the first app that syncs does not wait for it.
 *
 * Opening it costs a worker spawn plus the SQLite module and its OPFS pool — a second or so, paid
 * once. Left until an app is opened, that second lands squarely between tapping an app and seeing
 * it. Called at boot for a device that syncs anything; everyone else spawns nothing, because a
 * device that has never synced has not asked for a database at all.
 *
 * Deliberately swallows failure: this is a head start, and the real open reports its own problems.
 */
export async function warmDeviceDatabase(): Promise<void> {
  try {
    const { openWorkerSqlite, workersAvailable } = await import("./sqlite-worker-client.js");
    if (workersAvailable()) await openWorkerSqlite(DEVICE_DB);
  } catch {
    /* the fallbacks are still there when the real open happens */
  }
}

export async function openAccountNodeInBrowser(opts?: {
  keys?: JazzKeyStore;
  profileName?: string;
  relay?: string;
  account?: { id: string; secret: string };
  /** This device was linked with the recovery words. See `CreateJazzStoreOpts.expectExisting`. */
  expectExisting?: boolean;
}): Promise<{ node: unknown; accountID: string } | null> {
  try {
    // The device database, by the same name every app uses — this reads what they wrote, and on the
    // same node an app open in this page is using (see `deviceNode`).
    const { opened } = await deviceNode(DEVICE_DB, opts ?? {});
    return { node: opened.node, accountID: opened.accountID };
  } catch {
    // A device that cannot open its account simply has nothing to offer; boot carries on. That
    // includes another tab owning the storage: reading a second copy of the account here would be
    // reading the wrong one, and the tab already says so in words (onStorageElsewhere).
    return null;
  }
}

/** The device database, opened the one way every caller must open it, and a crypto to go with it. */
async function openDeviceDatabase(dbName: string): Promise<{
  db?: SqliteDbHandle;
  driver?: SqliteDriverAsync;
  /** The IndexedDB fallback only: the snapshot a write must also wait for. */
  whenPersisted?: () => Promise<void>;
  crypto: unknown;
}> {
  const [{ openOpfsDb }, { openIdbSqliteDb, idbAvailable }, { WasmCrypto }, { openWorkerSqlite, workersAvailable }] = await Promise.all([
    import("./sqlite-backend.js"),
    import("./idb-sqlite.js"),
    import("cojson/crypto/WasmCrypto"),
    import("./sqlite-worker-client.js"),
  ]);

  // A worker FIRST, and in practice always: `createSyncAccessHandle` is worker-only by
  // specification, so the main-thread OPFS attempt below has never once succeeded — in any engine.
  // The fallbacks are what every device used to get, and both are bad in a way that grows: the
  // IndexedDB one rewrites the entire database after every write.
  let db: Awaited<ReturnType<typeof openOpfsDb>> | undefined;
  let driver: SqliteDriverAsync | undefined;
  let whenPersisted: (() => Promise<void>) | undefined;
  if (workersAvailable()) {
    try {
      driver = (await openWorkerSqlite(dbName)).driver;
    } catch (err) {
      // Another tab owns the storage. Falling back would open a second, stale copy of the device's
      // database and write to it — the split this refuses (storage-owner.ts).
      if (isStorageElsewhere(err)) throw err;
      // No worker, or no OPFS. Sync matters more than speed.
      console.info(`[potyro] storage: no worker database (${err instanceof Error ? err.message : String(err)}), falling back`);
      driver = undefined;
    }
  }
  if (driver) console.info("[potyro] storage: SQLite in a worker, on OPFS");
  if (!driver) {
    try {
      db = await openOpfsDb(dbName);
    } catch {
      if (!idbAvailable()) throw new Error("This browser has neither OPFS nor IndexedDB, so sync cannot be enabled.");
      const idb = await openIdbSqliteDb(dbName);
      db = idb.db;
      whenPersisted = idb.whenPersisted;
    }
  }
  return { db, driver, whenPersisted, crypto: await WasmCrypto.create() };
}

/** A node on the device account, and what a write on the IndexedDB fallback must also wait for. */
interface DeviceNode {
  opened: OpenedAccountNode;
  whenPersisted?: () => Promise<void>;
}

/**
 * The page's nodes on the device account: ONE per database (and relay), shared by every caller.
 *
 * Each app opened in a page, and the boot code that reads the account, used to open a `LocalNode`
 * of its own over the same device database: its own session, its own copy of the account in memory,
 * its own socket to the relay, all writing through one storage worker. That went wrong in a way
 * measured but not taken apart inside cojson (#463). In Firefox under load, a page reloaded with a
 * synced app open had two nodes on `karta-jazz`; one wrote to the account (the app list, the Studio
 * conversations), and that write, reaching the other node through the relay, was refused as
 * `InvalidSignature`, which marks the account errored for that relay. Either node's write, refused
 * by the other: in 4 of 36 runs of sync-toggle-trusted's reload test on a loaded machine, against
 * none in 30 with one node. Nothing was ever gained by the second node: it is the same person, on
 * the same file.
 *
 * Keyed by the relay too, so a page asked for a different relay is given what it asked for. The
 * opening is remembered, not just the node, so two callers at the same moment share one; a failed
 * one is forgotten, so the next caller tries again (another tab may have let go of the storage).
 *
 * Only for an identity passed in (`account`): the shell always passes one. Without it the account is
 * whatever `keys` remembers, which is how the store's own tests open several devices in one process.
 *
 * ## Who decides how the account is found
 *
 * Whoever registers first starts the opening, but `expectExisting` (a device linked with the recovery
 * words: ask the relay for the account before minting it locally) is not part of the key, so it
 * cannot be the first caller's alone to decide. The rule: while an opening has not settled, ANY
 * caller sharing it that passes `expectExisting` makes it ask the relay first — it is read when the
 * account is resolved, and once more before minting one, not when the opening began. An invite
 * accepted at boot and the boot account reader arrive in either order, and the reader's say counts
 * either way. Once the opening has settled the account is resolved, and a later `expectExisting`
 * has nothing left to change.
 *
 * ## Not yet: legacy per-app databases
 *
 * Apps recorded before the database move keep their own `${appId}-jazz` file (see `openJazzStore`),
 * and a node is per database — so each of those still gets a node of its own on the same account,
 * beside this one: the two-nodes-on-one-account shape this exists to remove. Migrating those spaces
 * into the device database is a follow-up; until then legacy apps keep the hazard.
 */
const deviceNodes = new Map<string, { opening: Promise<DeviceNode>; expectExisting: boolean }>();

async function deviceNode(
  dbName: string,
  opts: Pick<CreateJazzStoreOpts, "keys" | "profileName" | "relay" | "account" | "expectExisting">,
): Promise<DeviceNode> {
  const key = opts.account ? [dbName, opts.account.id, opts.relay ?? ""].join("\n") : null;
  const known = key ? deviceNodes.get(key) : undefined;
  if (known) {
    // Heard by a pending opening; a settled one has already resolved the account.
    if (opts.expectExisting) known.expectExisting = true;
    return known.opening;
  }
  const shared = { opening: undefined as unknown as Promise<DeviceNode>, expectExisting: Boolean(opts.expectExisting) };
  const opening = (async (): Promise<DeviceNode> => {
    const { db, driver, whenPersisted, crypto } = await openDeviceDatabase(dbName);
    // A relay is OPTIONAL and additive. With none, this is a durable local-only store and no socket
    // is ever opened — ADR D3's "solo = a space with one member, no transport". The relay only ever
    // sees ciphertext (measured: docs/spikes/jazz-selfhost-e2e.mjs), so pointing this at a
    // self-hosted `jazz-run sync` is the whole self-host story. It is attached to the node, not
    // passed as a peer, because reconnecting means replacing the peer repeatedly and only the node
    // can be given a new one.
    const opened = await openAccountNode({
      db,
      driver,
      crypto,
      keys: opts.keys,
      profileName: opts.profileName,
      account: opts.account,
      relay: opts.relay,
      expectExisting: () => shared.expectExisting,
    });
    return { opened, whenPersisted };
  })();
  shared.opening = opening;
  if (key) {
    deviceNodes.set(key, shared);
    opening.catch(() => {
      if (deviceNodes.get(key) === shared) deviceNodes.delete(key);
    });
  }
  return opening;
}

export async function openJazzStore(
  appId: string,
  opts?: {
    keys?: JazzKeyStore;
    peers?: unknown[];
    profileName?: string;
    relay?: string;
    /** The device account from `@potyro/identity`. See `CreateJazzStoreOpts.account`. */
    account?: { id: string; secret: string };
    /** This device was linked with the recovery words. See `CreateJazzStoreOpts.expectExisting`. */
    expectExisting?: boolean;
    /** See `CreateJazzStoreOpts.spaceBudget`. */
    spaceBudget?: number;
  },
): Promise<JazzStoreHandle> {
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
  // `potyro:jazz:db:<ns>` records which file an app uses, written the first time it is opened from
  // here on. If that marker is ABSENT but a group id is present, the space was created before this
  // existed and its data is in the legacy per-app file — so that is what gets opened, permanently.
  // Deterministic, with no probing of storage that would create the very file it is testing for.
  const keys = opts?.keys ?? browserKeys();
  const recorded = keys.get(dbKey(appId));
  const predatesMove = !recorded && !!keys.get(groupKey(appId));
  const dbName = recorded ?? (predatesMove ? `${appId}-jazz` : DEVICE_DB);
  keys.set(dbKey(appId), dbName);

  const nodeOpts = {
    keys,
    profileName: opts?.profileName,
    account: opts?.account,
    relay: opts?.relay,
    expectExisting: opts?.expectExisting,
  };
  let handle: JazzStoreHandle;
  let whenPersisted: (() => Promise<void>) | undefined;
  if (opts?.peers?.length) {
    // Peers handed in are this caller's own, so this space gets a node of its own to carry them.
    const device = await openDeviceDatabase(dbName);
    whenPersisted = device.whenPersisted;
    handle = await createJazzStore(appId, { ...nodeOpts, ...device, peers: [...opts.peers], spaceBudget: opts?.spaceBudget });
  } else {
    const device = await deviceNode(dbName, nodeOpts);
    whenPersisted = device.whenPersisted;
    handle = await createJazzStore(appId, { ...nodeOpts, crypto: undefined, opened: device.opened, spaceBudget: opts?.spaceBudget });
  }
  if (!whenPersisted) return handle;

  // On the IndexedDB path a cojson flush only reaches the in-memory database; the snapshot to IDB
  // is what actually survives a reload. Both must complete before a write is called durable.
  const cojsonDurable = handle.whenDurable;
  const persisted = whenPersisted;
  const both = async (): Promise<void> => {
    await cojsonDurable();
    await persisted();
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
  const stopReviving = reviveOnResume(relay);
  return {
    get connected() {
      return relay.connected;
    },
    subscribe: (l) => relay.subscribe(l),
    unsubscribe: (l) => relay.unsubscribe(l),
    disable: () => {
      stopReviving();
      relay.disable();
    },
  };
}

/** The part of a relay connection that resuming needs. */
export interface Revivable {
  connected: boolean;
  enable(): void;
  disable(): void;
}

/**
 * Bring the relay back when the page does.
 *
 * A phone browser that is open but not in front is FROZEN by Android: its socket is torn down and
 * every reconnection attempt fails while it cannot run. `WebSocketPeerWithReconnection` backs off
 * linearly per attempt, so by the time someone switches back the next try can be a long way off —
 * and nothing was listening for the page becoming visible to bring it forward. Reported as "the
 * browser is open but not on focus: no balloon, no notification; if I close it and open it again
 * the messages are there" — a reload reconnects, returning to a backgrounded tab did not.
 *
 * Cycling rather than waiting, because a socket that survived the freeze may be half-open: the OS
 * dropped the connection without the page ever seeing a close, so `connected` still says true and
 * nothing will ever arrive on it. A reconnect costs a resync the library already does on every
 * reconnection; a zombie socket costs every message from here on.
 *
 * Only after a real absence (`MIN_AWAY_MS`), so flicking between tabs does not churn the connection.
 */
const MIN_AWAY_MS = 3_000;

export function reviveOnResume(relay: Revivable, scope: EventTargetish = globalThis as EventTargetish): () => void {
  const doc = (scope as { document?: EventTargetish & { visibilityState?: string } }).document;
  if (!doc?.addEventListener) return () => {};
  let hiddenAt: number | null = null;

  const onVisibility = (): void => {
    if (doc.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    if (away < MIN_AWAY_MS) return;
    relay.disable();
    relay.enable();
  };
  // `online` matters on its own: a phone that regained signal while in the foreground gets the same
  // treatment, and the backoff is just as stale there.
  const onOnline = (): void => {
    if (relay.connected) return;
    relay.disable();
    relay.enable();
  };

  doc.addEventListener("visibilitychange", onVisibility);
  scope.addEventListener?.("online", onOnline);
  return () => {
    doc.removeEventListener?.("visibilitychange", onVisibility);
    scope.removeEventListener?.("online", onOnline);
  };
}

/** The slice of `window`/`document` this needs — so a test can hand it a fake. */
export interface EventTargetish {
  addEventListener?(type: string, fn: () => void): void;
  removeEventListener?(type: string, fn: () => void): void;
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
    /** The device account from `@potyro/identity` — you join a space AS someone. */
    account?: { id: string; secret: string };
    /** This device was linked with the recovery words. See `CreateJazzStoreOpts.expectExisting`. */
    expectExisting?: boolean;
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
    expectExisting: opts?.expectExisting,
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
    // "Me" is the ABSENCE of a name, so it never replaces one. Every open republishes this device's
    // name, and a device just linked has no name of its own yet — without this, linking a second
    // device renamed the person to "Me" for everyone they had ever shared with.
    const current = profile.get("name");
    if (name === DEFAULT_PROFILE_NAME && typeof current === "string" && current && current !== DEFAULT_PROFILE_NAME) return;
    if (current !== name) profile.set("name", name, "trusting");
  } catch (e) {
    // Never block opening an app on this.
  }
}

/**
 * Put a display name on this account, given only a node.
 *
 * `publishName` needs an open app; naming yourself does not. Someone who renames themselves on the
 * launcher — with no app open, which is exactly where that control lives — was writing the name to
 * this browser and nowhere else, so a device linked later came up as "Me" and the people shared with
 * saw the same person under two names.
 */
export async function publishAccountName(node: unknown, name: string): Promise<void> {
  await publishProfileName(node, name);
}

/**
 * The display name already on this account, if it has one.
 *
 * The counterpart to publishing it. A device that signs in with the recovery words is the same
 * person, but the name lived only in the localStorage of whichever device set it — so a linked
 * phone called itself "Me" while the laptop had a name, and everyone shared with saw both. The
 * account profile is the copy that syncs; this reads it.
 *
 * Best-effort, like its twin: a profile that has not arrived yet is a name that stays as it was.
 */
export async function readProfileName(node: unknown): Promise<string | null> {
  try {
    const n = node as {
      expectCurrentAccount(hint: string): Promise<{ get(k: string): unknown }>;
      load(id: string): Promise<unknown>;
    };
    const account = await n.expectCurrentAccount("profile");
    const profileId = account.get("profile");
    if (typeof profileId !== "string") return null;
    const profile = (await n.load(profileId)) as { get(k: string): unknown } | "unavailable";
    if (!profile || profile === "unavailable") return null;
    const name = profile.get("name");
    return typeof name === "string" && name.trim() ? name : null;
  } catch {
    return null;
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
