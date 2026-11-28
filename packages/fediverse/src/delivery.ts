// Posting: the gallery's feed is compared with what the account has posted, each difference becomes
// an activity (a new app: Create; its words changed: Update; it left: Delete), and each activity is
// delivered, signed, to every server a follower is on. One POST per server where it has a shared
// inbox, not one per follower.
//
// A delivery that fails is tried again, further apart each time, for about three days. What goes to
// one inbox goes in the order it was posted: a later activity waits for the one before it, so a
// server never sees an Update before its Create. A server that answers 410 Gone, or whose
// deliveries have been failing for a week, loses its followers here: an account that no longer
// exists is not written to for ever.
import type { Core } from "./core.ts";
import { USER_AGENT } from "./core.ts";
import type { Feed } from "./feed.ts";
import { safeUrl } from "./net.ts";
import { ACTIVITY_JSON, createOf, deleteOf, noteHash, noteOf, updateOf, withContext, type Json } from "./objects.ts";
import { signedHeaders } from "./signature.ts";
import type { Delivery, Follower, Notes, Outgoing, PostedNote } from "./store.ts";

/** Minutes before each new try of a delivery; after the last, it is given up on. */
export const BACKOFF_MINUTES = [1, 5, 30, 120, 360, 720, 1440, 1440] as const;
/** An inbox nothing has reached for this long loses its followers. */
export const GIVE_UP_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH = 200;
const AT_ONCE = 8;
const PER_HOST = 2;
const DELIVERY_TIMEOUT_MS = 10_000;
const DELIVERY_MAX_ANSWER = 1_000_000;

const inboxOf = (f: Follower): string => f.sharedInbox ?? f.inbox;

/** Where an activity for everyone goes: each follower's server once. */
export const inboxesOf = (followers: Record<string, Follower>): string[] => [...new Set(Object.values(followers).map(inboxOf))];

const keyOf = (d: Pick<Delivery, "activity" | "inbox">): string => `${d.activity}\n${d.inbox}`;

/** `out` with these activities on the way to these inboxes; one already on its way is not added twice. */
function withDeliveries(out: Outgoing, activities: readonly Json[], inboxes: readonly string[], nextAt: number): Outgoing {
  const waiting = new Set(out.deliveries.map(keyOf));
  const added: Delivery[] = [];
  for (const activity of activities) {
    for (const inbox of inboxes) {
      const delivery = { activity: String(activity.id), inbox, attempts: 0, nextAt };
      if (!waiting.has(keyOf(delivery))) added.push(delivery);
    }
  }
  if (!added.length) return out;
  const carried = Object.fromEntries(activities.map((a) => [String(a.id), a]));
  return { ...out, activities: { ...out.activities, ...carried }, deliveries: [...out.deliveries, ...added] };
}

/** Puts an activity on the way to these inboxes; the next round sends it. */
export async function enqueue(core: Core, activity: Json, inboxes: readonly string[]): Promise<void> {
  const outgoing = withDeliveries(core.book.outgoing, [activity], inboxes, core.now());
  if (outgoing === core.book.outgoing) return;
  core.book.outgoing = outgoing;
  await core.store.write("outgoing", outgoing);
}

export interface SyncResult {
  created: string[];
  updated: string[];
  deleted: string[];
}

