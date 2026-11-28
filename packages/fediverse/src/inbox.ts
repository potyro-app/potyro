// The inbox: what other servers send the account. It acts on three things and nothing else:
//
//   Follow          → the sender is kept as a follower and told "accepted"
//   Undo of Follow  → the sender is forgotten
//   Delete of self  → an account that was deleted on its server is forgotten
//
// Replies, likes, boosts and every other activity are answered 202 and dropped unread: the account
// keeps nothing anyone says to it (docs/33), so there is nothing here to moderate.
//
// Nothing is believed unsigned. A Follow is checked against the key its account publishes (one
// lookup on its server, counted against a limit for all senders together); the other two against
// the key kept when the account followed, so a stranger's Delete costs no lookup at all.
import type { Core, FediRequest, FediResponse } from "./core.ts";
import { USER_AGENT } from "./core.ts";
import { enqueue } from "./delivery.ts";
import { safeUrl } from "./net.ts";
import { ACTIVITY_JSON, acceptOf, type Json } from "./objects.ts";
import { parseSignature, signedHeaders, verifyRequest, type ParsedSignature } from "./signature.ts";
import type { Follower } from "./store.ts";

const LOOKUP_TIMEOUT_MS = 8_000;
const LOOKUP_MAX_BYTES = 256_000;
/** A 4096-bit RSA key is about 800 characters as PEM. */
const MAX_PEM = 2_000;
const MAX_ID = 2_000;

const answer = (status: number, error?: string): FediResponse => ({
  status,
  headers: { "content-type": "application/json" },
  body: error ? JSON.stringify({ error }) : "{}",
});

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** An object's address: itself when it is given as one, or its `id`. */
const idOf = (v: unknown): string | null => (typeof v === "string" ? v : isObject(v) && typeof v.id === "string" ? v.id : null);

type Kind = "follow" | "unfollow" | "gone";

/** Which of the three things an activity is, or null for everything else. */
function kindOf(core: Core, activity: Json, actor: string): Kind | null {
  const object = activity.object;
  if (activity.type === "Follow") return idOf(object) === core.at.actor ? "follow" : null;
  if (activity.type === "Undo" && isObject(object) && object.type === "Follow") {
    return idOf(object.object) === core.at.actor && idOf(object.actor) === actor ? "unfollow" : null;
  }
  if (activity.type === "Delete") return idOf(object) === actor ? "gone" : null;
  return null;
}

type Remote = Omit<Follower, "since">;

/** An account's document, read into what is kept of a follower; null when it is not a usable one. */
export function remoteOf(doc: unknown, actor: string): Remote | null {
  if (!isObject(doc) || doc.id !== actor) return null;
  const host = new URL(actor).host;
  const sameHost = (v: unknown): string | null => {
    const url = safeUrl(v);
    return url && url.host === host ? url.href : null;
  };
  const key = doc.publicKey;
  if (!isObject(key) || typeof key.id !== "string" || key.owner !== actor) return null;
  // The key and nothing around it: a PEM reader skips what comes before, so it would be kept for nothing.
  if (typeof key.publicKeyPem !== "string" || key.publicKeyPem.length > MAX_PEM || !key.publicKeyPem.startsWith("-----BEGIN ")) return null;
  const inbox = sameHost(doc.inbox);
  if (!inbox || !sameHost(key.id)) return null;
  const shared = isObject(doc.endpoints) ? sameHost(doc.endpoints.sharedInbox) : null;
  return { id: actor, inbox, ...(shared ? { sharedInbox: shared } : {}), keyId: key.id, publicKeyPem: key.publicKeyPem };
}

/** Asks an account's server who it is. The request is signed: some servers answer nobody else. */
async function lookUp(core: Core, actor: string): Promise<Remote | null> {
  const url = safeUrl(actor);
  if (!url) return null;
  const signed = signedHeaders({ method: "GET", url, keyId: core.at.keyId, privateKeyPem: core.privateKeyPem, now: new Date(core.now()) });
  try {
    const res = await core.outbound({
      method: "GET",
      url: url.href,
      headers: { ...signed, accept: ACTIVITY_JSON, "user-agent": USER_AGENT },
      maxBytes: LOOKUP_MAX_BYTES,
      timeoutMs: LOOKUP_TIMEOUT_MS,
    });
    if (res.status !== 200) return null;
    return remoteOf(JSON.parse(Buffer.from(res.body).toString("utf8")), actor);
  } catch {
    return null;
  }
}

export type Receiver = (req: FediRequest) => Promise<FediResponse>;

