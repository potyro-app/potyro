// What the service's parts share: who the account is, its key, how it reaches the disk and other
// servers, its limits, and the book: what it knows right now. Each value in the book is replaced,
// never changed in place, and written to the store as it is replaced.
import type { Outbound } from "./net.ts";
import type { Addresses, Profile } from "./objects.ts";
import type { FediStore, Parts } from "./store.ts";

export interface FediRequest {
  method: string;
  path: string;
  /** The query as it was asked, with its `?`, or "". */
  query: string;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
  ip: string;
}

export interface FediResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface Limits {
  /** Requests of any kind from one address (IPv6: its /64) in a clock minute. */
  requestsPerMinute: number;
  /** The biggest activity the inbox reads. */
  inboxBytes: number;
  /** Followers kept; a follow past this is told to come back later. */
  maxFollowers: number;
  /** Followers kept from one server: one server cannot fill the list. */
  maxFollowersPerHost: number;
  /** Accounts looked up on other servers in a clock minute, all senders together. */
  lookupsPerMinute: number;
  /** And for one sending address (IPv6: its /64), so one sender cannot spend everyone's. */
  lookupsPerAddressMinute: number;
  /** Deliveries waiting; past this a follow is told to come back later. */
  maxWaiting: number;
}

export const DEFAULT_LIMITS: Limits = {
  requestsPerMinute: 300,
  inboxBytes: 256_000,
  maxFollowers: 20_000,
  maxFollowersPerHost: 5_000,
  lookupsPerMinute: 60,
  lookupsPerAddressMinute: 6,
  maxWaiting: 100_000,
};

export interface Book extends Parts {
  /** True until the account has posted for the first time. */
  fresh: boolean;
}

export interface Core {
  profile: Profile;
  at: Addresses;
  store: FediStore;
  outbound: Outbound;
  now: () => number;
  /** A short random word, for the ids of the account's own activities. */
  token: () => string;
  privateKeyPem: string;
  publicKeyPem: string;
  limits: Limits;
  onError: (error: unknown) => void;
  book: Book;
}

export const USER_AGENT = "potyro-fediverse/1";

/** How many times something happened in the current clock minute, and whether that is over `max`. */
export function minuteCounter(now: () => number): (key: string, max: number) => boolean {
  let minute = -1;
  let counts = new Map<string, number>();
  return (key, max) => {
    const current = Math.floor(now() / 60_000);
    if (current !== minute) {
      minute = current;
      counts = new Map();
    }
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return n > max;
  };
}