/** The feed against what is posted: the notes as they should now be, and the activities that say so. */
function compare(core: Core, feed: Feed): { notes: Notes; activities: Json[]; result: SyncResult } {
  const { profile, book } = core;
  const nowIso = new Date(core.now()).toISOString();
  const posted: Record<string, PostedNote> = {};
  const activities: Json[] = [];
  const result: SyncResult = { created: [], updated: [], deleted: [] };
  for (const app of feed.apps) {
    const hash = noteHash(profile, feed, app);
    const was = Object.hasOwn(book.notes.posted, app.id) ? book.notes.posted[app.id] : undefined;
    if (was?.hash === hash) {
      posted[app.id] = was;
      continue;
    }
    // The first time the account posts, the gallery's own dates; after that, a post is dated when
    // it is made, so it arrives in a follower's timeline as new.
    const first = book.fresh && app.publishedAt ? new Date(app.publishedAt).toISOString() : nowIso;
    const now: PostedNote = was ? { ...was, hash, updated: nowIso } : { hash, published: first };
    posted[app.id] = now;
    const note = noteOf(profile, feed, app, now);
    activities.push(was ? updateOf(profile, note) : createOf(profile, note));
    (was ? result.updated : result.created).push(app.id);
  }
  const gone = Object.fromEntries(Object.entries(book.notes.gone).filter(([id]) => !Object.hasOwn(posted, id)));
  for (const id of Object.keys(book.notes.posted)) {
    if (Object.hasOwn(posted, id)) continue;
    gone[id] = nowIso;
    activities.push(deleteOf(profile, id));
    result.deleted.push(id);
  }
  return { notes: { posted, gone }, activities, result };
}

/**
 * Takes a new feed: posts what changed to everyone who follows, and remembers it. One at a time
 * (fediverse.ts runs them in a row).
 *
 * The order is what a crash or a full disk may interrupt: the deliveries are written first, then
 * what is posted. Stopped in between, the next start finds the same differences and queues the
 * same activities again, which changes nothing; the other way round, an app would be marked as
 * posted and never sent.
 */
export async function syncFeed(core: Core, feed: Feed): Promise<SyncResult> {
  const { book } = core;
  const { notes, activities, result } = compare(core, feed);
  const had = Object.keys(book.notes.posted).length;
  if (result.deleted.length > Math.max(1, Math.floor(had / 2))) {
    throw new Error(`it drops ${result.deleted.length} of the ${had} apps posted: a broken build looks like this, so it is refused. Take apps out a few at a time.`);
  }
  // The first time, the posts go to nobody: whoever followed before there was anything is not sent
  // the whole gallery at once.
  const inboxes = book.fresh ? [] : inboxesOf(book.followers);
  const outgoing = withDeliveries(book.outgoing, activities, inboxes, core.now());
  if (outgoing !== book.outgoing) {
    book.outgoing = outgoing;
    await core.store.write("outgoing", outgoing);
  }
  if (activities.length || book.fresh) await core.store.write("notes", notes);
  if (JSON.stringify(feed) !== JSON.stringify(book.feed)) await core.store.write("feed", feed);
  book.notes = notes;
  book.feed = feed;
  book.fresh = false;
  return result;
}

type Outcome = "sent" | "gone" | "failed";

async function send(core: Core, delivery: Delivery, activity: Json): Promise<Outcome> {
  const url = safeUrl(delivery.inbox);
  if (!url) return "gone";
  const body = new Uint8Array(Buffer.from(JSON.stringify(withContext(activity))));
  const signed = signedHeaders({ method: "POST", url, body, keyId: core.at.keyId, privateKeyPem: core.privateKeyPem, now: new Date(core.now()) });
  try {
    const res = await core.outbound({
      method: "POST",
      url: url.href,
      headers: { ...signed, accept: ACTIVITY_JSON, "user-agent": USER_AGENT },
      body,
      maxBytes: DELIVERY_MAX_ANSWER,
      timeoutMs: DELIVERY_TIMEOUT_MS,
    });
    if (res.status >= 200 && res.status < 300) return "sent";
    return res.status === 410 ? "gone" : "failed";
  } catch {
    return "failed";
  }
}

