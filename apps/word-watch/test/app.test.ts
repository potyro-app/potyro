// The app's shape and words, and the stream end to end against a scripted ctx: no words, then words;
// matches written at most every two seconds with their handles; counts per minute; a firehose that
// writes nothing when nothing matches; the store kept small; trying again when Bluesky fails; the demo.
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkReferences, checkWords, isPotyroApp, wordGaps } from "potyro";
import app from "../word-watch.app.js";
import { addWord, clearDemo, DEMO_STEP_MS, flush, FLUSH_MS, idle, KEEP_POSTS, playDemo, resetForTests, stopWatching, watchLive } from "../feed.js";
import { DEMO_SCRIPT } from "../demo.js";
import { JETSTREAM_HOST, JETSTREAM_URL } from "../watch.js";
import { fakeCtx, settle } from "./fake.js";
import { LANGUAGES } from "./say.js";

const dir = new URL("../", import.meta.url);
const source = readdirSync(dir)
  .filter((f) => f.endsWith(".ts") && f !== "vitest.config.ts")
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");
const samples = JSON.parse(readFileSync(new URL("../fixtures/jetstream-sample.json", import.meta.url), "utf8")) as string[];

/** Bluesky's getProfiles, answering a handle for every DID asked about. */
const profiles = (url: string) => ({ profiles: [...new URL(url).searchParams.getAll("actors")].map((did) => ({ did, handle: `${did.slice(8, 19)}.bsky.social` })) });

beforeEach(() => {
  resetForTests();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  resetForTests();
  vi.useRealTimers();
});

async function words(f: ReturnType<typeof fakeCtx>, ...list: string[]) {
  for (const w of list) await f.ctx.create("word", { word: w, on: true, total: 0 });
}

