// Reading Jetstream (messages in its real format, the people and texts replaced by invented ones) and
// finding words in it: only new posts, words on their own, adult posts left out, the firehose mostly
// dropped before it is parsed — and the sums behind the counts and the sparkline.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { batch, cleanWord, JETSTREAM_URL, lastMinutes, makeMatcher, minuteOf, oldest, postUrl, profilesUrl, readPost, sparkline, MAX_TEXT, type Hit } from "../watch.js";
import { DEMO_SCRIPT, DEMO_WORDS, demoMessage } from "../demo.js";

const samples = JSON.parse(readFileSync(new URL("../fixtures/jetstream-sample.json", import.meta.url), "utf8")) as string[];

describe("reading Jetstream", () => {
  it("keeps new posts with text, and nothing else: deletes, edits, identity and account events go", () => {
    const posts = samples.map(readPost).filter(Boolean);
    const kinds = samples.map((s) => JSON.parse(s) as { kind: string; commit?: { operation: string } });
    const creates = kinds.filter((k) => k.kind === "commit" && k.commit?.operation === "create").length;
    expect(kinds.some((k) => k.kind === "identity")).toBe(true);
    expect(kinds.some((k) => k.kind === "account")).toBe(true);
    expect(kinds.some((k) => k.commit?.operation === "delete")).toBe(true);
    // One create is marked adult by its author.
    expect(posts).toHaveLength(creates - 1);
    expect(posts[0]).toMatchObject({ did: "did:plc:fixture0000aaaaaaaaaaaaa", text: "Morning coffee on the balcony before the rain starts.", langs: ["en"] });
    expect(posts[0]!.createdAt).toBeInstanceOf(Date);
  });

  it("leaves out a post its author marked adult", () => {
    const adult = samples.find((s) => s.includes('"porn"'))!;
    expect(adult).toBeDefined();
    expect(readPost(adult)).toBeNull();
  });

  it("keeps at most 300 characters of a post", () => {
    const long = JSON.parse(samples.find((s) => s.includes('"operation": "create"'))!) as { commit: { record: { text: string } } };
    long.commit.record.text = "x".repeat(1000);
    expect(readPost(JSON.stringify(long))!.text).toHaveLength(MAX_TEXT);
  });

  it("knows where things live: the stream, a handle, a post on bsky.app", () => {
    expect(JETSTREAM_URL).toBe("wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post");
    expect(profilesUrl(["did:plc:a", "did:plc:b"])).toBe("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?actors=did%3Aplc%3Aa&actors=did%3Aplc%3Ab");
    expect(postUrl("did:plc:a", "3abc")).toBe("https://bsky.app/profile/did:plc:a/post/3abc");
  });
});

