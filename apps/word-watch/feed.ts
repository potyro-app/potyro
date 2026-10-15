// The live side of Word Watch: Bluesky's firehose in, a few words looked for, and only what matters
// written down — every match counted per word and minute, the newest few posts per word kept, at
// most every two seconds, and the store kept small.
//
// The firehose is tens to hundreds of posts a second. Each message is tested as raw text first
// (watch.ts): almost all of them stop there, unparsed, and nothing about them is kept.

import type { Ctx, Resolved } from "potyro";
import { DEMO_BACKLOG, DEMO_PEOPLE, DEMO_SCRIPT, DEMO_WORDS, demoMessage } from "./demo.js";
import { createLive } from "./live.js";
import { batch, cleanWord, JETSTREAM_URL, lastMinutes, makeMatcher, minuteOf, oldest, postUrl, profilesUrl, toDate, type Hit } from "./watch.js";
import type { FeedState } from "./words.js";

/** Write at most this often. */
export const FLUSH_MS = 2000;
/** Hits waiting for a write beyond this are only counted, not kept. */
const MAX_WAITING = 400;
/** Posts kept, all words together; minutes kept per word. */
export const KEEP_POSTS = 150;
export const KEEP_MINUTES = 60;
/** At most this many posts per word per write. */
const POSTS_PER_WORD = 3;

// ------------------------------------------------------------------ module state

let feedId: string | null = null;
let words: Array<{ id: string; word: string }> = [];
let match: (raw: string) => Hit | null = () => null;
let waiting: Array<{ hit: Hit; at: Date }> = [];
/** Matches beyond MAX_WAITING since the last write: counted only. */
let overflow = new Map<string, number>();
let lastFlush = 0;
let flushTimer: unknown = null;
let flushing: Promise<void> | null = null;
let sinceStart = 0;
let startedHere = false;
let demoRunning = false;
let demoTimer: unknown = null;
/** did → handle, for this session. */
const handles = new Map<string, string>();

const live = createLive({
  url: JETSTREAM_URL,
  onText: (text, ctx) => take(text, ctx),
  onState: (state, ctx) => void setState(ctx, state),
});

export const liveState = () => live.state;
export const isDemoRunning = (): boolean => demoRunning;
export const wasStartedHere = (): boolean => startedHere;

const later = (fn: () => void, ms: number): unknown => (typeof setTimeout === "function" ? setTimeout(fn, ms) : null);
const cancel = (t: unknown): void => {
  if (t !== null && typeof clearTimeout === "function") clearTimeout(t as ReturnType<typeof setTimeout>);
};

// ------------------------------------------------------------------ words

/** The words being watched, read again on every write so a word added a moment ago counts. */
async function loadWords(ctx: Ctx): Promise<void> {
  const rows = await ctx.query("word", { filter: (r) => r.on !== false });
  words = rows.map((r) => ({ id: String(r.id), word: cleanWord(String(r.word ?? "")) })).filter((w) => w.word);
  match = makeMatcher(words);
}

async function setState(ctx: Ctx, state: FeedState, extra: Record<string, unknown> = {}): Promise<void> {
  const data = { state, since: new Date(), count: sinceStart, ...extra };
  try {
    if (!feedId) {
      const first = (await ctx.query("feed"))[0];
      feedId = first ? String(first.id) : null;
    }
    if (feedId) await ctx.patch("feed", feedId, data);
    else feedId = String((await ctx.create("feed", data)).id);
  } catch {
    // the app was closed under it
  }
}

// ------------------------------------------------------------------ the stream

/** Every message: tested as raw text, almost always dropped right there. */
function take(raw: string, ctx: Ctx): void {
  const hit = match(raw);
  if (hit) {
    if (waiting.length < MAX_WAITING) waiting.push({ hit, at: new Date() });
    else for (const id of hit.ids) overflow.set(id, (overflow.get(id) ?? 0) + 1);
  }
  // Writes follow the stream, at most every FLUSH_MS; a timer catches the last ones when it goes quiet.
  if (Date.now() - lastFlush >= FLUSH_MS) void flush(ctx);
  else if (flushTimer === null && (waiting.length || overflow.size)) {
    flushTimer = later(() => {
      flushTimer = null;
      void flush(ctx);
    }, FLUSH_MS);
  }
}

