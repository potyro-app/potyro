// What the tests share: a profile, a small feed, and a pretend fediverse — other servers with
// accounts and keys of their own, reached through an `Outbound` that never touches the network.
import { generateKeyPairSync } from "node:crypto";
import type { FediRequest } from "../src/core.ts";
import { FEED_FORMAT, type Feed, type FeedApp } from "../src/feed.ts";
import type { Outbound, OutboundRequest } from "../src/net.ts";
import type { Json, Profile } from "../src/objects.ts";
import { signedHeaders } from "../src/signature.ts";

export const PROFILE: Profile = {
  origin: "https://potyro.example",
  username: "apps",
  name: "Potyro apps",
  summary: "Apps & more",
  profileUrl: "https://potyro.example/apps/",
  assets: "https://potyro.example/",
  icon: "https://potyro.example/icon-512.png",
};

export const ACTOR = "https://potyro.example/fedi/actor";
export const INBOX = "https://potyro.example/fedi/inbox";
export const T0 = Date.parse("2026-11-28T12:00:00Z");

const two = (en: string, pt: string) => ({ en, "pt-BR": pt });

export const app = (id: string, over: Partial<FeedApp> = {}): FeedApp => ({
  id,
  publishedAt: "2026-11-06T21:21:06.442Z",
  link: `https://potyro.app/s/${id}#k=abc`,
  remix: `https://potyro.app/s/${id}#k=abc&remix=1`,
  name: two(`Name of ${id}`, `Nome de ${id}`),
  line: two("A list <for> the house", "Uma lista para a casa"),
  image: { path: `shots/en/${id}-light-824.webp`, mediaType: "image/webp", width: 824, height: 1648 },
  ...over,
});

export const feed = (apps: FeedApp[]): Feed => ({
  format: FEED_FORMAT,
  languages: ["en", "pt-BR"],
  words: { tryIt: two("Try it", "Experimentar"), makeItMine: two("Make it mine", "Tornar meu"), shotAlt: two("{name}, as it opens", "{name}, ao abrir") },
  apps,
});

const keyPair = () => generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });

/** Made once: a 2048-bit key takes a moment. */
export const KEYS = { ours: keyPair(), theirs: keyPair(), other: keyPair() };

export interface Account {
  id: string;
  inbox: string;
  sharedInbox: string;
  keyId: string;
  privateKey: string;
  doc: Json;
}

/** An account on another server, `https://<host>/users/<name>`, with that server's shared inbox. */
export function account(host: string, name: string, keys = KEYS.theirs): Account {
  const id = `https://${host}/users/${name}`;
  const keyId = `${id}#main-key`;
  const inbox = `${id}/inbox`;
  const sharedInbox = `https://${host}/inbox`;
  return { id, inbox, sharedInbox, keyId, privateKey: keys.privateKey, doc: { id, type: "Person", inbox, endpoints: { sharedInbox }, publicKey: { id: keyId, owner: id, publicKeyPem: keys.publicKey } } };
}

export interface World {
  outbound: Outbound;
  /** Every request the service made, oldest first. */
  asked: OutboundRequest[];
  posts(): Array<{ url: string; activity: Json; request: OutboundRequest }>;
  /** What each POST is answered with, by inbox address; 202 when not said. */
  answers: Record<string, number | "error">;
}

/** The other servers: GET an account's address → its document; POST to an inbox → recorded. */
export function world(accounts: Account[]): World {
  const asked: OutboundRequest[] = [];
  const answers: Record<string, number | "error"> = {};
  const outbound: Outbound = async (request) => {
    asked.push(request);
    if (request.method === "GET") {
      const found = accounts.find((a) => a.id === request.url);
      return found ? { status: 200, body: Buffer.from(JSON.stringify(found.doc)) } : { status: 404, body: new Uint8Array() };
    }
    const status = answers[request.url] ?? 202;
    if (status === "error") throw new Error("connection refused");
    return { status, body: new Uint8Array() };
  };
  const posts = () => asked.filter((r) => r.method === "POST").map((request) => ({ url: request.url, activity: JSON.parse(Buffer.from(request.body!).toString("utf8")) as Json, request }));
  return { outbound, asked, answers, posts };
}

export const get = (path: string, over: Partial<FediRequest> = {}): FediRequest => {
  const [p, q] = path.split("?");
  return { method: "GET", path: p!, query: q === undefined ? "" : `?${q}`, headers: { accept: "application/activity+json" }, body: new Uint8Array(), ip: "9.9.9.9", ...over };
};

/** An activity as `from`'s server would POST it to the account's inbox: signed with `from`'s key. */
export function signedPost(from: Pick<Account, "keyId" | "privateKey">, activity: unknown, now = T0, over: Partial<FediRequest> = {}): FediRequest {
  const body = new Uint8Array(Buffer.from(JSON.stringify(activity)));
  const headers = signedHeaders({ method: "POST", url: new URL(INBOX), body, keyId: from.keyId, privateKeyPem: from.privateKey, now: new Date(now) });
  return { method: "POST", path: "/fedi/inbox", query: "", headers, body, ip: "9.9.9.9", ...over };
}

export const followOf = (a: Account, id = `${a.id}#follows/1`): Json => ({ "@context": "https://www.w3.org/ns/activitystreams", id, type: "Follow", actor: a.id, object: ACTOR });