describe("finding words", () => {
  const words = [
    { id: "w1", word: "rain" },
    { id: "w2", word: "coffee" },
    { id: "w3", word: "  cold   brew " },
  ];
  const match = makeMatcher(words);
  const ids = (raw: string) => match(raw)?.ids ?? [];

  it("finds a word on its own, in any case, as a hashtag — and not inside another word", () => {
    const at = (text: string) => demoLike(text);
    expect(ids(at("Rain all week here."))).toEqual(["w1"]);
    expect(ids(at("RAIN!!!"))).toEqual(["w1"]);
    expect(ids(at("soup day #rain"))).toEqual(["w1"]);
    expect(ids(at("My brain is fried."))).toEqual([]);
    expect(ids(at("rainbow over the city"))).toEqual([]);
    expect(ids(at("Morning coffee before the rain starts."))).toEqual(["w1", "w2"]);
    expect(ids(at("Cold brew season is over"))).toEqual(["w3"]);
  });

  it("finds words in other scripts and with accents", () => {
    const m = makeMatcher([{ id: "a", word: "café" }, { id: "b", word: "deszcz" }, { id: "c", word: "雨" }]);
    expect(m(demoLike("Um café, por favor."))?.ids).toEqual(["a"]);
    expect(m(demoLike("Deszcz od rana."))?.ids).toEqual(["b"]);
    expect(m(demoLike("今日は 雨 です"))?.ids).toEqual(["c"]);
    expect(m(demoLike("cafés are open"))).toBeNull();
  });

  it("drops the firehose without parsing it: a message without any watched word never reaches JSON.parse", () => {
    const spy = vi.spyOn(JSON, "parse");
    const quiet = demoLike("The sunset tonight was unreal.");
    for (let i = 0; i < 1000; i++) expect(match(quiet)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("keeps up with a firehose: 20,000 messages, a few matching, in well under a second", () => {
    const raw = samples.filter((s) => !s.includes("coffee") && !s.includes("rain") && !s.includes("Rain"));
    const t = performance.now();
    let hits = 0;
    for (let i = 0; i < 20_000; i++) if (match(raw[i % raw.length]!)) hits++;
    expect(hits).toBe(0);
    expect(performance.now() - t).toBeLessThan(1000);
  });

  it("tidies what was typed, and an empty list matches nothing", () => {
    expect(cleanWord("  cold    brew  ")).toBe("cold brew");
    expect(makeMatcher([])(samples[0]!)).toBeNull();
  });

  it("plays the demo through the same matcher: the demo words match, the rest stream past", () => {
    const m = makeMatcher(DEMO_WORDS.map((w, i) => ({ id: String(i), word: w })));
    const hits = DEMO_SCRIPT.map((_, i) => m(demoMessage(i, Date.now()))).filter(Boolean);
    expect(hits.length).toBe(DEMO_SCRIPT.length / 3);
  });
});

describe("the sums", () => {
  const post = (text: string) => ({ did: "did:plc:x", rkey: "r", text, createdAt: new Date(), langs: [] });
  const hit = (ids: string[], text = "t"): Hit => ({ post: post(text), ids });

  it("counts every match per word and minute, but keeps only the newest few posts per word", () => {
    const at = new Date("2026-10-15T12:00:30Z");
    const later = new Date("2026-10-15T12:01:10Z");
    const hits = [
      ...Array.from({ length: 6 }, (_, i) => ({ hit: hit(["rain"], `r${i}`), at })),
      { hit: hit(["rain", "coffee"], "both"), at: later },
      { hit: hit(["coffee"], "c1"), at: later },
    ];
    const b = batch(hits, 3);
    expect([...b.counts.get("rain")!.entries()]).toEqual([
      [minuteOf(later), 1],
      [minuteOf(at), 6],
    ]);
    expect([...b.counts.get("coffee")!.values()]).toEqual([2]);
    expect(b.posts.map((p) => p.post.text)).toEqual(["c1", "both", "r5", "r4"]);
  });

  it("draws a sparkline in eight steps", () => {
    expect(sparkline([0, 1, 2, 3, 4, 5, 6, 7])).toBe("▁▂▃▄▅▆▇█");
    expect(sparkline([0, 0, 0])).toBe("▁▁▁");
  });

  it("lays counts out over the last minutes, oldest first", () => {
    const now = new Date("2026-10-15T12:05:20Z");
    const m = (min: number, count: number) => ({ at: new Date(`2026-10-15T12:0${min}:00Z`), count });
    expect(lastMinutes([m(5, 2), m(3, 4), m(3, 1), m(0, 9)], now, 4)).toEqual([0, 5, 0, 2]);
  });

  it("finds the oldest beyond a limit", () => {
    const rows = [3, 1, 2, 5, 4].map((h) => ({ id: `p${h}`, at: new Date(2026, 9, 15, h) }));
    expect(oldest(rows, 3).sort()).toEqual(["p1", "p2"]);
  });
});

/** A Jetstream create in the real format, with this text. */
function demoLike(text: string): string {
  return JSON.stringify({ did: "did:plc:fixture", time_us: 1, kind: "commit", commit: { rev: "r", operation: "create", collection: "app.bsky.feed.post", rkey: "k", record: { $type: "app.bsky.feed.post", createdAt: new Date().toISOString(), langs: ["en"], text }, cid: "c" } });
}
