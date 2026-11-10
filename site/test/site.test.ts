// potyro.com as the build writes it: every page complete, every file it names present, nothing inline
// (the server's policy allows no inline style or script), nothing from anyone else, and the numbers
// on the home counted from the gallery, not typed.
import { describe, expect, it, beforeAll } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite, readWords } from "../build.mjs";
import { HOME_APPS } from "../src/home.mjs";
import { readGallery, shownApps } from "../../gallery/src/data.mjs";

const here = new URL("..", import.meta.url).pathname;
let out = "";
let home = "";
let apps = "";

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "potyro-site-"));
  await buildSite({ out });
  home = readFileSync(join(out, "index.html"), "utf8");
  apps = readFileSync(join(out, "apps", "index.html"), "utf8");
}, 120_000);

/** Every local path a page names: href, src, poster, and srcset candidates. */
function localPaths(html: string): string[] {
  const paths = new Set<string>();
  for (const m of html.matchAll(/\b(?:href|src|poster)="([^"]+)"/g)) {
    const url = m[1];
    if (/^(?:https?:|mailto:|#)/.test(url)) continue;
    paths.add(url.split("?")[0].split("#")[0]);
  }
  return [...paths];
}

describe("the words", () => {
  it("every English word is there, and an empty one is refused", () => {
    const words = JSON.parse(readFileSync(join(here, "words.json"), "utf8"));
    expect(() => readWords(words)).not.toThrow();
    expect(() => readWords({ en: { ...words.en, h1: " " } })).toThrow(/h1/);
  });
});

describe("the home", () => {
  it("names only files the build wrote, by their path from the root", () => {
    for (const path of localPaths(home)) {
      expect(path.startsWith("/"), `${path} is not from the root`).toBe(true);
      const file = path.endsWith("/") ? join(out, path, "index.html") : join(out, path);
      expect(existsSync(file), `${path} was not written`).toBe(true);
    }
  });

  it("carries no inline style or script, and loads nothing from anyone else", () => {
    expect(home).not.toMatch(/ style="/);
    expect(home).not.toMatch(/<style[\s>]/);
    // The structured data is a data block, not a script the policy would run.
    expect(home.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, "")).not.toMatch(/<script(?![^>]*\bsrc=)/);
    for (const m of home.matchAll(/\b(?:href|src|poster)="(https?:\/\/[^"/]+)/g)) {
      expect(["https://potyro.app", "https://potyro.com", "https://github.com"], m[1]).toContain(m[1]);
    }
  });

  it("has one h1, the six apps with their real demo links, and the count from the gallery", () => {
    expect(home.match(/<h1\b/g)).toHaveLength(1);
    const gallery = readGallery(JSON.parse(readFileSync(join(here, "..", "gallery", "gallery.json"), "utf8")));
    const published = shownApps(gallery).published;
    expect(home).toContain(`See all ${published.length} apps`);
    for (const id of HOME_APPS) {
      const app = published.find((a) => a.id === id)!;
      expect(home).toContain(`href="${app.link}"`);
      expect(home).toContain(`href="${app.link}&amp;remix=1"`);
    }
  });

  it("shows the recordings with a poster and two formats, and plays nothing by itself", () => {
    const clips = home.match(/<video\b[^>]*>/g) ?? [];
    expect(clips.length).toBeGreaterThanOrEqual(4);
    for (const tag of clips) {
      expect(tag).toContain('preload="none"');
      expect(tag).toMatch(/poster="\/media\/[\w-]+-poster\.jpg"/);
      expect(tag).not.toContain("autoplay");
    }
    expect(home.match(/type="video\/mp4"/g)!.length).toBe(clips.length);
    expect(home.match(/type="video\/webm"/g)!.length).toBe(clips.length);
  });
});

