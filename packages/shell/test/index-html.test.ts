// What a pasted link to the app shows, and what a crawler is told (#51). The app's page had a title
// and nothing else, so a link to it in a chat was one bare word; and it answered /robots.txt with
// its own HTML.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const here = new URL("..", import.meta.url).pathname;
const html = readFileSync(`${here}index.html`, "utf8");
const meta = (name: string): string | undefined => html.match(new RegExp(`<meta (?:name|property)="${name}" content="([^"]*)"`))?.[1];

describe("the app's own page, before any script runs", () => {
  it("describes Potyro in the site's own words, so the two never drift", () => {
    const words = JSON.parse(readFileSync(`${here}../../site/words.json`, "utf8")).en as Record<string, string>;

    expect(meta("description")).toBe(words.description);
    expect(meta("og:description")).toBe(words.description);
    expect(meta("og:title")).toBe(words.title);
    expect(meta("og:image:alt")).toBe(words.ogAlt);
  });

  it("names a picture by its full address, with its size, and asks for the large card", () => {
    expect(meta("og:image")).toBe("https://potyro.com/media/og.png");
    expect([meta("og:image:width"), meta("og:image:height")]).toEqual(["1200", "630"]);
    expect(meta("twitter:card")).toBe("summary_large_image");
    expect(meta("og:url")).toBe("https://potyro.app/");
  });

  it("keeps its name as the title: it is what an installed app is called", () => {
    expect(html).toContain("<title>Potyro</title>");
  });

  it("has a robots.txt of its own", () => {
    expect(readFileSync(`${here}public/robots.txt`, "utf8")).toMatch(/^User-agent: \*$/m);
  });
});
