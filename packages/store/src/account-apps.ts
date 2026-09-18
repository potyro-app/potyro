// Which apps are yours, kept on your ACCOUNT rather than on a device (KA-16 follow-up).
//
// Typing the recovery words on a new device already makes it you — same account, same membership of
// every space you are in. What it could not do was tell it what you HAVE: the list of apps lives in
// each browser's localStorage, and so do the ids of the spaces holding their data. So a linked
// device came up correctly attributed and completely empty, and the only way to get anything onto it
// was to share each app to yourself, by hand, from the device that still had it.
//
// This is the missing half: a map on your account, `appId -> what it takes to open that app`. It is
// written by the device that has the app, encrypted to your account's keys, and stored on the relay
// like any other CoValue — the relay cannot read it. A new device signs in, reads the map, and can
// then ask for exactly the spaces it names.
//
// Deliberately small: what an app IS (its id, name, icon and source) and WHERE its data is (the
// group and root ids), plus enough about its size for a device to be asked which ones it wants
// before it downloads a phone's worth of photos. Not the data itself — that is already in the
// space, which is the whole point of naming it here.

/** One app, as your account knows it. */
export interface AccountApp {
  id: string;
  name: string;
  icon?: string;
  /** The app's code, so a new device can run it before any of its data has arrived. */
  source: string;
  /** The space holding its data: the group that owns it, and the root the store hangs off. */
  group: string;
  root: string;
  /** Roughly how much there is to fetch, so "load your apps?" can be honest about a 400 MB one. */
  sizeBytes?: number;
  /** Whether this app is shared with other people, which is a different thing from being yours. */
  shared?: boolean;
  updatedAt: string;
}

/** The key on the account CoMap pointing at the registry. */
const REGISTRY = "kartaApps";

interface CoMapish {
  id: string;
  get(key: string): unknown;
  set(key: string, value: unknown, privacy?: string): void;
  /** cojson's CoMap lists its keys through a METHOD; the first version of this read it as an array
   *  and every write came back invisible. */
  keys(): string[];
}

interface Nodeish {
  expectCurrentAccount(hint: string): Promise<CoMapish>;
  load(id: string): Promise<CoMapish | "unavailable">;
  createGroup(): { id: string; createMap(): CoMapish };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A stored entry, back as an `AccountApp` — or null when it is not one (an older or partial write). */
function parse(id: string, raw: unknown): AccountApp | null {
  if (typeof raw !== "string") return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v)) return null;
    const { name, source, group, root } = v;
    if (typeof name !== "string" || typeof source !== "string" || typeof group !== "string" || typeof root !== "string") {
      return null;
    }
    return {
      id,
      name,
      source,
      group,
      root,
      icon: typeof v.icon === "string" ? v.icon : undefined,
      sizeBytes: typeof v.sizeBytes === "number" ? v.sizeBytes : undefined,
      shared: v.shared === true,
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * The registry CoMap, creating it the first time.
 *
 * Owned by a group of its own with the account as its only member, so it is encrypted to you and to
 * nobody else — unlike the profile, which is deliberately readable by the people you share with.
 * Its id is kept on the account CoMap, which is the only thing a new device can reach knowing just
 * the words.
 */
async function registry(node: Nodeish, create: boolean): Promise<CoMapish | null> {
  const account = await node.expectCurrentAccount("karta apps");
  const existing = account.get(REGISTRY);
  if (typeof existing === "string") {
    const loaded = await node.load(existing);
    if (loaded && loaded !== "unavailable") return loaded;
    // Named but unreachable: this device cannot see it yet (offline, or still syncing). Creating a
    // second one here would split the list in two, and the copy a later device found would be
    // whichever won the race — so this is a "not now", never a "make another".
    return null;
  }
  if (!create) return null;
  const map = node.createGroup().createMap();
  account.set(REGISTRY, map.id, "private");
  return map;
}

/** Record (or update) one app on your account. Best-effort: never fail an app over its backup. */
export async function publishAppToAccount(node: unknown, app: AccountApp): Promise<boolean> {
  try {
    const map = await registry(node as Nodeish, true);
    if (!map) return false;
    const { id, ...rest } = app;
    map.set(id, JSON.stringify(rest), "private");
    return true;
  } catch {
    return false;
  }
}

/** Forget an app: it was deleted, and a new device should not offer to bring it back. */
export async function removeAppFromAccount(node: unknown, appId: string): Promise<boolean> {
  try {
    const map = await registry(node as Nodeish, false);
    if (!map) return false;
    map.set(appId, "", "private");
    return true;
  } catch {
    return false;
  }
}

/** Every app your account knows about. Empty when there is no registry yet, or it has not arrived. */
export async function readAccountApps(node: unknown): Promise<AccountApp[]> {
  try {
    const map = await registry(node as Nodeish, false);
    if (!map) return [];
    const out: AccountApp[] = [];
    const keys = typeof map.keys === "function" ? map.keys() : [];
    for (const key of keys) {
      const app = parse(key, map.get(key));
      if (app) out.push(app);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
