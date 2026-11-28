// What the account says about itself and its posts, as ActivityPub objects. Pure: a profile and the
// gallery's feed in, JSON out. Nothing here knows about requests, keys on disk or who follows.
import { createHash } from "node:crypto";
import type { Feed, FeedApp } from "./feed.ts";

export const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
export const CONTEXT = ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"] as const;
export const ACTIVITY_JSON = "application/activity+json";

export type Json = Record<string, unknown>;

/** Who the account is. Its addresses are built on `origin` and can never change once it is followed. */
export interface Profile {
  /** `https://potyro.com`: the account is `@<username>@<this host>`. */
  origin: string;
  username: string;
  name: string;
  summary: string;
  /** The page a person lands on from the account: the gallery. */
  profileUrl: string;
  /** What the feed's picture paths are under, with its last slash: `https://potyro.com/`. */
  assets: string;
  /** A PNG or JPEG for the account's picture. */
  icon?: string;
  /** When the account was made (ISO). */
  since?: string;
}

export interface Addresses {
  domain: string;
  acct: string;
  actor: string;
  keyId: string;
  inbox: string;
  outbox: string;
  followers: string;
  note(id: string): string;
}

export function addressesOf(profile: Profile): Addresses {
  const base = `${profile.origin}/fedi`;
  const domain = new URL(profile.origin).host;
  return {
    domain,
    acct: `acct:${profile.username}@${domain}`,
    actor: `${base}/actor`,
    keyId: `${base}/actor#main-key`,
    inbox: `${base}/inbox`,
    outbox: `${base}/outbox`,
    followers: `${base}/followers`,
    note: (id) => `${base}/notes/${id}`,
  };
}

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const iconType = (url: string): string => (/\.jpe?g$/i.test(new URL(url).pathname) ? "image/jpeg" : "image/png");

/** The answer to "who is @apps@potyro.com": where its ActivityPub self is. */
export function webfinger(profile: Profile): Json {
  const at = addressesOf(profile);
  return {
    subject: at.acct,
    aliases: [at.actor, profile.profileUrl],
    links: [
      { rel: "self", type: ACTIVITY_JSON, href: at.actor },
      { rel: "http://webfinger.net/rel/profile-page", type: "text/html", href: profile.profileUrl },
    ],
  };
}

/** The account. A `Service`: other servers show it as automated, which it is. */
export function actorOf(profile: Profile, publicKeyPem: string): Json {
  const at = addressesOf(profile);
  return {
    "@context": CONTEXT,
    id: at.actor,
    type: "Service",
    preferredUsername: profile.username,
    name: profile.name,
    summary: `<p>${escapeHtml(profile.summary)}</p>`,
    url: profile.profileUrl,
    inbox: at.inbox,
    outbox: at.outbox,
    followers: at.followers,
    endpoints: { sharedInbox: at.inbox },
    manuallyApprovesFollowers: false,
    discoverable: true,
    ...(profile.since ? { published: profile.since } : {}),
    ...(profile.icon ? { icon: { type: "Image", mediaType: iconType(profile.icon), url: profile.icon } } : {}),
    publicKey: { id: at.keyId, owner: at.actor, publicKeyPem },
  };
}

/** One app's post in one language: its name, its line, and the two ways in. */
function contentOf(feed: Feed, app: FeedApp, lang: string): string {
  const e = escapeHtml;
  const say = (words: Record<string, string>): string => e(words[lang] ?? words[feed.languages[0]!] ?? "");
  return (
    `<p><strong>${say(app.name)}</strong><br>${say(app.line)}</p>` +
    `<p><a href="${e(app.link)}">${say(feed.words.tryIt)}</a> · <a href="${e(app.remix)}">${say(feed.words.makeItMine)}</a></p>`
  );
}

export interface NoteDates {
  published: string;
  updated?: string;
}

/** An app as a post: public, to the followers, in every language of the feed (the first one leads). */
export function noteOf(profile: Profile, feed: Feed, app: FeedApp, dates: NoteDates): Json {
  const at = addressesOf(profile);
  const first = feed.languages[0]!;
  const alt = (feed.words.shotAlt[first] ?? "").replace("{name}", app.name[first] ?? app.id);
  return {
    id: at.note(app.id),
    type: "Note",
    attributedTo: at.actor,
    to: [PUBLIC],
    cc: [at.followers],
    published: dates.published,
    ...(dates.updated ? { updated: dates.updated } : {}),
    url: at.note(app.id),
    content: contentOf(feed, app, first),
    contentMap: Object.fromEntries(feed.languages.map((lang) => [lang, contentOf(feed, app, lang)])),
    attachment: app.image
      ? [{ type: "Document", mediaType: app.image.mediaType, url: profile.assets + app.image.path, name: alt, width: app.image.width, height: app.image.height }]
      : [],
  };
}

/** What a post says, without its dates: when this changes, the post is sent again as an update. */
export function noteHash(profile: Profile, feed: Feed, app: FeedApp): string {
  const { published: _published, ...said } = noteOf(profile, feed, app, { published: "" });
  return createHash("sha256").update(JSON.stringify(said)).digest("hex");
}

const wrap = (profile: Profile, id: string, type: string, object: unknown, published?: string): Json => {
  const at = addressesOf(profile);
  return { id, type, actor: at.actor, to: [PUBLIC], cc: [at.followers], ...(published ? { published } : {}), object };
};

export const createOf = (profile: Profile, note: Json): Json => wrap(profile, `${String(note.id)}/activity`, "Create", note, String(note.published));

export const updateOf = (profile: Profile, note: Json): Json => wrap(profile, `${String(note.id)}#update-${Date.parse(String(note.updated))}`, "Update", note, String(note.updated));

export const tombstoneOf = (profile: Profile, appId: string): Json => ({ id: addressesOf(profile).note(appId), type: "Tombstone" });

export const deleteOf = (profile: Profile, appId: string): Json => wrap(profile, `${addressesOf(profile).note(appId)}#delete`, "Delete", tombstoneOf(profile, appId));

/** "Yes, you follow us now": the answer to a Follow, naming the Follow it answers. */
export function acceptOf(profile: Profile, follow: Json, token: string): Json {
  const at = addressesOf(profile);
  const follower = String(follow.actor);
  return { id: `${at.actor}#accept-${token}`, type: "Accept", actor: at.actor, to: [follower], object: { id: follow.id, type: "Follow", actor: follower, object: at.actor } };
}

/** A collection in one page: what the outbox and the followers count are. */
export const collectionOf = (id: string, items: readonly unknown[] | number): Json => ({
  "@context": CONTEXT,
  id,
  type: "OrderedCollection",
  totalItems: typeof items === "number" ? items : items.length,
  ...(typeof items === "number" ? {} : { orderedItems: items }),
});

/** An object as it goes out on its own: with the context that says how to read it. */
export const withContext = (object: Json): Json => ({ "@context": CONTEXT, ...object });
