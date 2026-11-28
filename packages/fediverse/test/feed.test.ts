import { describe, expect, it } from "vitest";
import { feedProblems, readFeed } from "../src/feed.ts";
import { app, feed } from "./helpers.ts";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("the gallery's feed, checked before anything is posted from it", () => {
  it("takes a feed as the gallery build writes it", () => {
    const f = feed([app("pantry"), app("piano", { image: undefined })]);
    expect(feedProblems(clone(f))).toEqual([]);
    expect(readFeed(clone(f)).apps).toHaveLength(2);
  });

  it("refuses a feed with no apps: it would take every post down", () => {
    expect(() => readFeed(feed([]))).toThrow(/no apps/);
  });

  it("refuses another format, and what is not a feed at all", () => {
    expect(feedProblems({ ...feed([app("pantry")]), format: "potyro-gallery/1" })).toEqual([expect.stringMatching(/format/)]);
    expect(feedProblems(null)).toHaveLength(1);
    expect(feedProblems([])).toHaveLength(1);
  });

  it("refuses an app twice, an id that is not one, a time that is not one", () => {
    expect(feedProblems(feed([app("pantry"), app("pantry")]))).toContain("an app is in the feed twice");
    expect(feedProblems(feed([app("../etc")]))).toEqual(expect.arrayContaining([expect.stringMatching(/apps\[0\]\.id/)]));
    expect(feedProblems(feed([app("pantry", { publishedAt: "yesterday" })]))).toEqual([expect.stringMatching(/publishedAt/)]);
  });

  it("refuses a link that is not https, and a picture outside the site", () => {
    expect(feedProblems(feed([app("pantry", { link: "javascript:alert(1)" })]))).toEqual([expect.stringMatching(/link/)]);
    expect(feedProblems(feed([app("pantry", { remix: "http://potyro.app/s/x" })]))).toEqual([expect.stringMatching(/remix/)]);
    const image = { path: "../../etc/passwd", mediaType: "image/webp", width: 1, height: 1 };
    expect(feedProblems(feed([app("pantry", { image })]))).toEqual([expect.stringMatching(/image\.path/)]);
    expect(feedProblems(feed([app("pantry", { image: { ...image, path: "shots/a.webp", mediaType: "text/html" } })]))).toEqual([expect.stringMatching(/mediaType/)]);
  });

  it("refuses words missing in a language the feed says it speaks", () => {
    const f = feed([app("pantry", { name: { en: "Pantry" } })]);
    expect(feedProblems(f)).toEqual(["apps[0].name has no pt-BR"]);
    const g = clone(feed([app("pantry")])) as unknown as { words: Record<string, unknown> };
    delete g.words.tryIt;
    expect(feedProblems(g)).toEqual([expect.stringMatching(/words\.tryIt/)]);
  });
});