export function receiver(core: Core, overLookups: (ip: string) => boolean): Receiver {
  /** Accounts whose Follow is being checked right now. */
  const following = new Set<string>();

  const signedBy = (req: FediRequest, signature: ParsedSignature, publicKeyPem: string): boolean =>
    verifyRequest({ method: req.method, target: req.path + req.query, headers: req.headers, body: req.body, signature, publicKeyPem, host: core.at.domain, now: core.now() }).ok;

  /** The sender, when the request really is theirs; "busy" when the lookup limit is spent. */
  const sender = async (req: FediRequest, actor: string, signature: ParsedSignature, kind: Kind): Promise<Remote | "busy" | null> => {
    const known = core.book.followers[actor];
    if (known && known.keyId === signature.keyId && signedBy(req, signature, known.publicKeyPem)) return known;
    // An account that says it is gone cannot be asked; anyone else may have a new key.
    if (kind === "gone") return null;
    // A key on another server than its account can never be the account's: no lookup is spent on it.
    // Nor on an account that says it is on this server: there is one here, and it follows nobody.
    const host = new URL(actor).host;
    if (safeUrl(signature.keyId)?.host !== host || host === core.at.domain) return null;
    if (overLookups(req.ip)) return "busy";
    const remote = await lookUp(core, actor);
    return remote && remote.keyId === signature.keyId && signedBy(req, signature, remote.publicKeyPem) ? remote : null;
  };

  /** Whether the account, or the server this follower is on, already has all the followers it may. */
  const noRoomFor = (actor: string): boolean => {
    const all = Object.keys(core.book.followers);
    if (all.length >= core.limits.maxFollowers) return true;
    const host = new URL(actor).host;
    return all.filter((id) => new URL(id).host === host).length >= core.limits.maxFollowersPerHost;
  };

  const follow = async (followId: string, remote: Remote): Promise<FediResponse> => {
    const { followers, outgoing } = core.book;
    const known = followers[remote.id];
    if (!known && noRoomFor(remote.id)) return answer(503, "no room for another follower right now");
    if (!known || known.inbox !== remote.inbox || known.sharedInbox !== remote.sharedInbox || known.keyId !== remote.keyId || known.publicKeyPem !== remote.publicKeyPem) {
      const follower: Follower = { ...remote, since: known?.since ?? new Date(core.now()).toISOString() };
      core.book.followers = { ...followers, [remote.id]: follower };
      await core.store.write("followers", core.book.followers);
    }
    // One answer on its way to an inbox at a time: following again and again queues nothing more.
    if (outgoing.deliveries.some((d) => d.inbox === remote.inbox && outgoing.activities[d.activity]?.type === "Accept")) return answer(202);
    if (outgoing.deliveries.length >= core.limits.maxWaiting) return answer(503, "busy, try again later");
    await enqueue(core, acceptOf(core.profile, { id: followId, actor: remote.id }, core.token()), [remote.inbox]);
    return answer(202);
  };

  const forget = async (actor: string): Promise<FediResponse> => {
    const { [actor]: _gone, ...rest } = core.book.followers;
    core.book.followers = rest;
    await core.store.write("followers", rest);
    return answer(202);
  };

  return async (req) => {
    if (req.body.length > core.limits.inboxBytes) return answer(413, "too big");
    let activity: unknown;
    try {
      activity = JSON.parse(Buffer.from(req.body).toString("utf8"));
    } catch {
      return answer(400, "not JSON");
    }
    if (!isObject(activity) || typeof activity.type !== "string") return answer(400, "not an activity");
    const actor = idOf(activity.actor);
    const kind = actor && safeUrl(actor) ? kindOf(core, activity, actor) : null;
    if (!actor || !kind) return answer(202);
    // A Follow is answered by naming it, so it must have a name, and a short one.
    if (kind === "follow" && (typeof activity.id !== "string" || activity.id.length > MAX_ID)) return answer(400, "a Follow needs an id");
    // Unfollowing, or being gone, means something only for an account that follows.
    // (One whose Follow is still being checked is told to come back: answered now, its "I stop
    // following" would be lost and the Follow kept.)
    if (kind !== "follow" && !core.book.followers[actor]) return following.has(actor) ? answer(503, "busy, try again later") : answer(202);
    const signature = parseSignature(req.headers.signature);
    if (!signature) return answer(401, "not signed");
    if (kind === "follow") following.add(actor);
    const remote = await sender(req, actor, signature, kind).finally(() => following.delete(actor));
    if (remote === "busy") return answer(503, "busy, try again later");
    if (!remote) return answer(401, "the signature is not this account's");
    return kind === "follow" ? follow(String(activity.id), remote) : forget(actor);
  };
}
