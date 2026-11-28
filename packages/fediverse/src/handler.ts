// The account's addresses, as requests and answers (no sockets here: server.ts has them).
//
//   GET  /.well-known/webfinger?resource=acct:apps@potyro.com   who the account is
//   GET  /fedi/actor                                            the account
//   GET  /fedi/outbox                                           what it has posted
//   GET  /fedi/followers                                        how many follow (never who)
//   GET  /fedi/notes/<app>            and  …/activity           one post, and the Create that carried it
//   POST /fedi/inbox                                            what other servers send (inbox.ts)
//   GET  /fedi/health
//
// A person's browser asking for the account or a post is sent to the gallery's page: the account
// has no pages of its own.
import { addressKey } from "./address.ts";
import type { Core, FediRequest, FediResponse } from "./core.ts";
import { minuteCounter } from "./core.ts";
import { receiver } from "./inbox.ts";
import { ACTIVITY_JSON, actorOf, collectionOf, createOf, noteOf, tombstoneOf, webfinger, withContext, type Json } from "./objects.ts";

const NOTE_RE = /^\/fedi\/notes\/([a-z0-9][a-z0-9-]{0,63})(\/activity)?$/;
/** How long another server may keep an answer: short, so a change shows soon. */
const CACHE = "public, max-age=300";

const json = (status: number, body: unknown, type = ACTIVITY_JSON, cache = CACHE): FediResponse => ({
  status,
  headers: { "content-type": type, "cache-control": cache, vary: "accept" },
  body: JSON.stringify(body),
});

const plain = (status: number, error: string): FediResponse => json(status, { error }, "application/json", "no-store");

const to = (location: string): FediResponse => ({ status: 302, headers: { location, vary: "accept", "cache-control": "no-store" }, body: "" });

/** Whether the asker is a person's browser rather than another server. */
function wantsHtml(accept: string | undefined): boolean {
  const a = (accept ?? "").toLowerCase();
  return a.includes("text/html") && !a.includes("activity+json") && !a.includes("ld+json");
}

/** The `resource` of a webfinger query, decoded; null when there is none. */
function resourceOf(query: string): string | null {
  try {
    return new URLSearchParams(query).get("resource");
  } catch {
    return null;
  }
}

export function createHandler(core: Core): (req: FediRequest) => Promise<FediResponse> {
  const { profile, at } = core;
  const overRequests = minuteCounter(core.now);
  const lookups = minuteCounter(core.now);
  // The sender's own allowance first: one that has spent it takes nothing from everyone's.
  const receive = receiver(core, (ip) => lookups(addressKey(ip), core.limits.lookupsPerAddressMinute) || lookups("all", core.limits.lookupsPerMinute));

  const finger = (req: FediRequest): FediResponse => {
    const resource = resourceOf(req.query);
    if (!resource) return plain(400, "say which account: ?resource=acct:name@host");
    const known = [at.acct, at.actor, profile.profileUrl].some((r) => r.toLowerCase() === resource.toLowerCase());
    return known ? json(200, webfinger(profile), "application/jrd+json") : plain(404, "no such account");
  };

  const noteFor = (id: string): Json | null => {
    const app = core.book.feed?.apps.find((a) => a.id === id);
    const dates = Object.hasOwn(core.book.notes.posted, id) ? core.book.notes.posted[id] : undefined;
    return app && dates && core.book.feed ? noteOf(profile, core.book.feed, app, dates) : null;
  };

  const note = (req: FediRequest, id: string, asActivity: boolean): FediResponse => {
    if (wantsHtml(req.headers.accept)) return to(profile.profileUrl);
    const found = noteFor(id);
    if (found) return json(200, withContext(asActivity ? createOf(profile, found) : found));
    if (Object.hasOwn(core.book.notes.gone, id)) return json(410, withContext(tombstoneOf(profile, id)));
    return plain(404, "no such post");
  };

  const outbox = (): FediResponse => {
    const notes = Object.keys(core.book.notes.posted)
      .map(noteFor)
      .filter((n): n is Json => n !== null)
      .sort((a, b) => Date.parse(String(b.published)) - Date.parse(String(a.published)));
    return json(200, collectionOf(at.outbox, notes.map((n) => createOf(profile, n))));
  };

  const get = (req: FediRequest): FediResponse => {
    if (req.path === "/.well-known/webfinger") return finger(req);
    if (req.path === "/fedi/health") return json(200, { ok: true, posts: Object.keys(core.book.notes.posted).length }, "application/json", "no-store");
    if (req.path === "/fedi/actor") return wantsHtml(req.headers.accept) ? to(profile.profileUrl) : json(200, actorOf(profile, core.publicKeyPem));
    if (req.path === "/fedi/outbox") return outbox();
    if (req.path === "/fedi/followers") return json(200, collectionOf(at.followers, Object.keys(core.book.followers).length));
    const m = NOTE_RE.exec(req.path);
    if (m) return note(req, m[1]!, Boolean(m[2]));
    return plain(404, "not found");
  };

  return async (req) => {
    if (overRequests(addressKey(req.ip), core.limits.requestsPerMinute)) {
      return { ...plain(429, "too many requests"), headers: { "content-type": "application/json", "retry-after": "60" } };
    }
    try {
      if (req.method === "GET" || req.method === "HEAD") return get(req);
      if (req.method === "POST" && req.path === "/fedi/inbox") return await receive(req);
      return plain(req.path === "/fedi/inbox" ? 405 : 404, "not found");
    } catch (e) {
      core.onError(e);
      return plain(500, "something went wrong here");
    }
  };
}