/** Handles for the DIDs not seen yet, in one request; the DID itself when Bluesky does not answer. */
async function resolveHandles(ctx: Ctx, dids: string[]): Promise<void> {
  const unknown = [...new Set(dids)].filter((d) => !handles.has(d)).slice(0, 25);
  if (!unknown.length) return;
  try {
    const fetch = ctx.caps.network?.fetch;
    if (!fetch) return;
    const res = await fetch(profilesUrl(unknown));
    if (!res.ok) return;
    const body = (await res.json()) as { profiles?: Array<{ did?: unknown; handle?: unknown }> };
    for (const p of body.profiles ?? []) if (typeof p.did === "string" && typeof p.handle === "string" && p.handle !== "handle.invalid") handles.set(p.did, p.handle);
  } catch {
    // no handle: the post still shows, under a shortened DID
  }
}

const shortDid = (did: string): string => `${did.slice(0, 14)}…`;

/** Write what has gathered: counts per word and minute, the newest few posts, totals; then prune. */
export function flush(ctx: Ctx): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    lastFlush = Date.now();
    cancel(flushTimer);
    flushTimer = null;
    const hits = waiting;
    const extra = overflow;
    waiting = [];
    overflow = new Map();
    try {
      await write(ctx, hits, extra);
      await loadWords(ctx);
    } catch {
      // the app was closed under it
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function write(ctx: Ctx, hits: Array<{ hit: Hit; at: Date }>, extra: Map<string, number>): Promise<void> {
  if (!hits.length && !extra.size) return;
  const b = batch(hits, POSTS_PER_WORD);
  for (const [id, n] of extra) {
    const m = b.counts.get(id) ?? new Map<number, number>();
    const now = minuteOf(new Date());
    m.set(now, (m.get(now) ?? 0) + n);
    b.counts.set(id, m);
  }
  const wordOf = new Map(words.map((w) => [w.id, w.word]));
  const demoHandle = (did: string) => DEMO_PEOPLE.find((d) => d.did === did)?.handle;
  await resolveHandles(
    ctx,
    b.posts.filter((p) => !demoHandle(p.post.did)).map((p) => p.post.did),
  );
  for (const p of [...b.posts].reverse()) {
    const demo = Boolean(demoHandle(p.post.did));
    await ctx.create("post", {
      text: p.post.text,
      handle: demoHandle(p.post.did) ?? handles.get(p.post.did) ?? shortDid(p.post.did),
      did: p.post.did,
      words: p.ids.map((id) => wordOf.get(id) ?? "").filter(Boolean),
      at: p.at,
      link: demo ? undefined : postUrl(p.post.did, p.post.rkey),
      demo,
    });
  }
  // Counts per word and minute: one record per word and minute, added to.
  const minutes = await ctx.query("minute");
  let total = 0;
  for (const [id, byMinute] of b.counts) {
    for (const [at, n] of byMinute) {
      total += n;
      const row = minutes.find((m) => m.wordId === id && toDate(m.at)?.getTime() === at);
      if (row) await ctx.patch("minute", String(row.id), { count: Number(row.count ?? 0) + n });
      else await ctx.create("minute", { wordId: id, word: wordOf.get(id) ?? "", at: new Date(at), count: n });
    }
    const w = await ctx.get("word", id);
    if (w) await ctx.patch("word", id, { total: Number(w.total ?? 0) + [...byMinute.values()].reduce((a, c) => a + c, 0), lastAt: new Date() });
  }
  sinceStart += total;
  const newest = b.posts[0];
  await setState(ctx, demoRunning ? "demo" : live.state, newest ? { lastText: newest.post.text, lastWord: newest.ids.map((id) => wordOf.get(id)).filter(Boolean).join(", ") } : {});
  await prune(ctx);
}

/** At most KEEP_POSTS posts and KEEP_MINUTES minutes per word; the oldest go. */
export async function prune(ctx: Ctx): Promise<void> {
  const posts = await ctx.query("post");
  for (const id of oldest(posts.map((p) => ({ id: String(p.id), at: toDate(p.at) })), KEEP_POSTS)) await ctx.delete("post", id);
  const cutoff = minuteOf(new Date()) - KEEP_MINUTES * 60_000;
  for (const m of await ctx.query("minute")) if ((toDate(m.at)?.getTime() ?? 0) < cutoff) await ctx.delete("minute", String(m.id));
}

// ------------------------------------------------------------------ what the buttons do

/**
 * The work a button starts. A shared copy's box gives each call about a second (the realm's
 * watchdog), and a demo's half hour of counts or clearing a hundred posts can take longer — so the
 * button starts the work and returns; the work goes on, one job after another.
 */
let busy: Promise<void> = Promise.resolve();
function inBackground(ctx: Ctx, work: () => Promise<void>): void {
  busy = busy.then(work).catch((e: unknown) => ctx.log("word-watch: a job failed", e instanceof Error ? e.message : String(e)));
}
/** For tests: when the work started so far is done. */
export const idle = (): Promise<void> => busy;

const NEED_WORDS = { en: "Add a word to watch first, under Words.", "pt-BR": "Adicione primeiro uma palavra para acompanhar, em Palavras.", de: "Leg zuerst unter Wörter ein Wort zum Beobachten an.", es: "Primero añade una palabra que seguir, en Palabras.", pl: "Najpierw dodaj słowo do obserwowania w zakładce Słowa.", it: "Prima aggiungi una parola da seguire, in Parole." };

export async function watchLive(ctx: Ctx): Promise<void> {
  stopDemo();
  startedHere = true;
  await loadWords(ctx);
  if (!words.length) {
    ctx.ui.toast(ctx.t(NEED_WORDS));
    ctx.navigate("words");
    return;
  }
  if (live.state === "live" || live.state === "connecting") {
    ctx.ui.toast(ctx.t({ en: "Already live.", "pt-BR": "Já está ao vivo.", de: "Läuft schon live.", es: "Ya está en vivo.", pl: "Już na żywo.", it: "Già in diretta." }));
    return;
  }
  sinceStart = 0;
  await setState(ctx, "connecting");
  live.start(ctx);
  // Real posts only from here: the demo's invented ones go, and its sample words become yours.
  inBackground(ctx, async () => {
    for (const e of ["post", "minute"]) for (const r of await ctx.query(e, { filter: (r) => r.demo === true })) await ctx.delete(e, String(r.id));
    for (const w of await ctx.query("word", { filter: (r) => r.demo === true })) await ctx.patch("word", String(w.id), { demo: false, total: 0 });
  });
}

export async function stopWatching(ctx: Ctx): Promise<void> {
  startedHere = true;
  stopDemo();
  live.stop();
  inBackground(ctx, async () => {
    await flush(ctx);
    await setState(ctx, "off");
  });
}

function stopDemo(): void {
  cancel(demoTimer);
  demoTimer = null;
  demoRunning = false;
}

/** One demo message every this long. */
export const DEMO_STEP_MS = 350;

/** The demo: the two sample words (added when there are none), a quiet half hour behind them, then invented posts. */
export async function playDemo(ctx: Ctx): Promise<void> {
  live.stop();
  stopDemo();
  startedHere = true;
  demoRunning = true;
  sinceStart = 0;
  inBackground(ctx, () => demo(ctx));
}

async function demo(ctx: Ctx): Promise<void> {
  const have = await ctx.query("word");
  for (const w of DEMO_WORDS) {
    const row = have.find((r) => String(r.word).toLocaleLowerCase() === w);
    if (!row) await ctx.create("word", { word: w, on: true, total: 0, demo: true });
    else if (row.on === false) await ctx.patch("word", String(row.id), { on: true });
  }
  await loadWords(ctx);
  const now = minuteOf(new Date());
  for (const w of words) {
    const backlog = DEMO_BACKLOG[w.word.toLocaleLowerCase()];
    if (!backlog) continue;
    for (let i = 0; i < backlog.length; i++) {
      await ctx.create("minute", { wordId: w.id, word: w.word, at: new Date(now - (backlog.length - i) * 60_000), count: backlog[i], demo: true });
    }
  }
  await setState(ctx, "demo");
  let i = 0;
  const step = (): void => {
    if (!demoRunning) return;
    if (i >= DEMO_SCRIPT.length) {
      demoRunning = false;
      void flush(ctx).then(() => setState(ctx, "demo-done"));
      return;
    }
    take(demoMessage(i++, Date.now()), ctx);
    demoTimer = later(step, DEMO_STEP_MS);
    if (demoTimer === null) step();
  };
  step();
}

export async function clearDemo(ctx: Ctx): Promise<void> {
  stopDemo();
  inBackground(ctx, () => clearing(ctx));
}

async function clearing(ctx: Ctx): Promise<void> {
  let n = 0;
  // The sample words go with every count of theirs; a word that was yours stays, with its own.
  const demoWords = new Set((await ctx.query("word", { filter: (r) => r.demo === true })).map((r) => String(r.id)));
  const gone: Record<string, (r: Resolved) => boolean> = {
    post: (r) => r.demo === true,
    minute: (r) => r.demo === true || demoWords.has(String(r.wordId)),
    word: (r) => r.demo === true,
  };
  for (const [e, isDemo] of Object.entries(gone)) {
    for (const r of await ctx.query(e, { filter: isDemo })) {
      await ctx.delete(e, String(r.id));
      if (e === "post") n++;
    }
  }
  await loadWords(ctx);
  await setState(ctx, live.state);
  ctx.ui.toast(
    ctx.t(
      { en: "{n, plural, one {# sample post removed.} other {# sample posts removed.}}", "pt-BR": "{n, plural, one {# post de exemplo removido.} other {# posts de exemplo removidos.}}", de: "{n, plural, one {# Beispielbeitrag entfernt.} other {# Beispielbeiträge entfernt.}}", es: "{n, plural, one {# publicación de ejemplo borrada.} other {# publicaciones de ejemplo borradas.}}", pl: "{n, plural, one {Usunięto # przykładowy wpis.} few {Usunięto # przykładowe wpisy.} other {Usunięto # przykładowych wpisów.}}", it: "{n, plural, one {# post di esempio cancellato.} other {# post di esempio cancellati.}}" },
      { n },
    ),
  );
}

/** Add a word to watch — at once, also while live (the next write reads the words again). */
export async function addWord(ctx: Ctx): Promise<void> {
  const typed = await ctx.ui.prompt(ctx.t({ en: "A word or a phrase to watch", "pt-BR": "Uma palavra ou frase para acompanhar", de: "Ein Wort oder Ausdruck zum Beobachten", es: "Una palabra o frase que seguir", pl: "Słowo lub fraza do obserwowania", it: "Una parola o frase da seguire" }));
  const word = cleanWord(typed ?? "");
  if (!word) return;
  const have = await ctx.query("word", { filter: (r) => String(r.word ?? "").toLocaleLowerCase() === word.toLocaleLowerCase() });
  if (have.length) {
    if (have[0]!.on === false) await ctx.patch("word", String(have[0]!.id), { on: true });
    ctx.ui.toast(ctx.t({ en: "Already watching “{word}”.", "pt-BR": "Já acompanhando “{word}”.", de: "„{word}“ wird schon beobachtet.", es: "Ya sigues «{word}».", pl: "„{word}” jest już obserwowane.", it: "Stai già seguendo “{word}”." }, { word }));
    return;
  }
  await ctx.create("word", { word, on: true, total: 0 });
  await loadWords(ctx);
}

/** Stop watching a word: it goes, with its counts; posts already kept stay until they age out. */
export async function removeWord(r: Resolved, ctx: Ctx): Promise<void> {
  const ok = await ctx.ui.confirm(ctx.t({ en: "Stop watching “{word}”?", "pt-BR": "Parar de acompanhar “{word}”?", de: "„{word}“ nicht mehr beobachten?", es: "¿Dejar de seguir «{word}»?", pl: "Przestać obserwować „{word}”?", it: "Smettere di seguire “{word}”?" }, { word: String(r.word ?? "") }), {
    ok: ctx.t({ en: "Stop watching", "pt-BR": "Parar", de: "Nicht mehr beobachten", es: "Dejar de seguir", pl: "Przestań obserwować", it: "Smetti di seguire" }),
    destructive: true,
  });
  if (!ok) return;
  await ctx.delete("word", String(r.id));
  ctx.navigate("words");
  inBackground(ctx, async () => {
    for (const m of await ctx.query("minute", { filter: (m) => m.wordId === r.id })) await ctx.delete("minute", String(m.id));
    await loadWords(ctx);
  });
}

/** Pause a word, or watch it again. */
export async function toggleWord(r: Resolved, ctx: Ctx): Promise<void> {
  await ctx.patch("word", String(r.id), { on: r.on === false });
  await loadWords(ctx);
}

/** The counts for one word over the last `n` minutes, oldest first. */
export function wordMinutes(rows: readonly Resolved[], wordId: string, now: Date, n: number): number[] {
  return lastMinutes(
    rows.filter((r) => r.wordId === wordId).map((r) => ({ at: toDate(r.at), count: Number(r.count ?? 0) })),
    now,
    n,
  );
}

/** For tests: forget everything this module holds. */
export function resetForTests(): void {
  live.stop();
  stopDemo();
  cancel(flushTimer);
  flushTimer = null;
  feedId = null;
  words = [];
  match = () => null;
  waiting = [];
  overflow = new Map();
  lastFlush = 0;
  flushing = null;
  sinceStart = 0;
  startedHere = false;
  handles.clear();
  busy = Promise.resolve();
}