describe("Word Watch — the app", () => {
  it("is a valid app that reaches Bluesky only through ctx, and only Bluesky's hosts", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(checkReferences(app)).toEqual([]);
    expect(app.permissions).toEqual({ network: { hosts: [JETSTREAM_HOST, "public.api.bsky.app"] } });
    expect(source).not.toMatch(/\bfetch\(["'`]|new WebSocket|navigator\.|document\.|window\./);
  });

  it("uses only built-in views and adds nothing by hand but words", () => {
    for (const p of app.pages) for (const v of p.layout ? p.layout.items.map((i) => i.view) : [p.view]) expect(v.type, p.id).not.toBe("custom");
    expect(app.quickActions).toEqual([]);
  });

  it("carries all six languages, in its declared words and in its code", () => {
    expect(app.languages).toEqual(LANGUAGES);
    expect(checkWords(app)).toEqual([]);
    expect(wordGaps(app)).toEqual([]);
    const maps = [...source.matchAll(/\{\s*en: /g)].map((m) => {
      let depth = 0;
      let i = m.index!;
      for (; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) break;
      }
      return source.slice(m.index!, i + 1);
    });
    expect(maps.length).toBeGreaterThan(60);
    for (const map of maps) for (const l of ['"pt-BR":', " de:", " es:", " pl:", " it:"]) expect(map, map.slice(0, 80)).toContain(l);
  });
});

describe("the stream", () => {
  it("with no words, says to add one first and connects nowhere", async () => {
    const f = fakeCtx();
    const navigated: string[] = [];
    (f.ctx as unknown as { navigate: (p: string) => void }).navigate = (p) => void navigated.push(p);
    await watchLive(f.ctx);
    expect(f.opened).toEqual([]);
    expect(f.toasts).toEqual(["Add a word to watch first, under Words."]);
    expect(navigated).toEqual(["words"]);
  });

  it("finds the words in what streams by, writes at most every two seconds, with handles and counts", async () => {
    const f = fakeCtx({ fetch: profiles });
    await words(f, "coffee", "rain");
    await watchLive(f.ctx);
    await settle();
    expect(f.opened).toEqual([JETSTREAM_URL]);
    const s = f.sockets[0]!;
    for (const m of samples) s.push(m);
    await settle();
    // The first write happened at once; nothing more is written until two seconds have passed.
    const first = f.rows("post").length;
    expect(first).toBeGreaterThan(0);
    s.push(samples[0]!);
    await settle();
    expect(f.rows("post")).toHaveLength(first);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    await settle();
    const posts = f.rows("post");
    expect(posts.length).toBeGreaterThan(first);
    const p = posts.find((r) => r.text === "Morning coffee on the balcony before the rain starts.")!;
    expect(p).toMatchObject({ words: ["coffee", "rain"], handle: "fixture0000.bsky.social", link: "https://bsky.app/profile/did:plc:fixture0000aaaaaaaaaaaaa/post/3mxwu3ud26r2q" });
    // An edited post and the adult one are not here.
    expect(posts.some((r) => String(r.text).includes("edited post"))).toBe(false);
    // One request for the handles of a write, not one per post.
    expect(f.fetched.length).toBeLessThanOrEqual(2);
    const counts = f.rows("minute").reduce((a, m) => a + Number(m.count), 0);
    const words2 = f.rows("word");
    expect(words2.map((w) => w.total)).toEqual([expect.any(Number), expect.any(Number)]);
    expect(counts).toBe(words2.reduce((a, w) => a + Number(w.total), 0));
    expect(f.rows("feed")[0]).toMatchObject({ state: "live" });
  });

  it("writes nothing at all for a firehose that never mentions a word", async () => {
    const f = fakeCtx({ fetch: profiles });
    await words(f, "zeppelin");
    await watchLive(f.ctx);
    await settle();
    for (let i = 0; i < 5000; i++) f.sockets[0]!.push(samples[i % samples.length]!);
    await vi.advanceTimersByTimeAsync(FLUSH_MS * 2);
    expect(f.rows("post")).toHaveLength(0);
    expect(f.rows("minute")).toHaveLength(0);
    expect(f.fetched).toEqual([]);
  });

  it(`keeps at most ${KEEP_POSTS} posts, the newest`, async () => {
    const f = fakeCtx({ fetch: profiles });
    await words(f, "coffee");
    await watchLive(f.ctx);
    await settle();
    const coffee = samples.filter((m) => /"text": "[^"]*coffee/i.test(m) && m.includes('"create"'));
    for (let round = 0; round < 70; round++) {
      for (const m of coffee) f.sockets[0]!.push(m.replace('"rkey": "', `"rkey": "${round}-`));
      await vi.advanceTimersByTimeAsync(FLUSH_MS);
      await settle();
    }
    expect(f.rows("post").length).toBe(KEEP_POSTS);
  });

  it("a word added while live is looked for from the next write on", async () => {
    const f = fakeCtx({ fetch: profiles });
    await words(f, "zeppelin");
    await watchLive(f.ctx);
    await settle();
    (f.ctx.ui as unknown as { prompt: () => Promise<string> }).prompt = async () => "  Rain ";
    await addWord(f.ctx);
    expect(f.rows("word").map((w) => w.word)).toEqual(["zeppelin", "Rain"]);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    f.sockets[0]!.push(samples[0]!);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    await settle();
    expect(f.rows("post").map((p) => p.words)).toEqual([["Rain"]]);
  });

  it("when Bluesky cannot be reached, says so and tries again by itself", async () => {
    const f = fakeCtx();
    await words(f, "rain");
    f.answers.push("unreachable");
    await watchLive(f.ctx);
    await settle();
    expect(f.rows("feed")[0]).toMatchObject({ state: "unreachable" });
    await vi.advanceTimersByTimeAsync(1500);
    await settle();
    expect(f.opened).toEqual([JETSTREAM_URL, JETSTREAM_URL]);
    expect(f.rows("feed")[0]).toMatchObject({ state: "live" });
  });

  it("stop closes the stream and writes what was waiting", async () => {
    const f = fakeCtx({ fetch: profiles });
    await words(f, "rain");
    await watchLive(f.ctx);
    await settle();
    await flush(f.ctx);
    f.sockets[0]!.push(samples[0]!);
    await stopWatching(f.ctx);
    await idle();
    expect(f.sockets[0]!.readyState).toBe("closed");
    expect(f.rows("post")).toHaveLength(1);
    expect(f.rows("feed")[0]).toMatchObject({ state: "off" });
  });
});

describe("the demo", () => {
  it("adds the sample words, a quiet half hour of counts, then invented posts through the same matcher", async () => {
    const f = fakeCtx();
    await playDemo(f.ctx);
    await idle();
    expect(f.rows("word").map((w) => w.word)).toEqual(["coffee", "rain"]);
    expect(f.rows("minute").length).toBe(60);
    await vi.advanceTimersByTimeAsync(DEMO_STEP_MS * (DEMO_SCRIPT.length + 2) + FLUSH_MS * 2);
    await settle();
    const posts = f.rows("post");
    expect(posts.length).toBe(DEMO_SCRIPT.length / 3);
    expect(posts.every((p) => p.demo === true && String(p.handle).endsWith(".demo") && !p.link)).toBe(true);
    expect(posts.some((p) => String(p.text).includes("brain"))).toBe(false);
    expect(f.rows("feed")[0]).toMatchObject({ state: "demo-done" });
    expect(f.opened).toEqual([]);
    expect(f.fetched).toEqual([]);

    await clearDemo(f.ctx);
    await idle();
    expect(f.rows("post")).toHaveLength(0);
    expect(f.rows("minute")).toHaveLength(0);
    expect(f.rows("word")).toHaveLength(0);
  });
});