describe("the prompt box", () => {
  it("tells the app where its links came from, and no other link on the page does", () => {
    const links = [...home.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
    const telling = links.filter((a) => a.includes("referrerpolicy"));
    expect(telling.length).toBe(3);
    for (const a of telling) {
      expect(a).toContain('referrerpolicy="origin"');
      expect(a).toMatch(/href="https:\/\/potyro\.app\/\?new=/);
    }
    expect(readFileSync(join(out, "site.js"), "utf8")).toContain('referrerPolicy = "origin"');
  });
});

describe("the share card", () => {
  it("names a 1200×630 image that exists, for Open Graph and Twitter, and describes Potyro as structured data", () => {
    expect(home).toContain('<meta property="og:image" content="https://potyro.com/media/og.png" />');
    expect(home).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(existsSync(join(out, "media", "og.png"))).toBe(true);
    const png = readFileSync(join(out, "media", "og.png"));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(home)?.[1] ?? "";
    const data = JSON.parse(ld);
    expect(data["@graph"].map((n: { "@type": string }) => n["@type"])).toEqual(["WebSite", "SoftwareApplication"]);
    expect(apps).toContain('<meta property="og:image" content="https://potyro.com/media/og.png" />');
  });
});

describe("the text pages", () => {
  const page = (path: string) => readFileSync(join(out, path, "index.html"), "utf8");

  it("every page under docs/<section>/ is a page, listed on the index by section, with the files it names", () => {
    const index = page("docs");
    expect(index).toContain("Introduction");
    for (const label of ["Start", "Concepts", "Guides", "Reference", "Contributing"]) expect(index).toContain(`>${label}</h2>`);
    const links = [...index.matchAll(/href="(\/docs\/[^"]+\/)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThanOrEqual(25);
    for (const url of new Set(links)) expect(existsSync(join(out, url, "index.html")), url).toBe(true);
    for (const p of localPaths(index)) expect(existsSync(p.endsWith("/") ? join(out, p, "index.html") : join(out, p)), p).toBe(true);
    // The engineering notes are not published.
    expect(existsSync(join(out, "docs", "00-how-potyro-works"))).toBe(false);
    expect(index).not.toContain("/docs/00-");
  });

  it("renders a page with its section, the sidebar, the pager and no inline style", () => {
    const intro = page("docs/start/introduction");
    expect(intro).toMatch(/<h1>Introduction<\/h1>/);
    expect(intro).toContain('aria-current="page"');
    expect(intro).toContain('class="pager"');
    expect(intro).not.toMatch(/ style="/);
    expect(intro).not.toMatch(/<style[\s>]/);
    // A relative link to a repository file outside the published pages goes to GitHub.
    const first = page("docs/start/your-first-app");
    expect(first).toMatch(/href="https:\/\/github\.com\/[^"]+\/docs\/tutorials\/code\/01-reading-list\//);
    for (const p of localPaths(first)) expect(existsSync(p.endsWith("/") ? join(out, p, "index.html") : join(out, p)), p).toBe(true);
  });

  it("has a Learn-more page behind every block of the home, and the developers page with the package map", () => {
    for (const id of ["data", "database", "make", "together", "ai", "share", "safe"]) {
      expect(home).toContain(`href="/how/${id}/"`);
      const p = page(`how/${id}`);
      expect(p.match(/<h1\b/g)).toHaveLength(1);
      expect(p).not.toMatch(/ style="/);
      for (const path of localPaths(p)) expect(existsSync(path.endsWith("/") ? join(out, path, "index.html") : join(out, path)), `${id}: ${path}`).toBe(true);
    }
    const dev = page("developers");
    expect(dev).toContain('<svg class="mermaid"');
    // The code is highlighted token by token, so read it as text.
    expect(dev.replace(/<[^>]+>/g, "")).toContain("npm create potyro");
    expect(home).toContain('href="/developers/"');
    expect(home).toContain('href="/docs/"');
  });
});

describe("for crawlers and for a mistyped address", () => {
  it("the sitemap lists every page the build wrote, and nothing that is not one", () => {
    const listed = [...readFileSync(join(out, "sitemap.xml"), "utf8").matchAll(/<loc>https:\/\/potyro\.com([^<]*)<\/loc>/g)].map((m) => m[1]);
    const walk = (dir: string, at = ""): string[] =>
      readdirSync(join(dir, at), { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(dir, `${at}${f.name}/`) : f.name === "index.html" ? [`/${at}`] : []));

    expect(listed.sort()).toEqual(walk(out).sort());
    expect(listed).toContain("/");
    expect(listed).toContain("/apps/");
    expect(listed.every((path) => !path.includes("404"))).toBe(true);
  });

  it("robots.txt lets everyone in and names the sitemap", () => {
    const robots = readFileSync(join(out, "robots.txt"), "utf8");

    expect(robots).toMatch(/^User-agent: \*\nAllow: \/\n/);
    expect(robots).toContain("Sitemap: https://potyro.com/sitemap.xml");
  });

  it("an address that is not a page has a page of its own, in the site's chrome, with two ways on", () => {
    const lost = readFileSync(join(out, "404.html"), "utf8");

    expect(lost.match(/<h1\b/g)).toHaveLength(1);
    expect(lost).toContain('<a href="/">');
    expect(lost).toContain('<a href="/apps/">');
    expect(lost).not.toMatch(/<style\b|\sstyle="/);
    for (const path of localPaths(lost)) expect(existsSync(join(out, path.endsWith("/") ? `${path}index.html` : path)), path).toBe(true);
  });

  it("offers the smaller recording first, so a browser that plays both takes it", () => {
    for (const clip of home.match(/<video\b[^>]*>.*?<\/video>/gs) ?? []) expect(clip.indexOf("video/webm")).toBeLessThan(clip.indexOf("video/mp4"));
  });
});

describe("the apps page", () => {
  it("is the gallery, with its files at the site's root", () => {
    expect(apps).toContain('<link rel="stylesheet" href="/gallery.css?v=');
    expect(apps).toContain('<script src="/gallery.js?v=');
    for (const path of localPaths(apps)) {
      const file = path.endsWith("/") ? join(out, path, "index.html") : join(out, path);
      expect(existsSync(file), `${path} was not written`).toBe(true);
    }
    expect(apps).toContain('id="apps"');
  });

  it("is where the shell sends people, or the shell sends them to the home, which shows apps too", () => {
    // Read as text: the shell's module reads import.meta.env, which this package's types do not know.
    const link = readFileSync(join(here, "..", "packages", "shell", "src", "gallery-link.ts"), "utf8");
    const url = /GALLERY_URL = "([^"]+)"/.exec(link)?.[1];
    expect(["https://potyro.com/", "https://potyro.com/apps/"]).toContain(url);
  });
});
