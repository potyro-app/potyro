// What Bluesky's firehose says, and how a few words are found in it without drowning.
//
// Jetstream (https://github.com/bluesky-social/jetstream) streams every public event on Bluesky as
// JSON, one per message: `{ did, time_us, kind: "commit" | "identity" | "account", commit? }`. With
// `wantedCollections=app.bsky.feed.post` it is only posts — still tens to hundreds a second. So:
//
//   1. a cheap test on the raw text first (does it contain any watched word at all?) — nearly every
//      message stops here, without being parsed;
//   2. only those are parsed, and only a new post (`commit`, `create`) with text counts;
//   3. the word must stand on its own (not "rain" inside "brain"), in any case, in any script;
//   4. posts their authors marked adult are left out.
//
// Nothing else is kept: no images, no links, no other fields — the text, who, when, and where the
// post lives on bsky.app.

/**
 * One of Bluesky's four public Jetstream servers. One, not all four in turn: a shared copy is asked
 * once per host it connects to, and a second question in the middle of a dropped connection reads
 * as something gone wrong. When it is down the app says so and keeps trying it.
 */
export const JETSTREAM_HOST = "jetstream2.us-east.bsky.network";
export const JETSTREAM_URL = `wss://${JETSTREAM_HOST}/subscribe?wantedCollections=app.bsky.feed.post`;
/** Bluesky's public AppView: a handle for a DID, no key, no login. */
export const PROFILE_HOST = "public.api.bsky.app";
export const profilesUrl = (dids: string[]): string => `https://${PROFILE_HOST}/xrpc/app.bsky.actor.getProfiles?${dids.map((d) => `actors=${encodeURIComponent(d)}`).join("&")}`;

/** The post's page on bsky.app; a DID works where a handle would. */
export const postUrl = (did: string, rkey: string): string => `https://bsky.app/profile/${did}/post/${rkey}`;

/** At most this much of a post is kept (Bluesky's own limit is 300 characters). */
export const MAX_TEXT = 300;

export interface Post {
  did: string;
  rkey: string;
  text: string;
  createdAt: Date;
  langs: string[];
}

/** Self-labels that mean "not for everyone". */
const ADULT = new Set(["porn", "sexual", "nudity", "graphic-media", "gore"]);

/** One Jetstream message → a new post, or null for anything else (deletes, edits, identity, account, adult). */
export function readPost(raw: string): Post | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  const msg = m as { did?: unknown; kind?: unknown; commit?: { operation?: unknown; collection?: unknown; rkey?: unknown; record?: Record<string, unknown> } };
  if (msg?.kind !== "commit" || typeof msg.did !== "string") return null;
  const c = msg.commit;
  if (!c || c.operation !== "create" || c.collection !== "app.bsky.feed.post" || typeof c.rkey !== "string") return null;
  const r = c.record;
  if (!r || typeof r.text !== "string" || !r.text.trim()) return null;
  const labels = (r.labels as { values?: Array<{ val?: unknown }> } | undefined)?.values ?? [];
  if (labels.some((l) => ADULT.has(String(l.val)))) return null;
  const created = typeof r.createdAt === "string" ? new Date(r.createdAt) : new Date();
  return {
    did: msg.did,
    rkey: c.rkey,
    text: r.text.length > MAX_TEXT ? `${r.text.slice(0, MAX_TEXT - 1)}…` : r.text,
    createdAt: Number.isNaN(created.getTime()) ? new Date() : created,
    langs: Array.isArray(r.langs) ? r.langs.filter((l): l is string => typeof l === "string") : [],
  };
}

export interface Watched {
  id: string;
  word: string;
}

export interface Hit {
  post: Post;
  /** Ids of the watched words the post mentions. */
  ids: string[];
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A word as typed, tidied: trimmed, inner spaces single, at most 40 characters. */
export const cleanWord = (s: string): string => s.trim().replace(/\s+/g, " ").slice(0, 40);

/**
 * A matcher for some words. Returns null for the great majority of messages without parsing them.
 * A word matches on its own, not inside another word: "rain" finds "Rain!" and "#rain", not "brain".
 */
export function makeMatcher(words: readonly Watched[]): (raw: string) => Hit | null {
  const list = words
    .map((w) => ({ id: w.id, lower: cleanWord(w.word).toLocaleLowerCase(), word: cleanWord(w.word) }))
    .filter((w) => w.lower.length > 0)
    .map((w) => ({ ...w, re: new RegExp(`(^|[^\\p{L}\\p{N}_])${escape(w.word)}(?=$|[^\\p{L}\\p{N}_])`, "iu") }));
  if (!list.length) return () => null;
  return (raw) => {
    const lowered = raw.toLocaleLowerCase();
    const maybe = list.filter((w) => lowered.includes(w.lower));
    if (!maybe.length) return null;
    const post = readPost(raw);
    if (!post) return null;
    const ids = maybe.filter((w) => w.re.test(post.text)).map((w) => w.id);
    return ids.length ? { post, ids } : null;
  };
}

/** The minute a moment falls in. */
export const minuteOf = (d: Date): number => Math.floor(d.getTime() / 60_000) * 60_000;

/** A sparkline in eight steps: "▁▂▃▅▇" — readable anywhere text is, so a sealed copy shows it too. */
export function sparkline(values: readonly number[]): string {
  const bars = "▁▂▃▄▅▆▇█";
  const max = Math.max(0, ...values);
  if (max === 0) return values.map(() => bars[0]).join("");
  return values.map((v) => bars[Math.min(7, Math.round((v / max) * 7))]).join("");
}

/** The counts for each of the last `n` minutes before `now` (oldest first), from minute records. */
export function lastMinutes(rows: ReadonlyArray<{ at: Date | null; count: number }>, now: Date, n: number): number[] {
  const end = minuteOf(now);
  const out = Array.from({ length: n }, () => 0);
  for (const r of rows) {
    if (!r.at) continue;
    const i = n - 1 - Math.round((end - minuteOf(r.at)) / 60_000);
    if (i >= 0 && i < n) out[i]! += r.count;
  }
  return out;
}

/**
 * What a flush writes. Hits are gathered between writes; a flush counts every one of them per word
 * and minute, but saves only the newest few posts per word — a word in the news can match dozens a
 * second, and nobody reads dozens a second.
 */
export interface Batch {
  /** word id → minute → how many. */
  counts: Map<string, Map<number, number>>;
  /** The posts to save, newest first, with every watched word each mentions. */
  posts: Array<{ post: Post; ids: string[]; at: Date }>;
}

export function batch(hits: ReadonlyArray<{ hit: Hit; at: Date }>, perWord = 3): Batch {
  const counts = new Map<string, Map<number, number>>();
  const keep = new Map<string, number>();
  const posts: Batch["posts"] = [];
  for (const { hit, at } of [...hits].reverse()) {
    for (const id of hit.ids) {
      const byMinute = counts.get(id) ?? new Map<number, number>();
      byMinute.set(minuteOf(at), (byMinute.get(minuteOf(at)) ?? 0) + 1);
      counts.set(id, byMinute);
    }
    if (hit.ids.some((id) => (keep.get(id) ?? 0) < perWord)) {
      for (const id of hit.ids) keep.set(id, (keep.get(id) ?? 0) + 1);
      posts.push({ post: hit.post, ids: hit.ids, at });
    }
  }
  return { counts, posts };
}

/** Which records to delete so at most `max` remain, the oldest first. */
export function oldest<T extends { id: string; at: Date | null }>(rows: readonly T[], max: number): string[] {
  return [...rows]
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
    .slice(max)
    .map((r) => r.id);
}

export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