/** What is left to deliver after a round, and the inboxes whose followers are dropped. */
function settle(out: Outgoing, outcomes: Map<string, Outcome>, now: number): { outgoing: Outgoing; dropped: Set<string> } {
  const dropped = new Set<string>();
  const failing = { ...out.failing };
  const kept: Delivery[] = [];
  for (const d of out.deliveries) {
    const outcome = outcomes.get(keyOf(d));
    if (!outcome) kept.push(d);
    else if (outcome === "sent") delete failing[d.inbox];
    else if (outcome === "gone") dropped.add(d.inbox);
    // Failed. The inbox has been failing since its first failure with no success after it.
    else if (now - (failing[d.inbox] ??= now) >= GIVE_UP_MS) dropped.add(d.inbox);
    else if (d.attempts < BACKOFF_MINUTES.length) kept.push({ ...d, attempts: d.attempts + 1, nextAt: now + BACKOFF_MINUTES[d.attempts]! * 60_000 });
  }
  for (const inbox of dropped) delete failing[inbox];
  const deliveries = kept.filter((d) => !dropped.has(d.inbox));
  const wanted = new Set(deliveries.map((d) => d.activity));
  const activities = Object.fromEntries(Object.entries(out.activities).filter(([id]) => wanted.has(id)));
  return { outgoing: { activities, deliveries, failing }, dropped };
}

const hostOf = (inbox: string): string => safeUrl(inbox)?.host ?? "";

/**
 * What may be sent now: for each inbox its oldest delivery, when its time has come, and no more
 * than a few to one server in a round, so a slow server holds up nobody but itself.
 */
function dueNow(deliveries: readonly Delivery[], now: number): Delivery[] {
  const inboxes = new Set<string>();
  const perHost = new Map<string, number>();
  const due: Delivery[] = [];
  for (const d of deliveries) {
    if (due.length >= BATCH) break;
    if (inboxes.has(d.inbox)) continue;
    inboxes.add(d.inbox);
    const host = hostOf(d.inbox);
    const taken = perHost.get(host) ?? 0;
    if (d.nextAt > now || taken >= PER_HOST) continue;
    perHost.set(host, taken + 1);
    due.push(d);
  }
  return due;
}

/** Runs `work` over `items`, a few at a time. */
async function pool<T>(items: readonly T[], atOnce: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(atOnce, items.length) }, lane));
}

export interface DeliveryRound {
  sent: number;
  failed: number;
  /** Followers removed because their server is gone. */
  unfollowed: number;
}

/** Sends every delivery whose time has come. One round at a time: a second call while one runs does nothing. */
export function deliverer(core: Core): () => Promise<DeliveryRound> {
  let running = false;
  return async () => {
    const round: DeliveryRound = { sent: 0, failed: 0, unfollowed: 0 };
    if (running) return round;
    running = true;
    try {
      const due = dueNow(core.book.outgoing.deliveries, core.now());
      if (!due.length) return round;
      const activities = core.book.outgoing.activities;
      const outcomes = new Map<string, Outcome>();
      await pool(due, AT_ONCE, async (d) => {
        const activity = activities[d.activity];
        outcomes.set(keyOf(d), activity ? await send(core, d, activity) : "sent");
      });
      for (const outcome of outcomes.values()) outcome === "sent" ? (round.sent += 1) : (round.failed += 1);
      // Settled against the book as it is NOW: a follow that came in meanwhile has its Accept in it.
      const { outgoing, dropped } = settle(core.book.outgoing, outcomes, core.now());
      core.book.outgoing = outgoing;
      await core.store.write("outgoing", outgoing);
      round.unfollowed = await unfollowInboxes(core, dropped);
      return round;
    } finally {
      running = false;
    }
  };
}

async function unfollowInboxes(core: Core, inboxes: Set<string>): Promise<number> {
  if (!inboxes.size) return 0;
  const before = Object.values(core.book.followers);
  const kept = before.filter((f) => !inboxes.has(inboxOf(f)) && !inboxes.has(f.inbox));
  if (kept.length === before.length) return 0;
  core.book.followers = Object.fromEntries(kept.map((f) => [f.id, f]));
  await core.store.write("followers", core.book.followers);
  return before.length - kept.length;
}
