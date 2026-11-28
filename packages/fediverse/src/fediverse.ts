// The gallery's fediverse account, put together (docs/33): give it who the account is, where it
// keeps things and how it reaches other servers; it answers requests, takes the gallery's feed, and
// delivers what is due. server.ts runs it as a process; the tests run it in memory.
import { createPublicKey, randomBytes } from "node:crypto";
import { DEFAULT_LIMITS, type Core, type FediRequest, type FediResponse, type Limits } from "./core.ts";
import { deliverer, syncFeed, type DeliveryRound, type SyncResult } from "./delivery.ts";
import type { Feed } from "./feed.ts";
import { createHandler } from "./handler.ts";
import type { Outbound } from "./net.ts";
import { addressesOf, type Profile } from "./objects.ts";
import { EMPTY, type FediStore } from "./store.ts";

export type { FediRequest, FediResponse, Limits } from "./core.ts";
export type { Profile } from "./objects.ts";
export type { DeliveryRound, SyncResult } from "./delivery.ts";

export interface FediverseOptions {
  profile: Profile;
  store: FediStore;
  outbound: Outbound;
  limits?: Partial<Limits>;
  now?: () => number;
  onError?: (error: unknown) => void;
}

export interface Fediverse {
  handle(req: FediRequest): Promise<FediResponse>;
  /** Takes the gallery's feed and posts what changed. */
  sync(feed: Feed): Promise<SyncResult>;
  /** Sends what is due. */
  deliver(): Promise<DeliveryRound>;
  followers(): number;
  waiting(): number;
}

/** The profile, checked: an origin that is one, and a name a handle can carry. */
export function checkProfile(profile: Profile): Profile {
  const origin = new URL(profile.origin);
  if (origin.protocol !== "https:" || origin.origin !== profile.origin) throw new Error(`the account's origin must be like https://example.com, got "${profile.origin}"`);
  if (!/^[a-z0-9_]{1,30}$/.test(profile.username)) throw new Error(`the account's name must be lowercase letters, digits or _, got "${profile.username}"`);
  if (!profile.assets.endsWith("/")) throw new Error(`the pictures' address must end with /, got "${profile.assets}"`);
  return profile;
}

export async function createFediverse(opts: FediverseOptions): Promise<Fediverse> {
  const profile = checkProfile(opts.profile);
  const { store } = opts;
  const privateKeyPem = await store.privateKey();
  const notes = await store.read("notes");
  const core: Core = {
    profile,
    at: addressesOf(profile),
    store,
    outbound: opts.outbound,
    now: opts.now ?? Date.now,
    token: () => randomBytes(9).toString("base64url"),
    privateKeyPem,
    publicKeyPem: createPublicKey(privateKeyPem).export({ type: "spki", format: "pem" }).toString(),
    limits: { ...DEFAULT_LIMITS, ...opts.limits },
    onError: opts.onError ?? (() => undefined),
    book: {
      feed: await store.read("feed"),
      fresh: notes === null,
      notes: notes ?? EMPTY.notes,
      followers: (await store.read("followers")) ?? EMPTY.followers,
      outgoing: (await store.read("outgoing")) ?? EMPTY.outgoing,
    },
  };
  // One feed at a time: a second waits for the first, whether it was taken or refused.
  let last: Promise<unknown> = Promise.resolve();
  const sync = (feed: Feed): Promise<SyncResult> => {
    const next = last.catch(() => undefined).then(() => syncFeed(core, feed));
    last = next;
    return next;
  };
  return {
    handle: createHandler(core),
    sync,
    deliver: deliverer(core),
    followers: () => Object.keys(core.book.followers).length,
    waiting: () => core.book.outgoing.deliveries.length,
  };
}
