// What the account keeps: its key, which apps it has posted, who follows it, what is still to be
// delivered, and the gallery's feed as it last took it. Four parts, each written whole when it
// changes; an interface so everything is tested in memory and runs on disk (disk.ts).
//
// A follower is the least that delivering to them takes: their address, their inbox, and their key
// (so that "I stop following" and "this account is gone" can be checked without asking their
// server again). Nothing they post is ever kept.
import { generateKeyPairSync } from "node:crypto";
import type { Feed } from "./feed.ts";
import type { Json } from "./objects.ts";

export interface Follower {
  /** The account's ActivityPub address. */
  id: string;
  inbox: string;
  sharedInbox?: string;
  keyId: string;
  publicKeyPem: string;
  /** ISO time they followed. */
  since: string;
}

export interface PostedNote {
  /** Hash of what the post says (objects.ts noteHash). */
  hash: string;
  published: string;
  updated?: string;
}

export interface Notes {
  posted: Record<string, PostedNote>;
  /** Apps that left the gallery, by id → ISO time: their posts answer 410. */
  gone: Record<string, string>;
}

export interface Delivery {
  /** The activity's id, a key of `activities`. */
  activity: string;
  inbox: string;
  attempts: number;
  /** Epoch ms of the next try. */
  nextAt: number;
}

export interface Outgoing {
  activities: Record<string, Json>;
  deliveries: Delivery[];
  /** Inboxes deliveries are failing at, by address → epoch ms of the first failure with no success since. */
  failing: Record<string, number>;
}

export interface Parts {
  /** The gallery's feed as last taken: what the posts are drawn from when the file is not there. */
  feed: Feed | null;
  notes: Notes;
  followers: Record<string, Follower>;
  outgoing: Outgoing;
}

export const EMPTY: Parts = {
  feed: null,
  notes: { posted: {}, gone: {} },
  followers: {},
  outgoing: { activities: {}, deliveries: [], failing: {} },
};

export interface FediStore {
  read<K extends keyof Parts>(part: K): Promise<Parts[K] | null>;
  write<K extends keyof Parts>(part: K, value: Parts[K]): Promise<void>;
  /** The account's private key (PEM), made the first time it is asked for and the same ever after. */
  privateKey(): Promise<string>;
}

/** A new key for an account: RSA 2048, what every fediverse server reads. */
export const newPrivateKey = (): string =>
  generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } }).privateKey;

export function memoryStore(key?: string): FediStore & { writes(): number } {
  const parts: Partial<Parts> = {};
  let pem = key;
  let writes = 0;
  return {
    read: async (part) => parts[part] ?? null,
    write: async (part, value) => {
      parts[part] = value;
      writes += 1;
    },
    privateKey: async () => (pem ??= newPrivateKey()),
    writes: () => writes,
  };
}
