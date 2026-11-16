// potyro.com as the build writes it: every page complete, every file it names present, nothing inline
// (the server's policy allows no inline style or script), nothing from anyone else, and the numbers
// on the home counted from the gallery, not typed.
import { describe, expect, it, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite, readWords } from "../build.mjs";
import { HOME_APPS, wordsFor } from "../src/home.mjs";
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

describe("the languages and the theme", () => {
  const wordsOf = (page: string) => JSON.parse(page.split('id="page-data">')[1].split("</script>")[0]);

  it("the home carries every word it says in Potyro's six languages, and marks where each goes", () => {
    const data = wordsOf(home);
    expect(data.languages).toEqual(["en", "pt-BR", "de", "es", "pl", "it"]);
    const keys = Object.keys(data.strings.en);
    for (const lang of data.languages) expect(Object.keys(data.strings[lang]), lang).toEqual(keys);
    // Every mark on the page names a word the script has, so nothing stays English by oversight.
    const marked = [...home.matchAll(/ data-t="(\w+)"/g)].map((m) => m[1]).concat([...home.matchAll(/ data-t-attr="([^"]+)"/g)].flatMap((m) => m[1].split(" ").map((x) => x.split(":")[1])));
    expect(marked.length).toBeGreaterThan(40);
    for (const key of marked) expect(keys, key).toContain(key);
    // The words a visitor reads first are among them.
    for (const key of ["h1", "lead", "promptPlaceholder", "ex1", "data", "safeText", "seeAll", "cta"]) expect(marked, key).toContain(key);
    expect(data.strings["pt-BR"].h1).not.toBe(data.strings.en.h1);
    // The apps shown say their name and line in the language too.
    expect(Object.keys(data.apps)).toHaveLength(6);
    expect(home).toMatch(/<h3 data-app-name="[\w-]+">/);
  });

  it("a word the home says and a language lacks stops the build", () => {
    const words = JSON.parse(readFileSync(join(here, "words.json"), "utf8"));
    const { h1: _gone, ...rest } = words.it;
    expect(() => wordsFor(words, ["h1", "seeAll"])).not.toThrow();
    expect(() => wordsFor({ ...words, it: rest }, ["h1", "seeAll"])).toThrow(/it "h1"/);
    expect(() => wordsFor({ ...words, de: { ...words.de, seeAll: "Alle Apps ansehen" } }, ["h1", "seeAll"])).toThrow(/de "seeAll"/);
    expect(() => readWords({ ...words, es: { ...words.es, nothing: "x" } })).toThrow(/nothing/);
  });

  it("every page has the theme switch, and only the pages written in more than one language have the picker", () => {
    const doc = readFileSync(join(out, "docs", "index.html"), "utf8");
    const how = readFileSync(join(out, "how", "data", "index.html"), "utf8");
    for (const page of [home, apps, doc, how]) expect(page).toMatch(/<button type="button" class="theme" id="theme" hidden/);
    for (const page of [home, apps]) expect(page).toContain('<select id="lang">');
    for (const page of [doc, how]) {
      expect(page).not.toContain('id="lang"');
      expect(wordsOf(page).languages).toEqual(["en"]);
      expect(page).toMatch(/<script src="\/text\.js\?v=\w+" defer><\/script>/);
    }
    // One script per page: what the pages share is the head of each.
    const shared = readFileSync(join(out, "text.js"), "utf8");
    expect(shared).toContain("potyro-gallery:theme");
    for (const f of ["site.js", "gallery.js"]) expect(readFileSync(join(out, f), "utf8").startsWith(shared.trimEnd())).toBe(true);
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
    // The structured data and the words are data blocks, not scripts the policy would run.
    expect(home.replace(/<script type="application\/(?:ld\+)?json"[^>]*>[\s\S]*?<\/script>/g, "")).not.toMatch(/<script(?![^>]*\bsrc=)/);
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
      expect(tag).toMatch(/poster="\/media\/[\w-]+-poster\.jpg\?v=\w+"/);
      expect(tag).not.toContain("autoplay");
    }
    expect(home.match(/type="video\/mp4"/g)!.length).toBe(clips.length);
    expect(home.match(/type="video\/webm"/g)!.length).toBe(clips.length);
  });
});

describe("a recording can be stopped", () => {
  it("each one has a button a keyboard reaches, saying Pause and Play in every language, shown by the script", () => {
    const phones = home.match(/<div class="phone rec-phone[^"]*">.*?<\/div>/gs) ?? [];
    expect(phones.length).toBe((home.match(/<video\b/g) ?? []).length);
    for (const phone of phones) {
      // A real button, in the page's order right after its recording, with no tabindex taking it out.
      expect(phone).toMatch(/<\/video><button type="button" class="rec-toggle" hidden>/);
      expect(phone).not.toContain("tabindex");
      expect(phone).toMatch(/<span class="visually-hidden" data-t="recPause">Pause<\/span>/);
      expect(phone).toMatch(/<span class="visually-hidden" data-t="recPlay">Play<\/span>/);
    }
    const words = JSON.parse(readFileSync(join(here, "words.json"), "utf8"));
    for (const lang of Object.keys(words)) expect(words[lang].recPause, lang).not.toBe(words[lang].recPlay);
  });

  it("a press on the recording or on its button stops it, and scrolling never starts it again", () => {
    const js = readFileSync(join(out, "site.js"), "utf8");
    expect(js).toContain('v.addEventListener("click", toggle)');
    expect(js).toContain('button.addEventListener("click", toggle)');
    expect(js).toContain("button.hidden = false");
    expect(js).toMatch(/else if \(!v\.hasAttribute\("data-held"\)\) start\(v\)/);
    const css = readFileSync(join(out, "site.css"), "utf8");
    expect(css).toMatch(/\.rec-toggle \{[^}]*width: 44px; height: 44px;/);
    expect(css).toMatch(/\.rec-toggle:focus-visible \{[^}]*outline:/);
  });
});

describe("the prompt box", () => {
  it("writes its example in the design system's secondary ink, readable on both grounds", () => {
    expect(readFileSync(join(out, "site.css"), "utf8")).toContain(".prompt-box::placeholder { color: var(--muted); opacity: 1; }");
    const tokens = readFileSync(join(here, "..", "packages", "design", "tokens.css"), "utf8");
    const light = tokens.slice(0, tokens.indexOf("@media (prefers-color-scheme: dark)"));
    const dark = tokens.slice(tokens.indexOf(':root[data-theme="dark"] {'));
    const colour = (css: string, name: string) => new RegExp(`--${name}: (#[0-9a-f]{6})`).exec(css)![1];
    const light1 = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [light1(a), light1(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    // The box's ground is --bg.
    expect(contrast(colour(light, "muted"), colour(light, "bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour(dark, "muted"), colour(dark, "bg"))).toBeGreaterThanOrEqual(4.5);
  });


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
      // The link says what it leads to, not "Learn more" seven times over.
      expect(home).toMatch(new RegExp(`<a href="/how/${id}/"><span data-t="learnMore">[^<]+</span><span class="visually-hidden">: <span data-t="${id}">[^<]+</span></span></a>`));
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

describe("what a browser may keep", () => {
  const hashOf = (path: string) => createHash("sha256").update(readFileSync(join(out, path))).digest("hex").slice(0, 10);

  it("a page names each picture, recording and font with a stamp of its bytes", () => {
    const named = [...home.matchAll(/\b(?:href|src|poster)="(\/(?:fonts|logo|shots|screens|media)\/[^"?]+)(\?v=(\w+))?"/g)];
    expect(named.length).toBeGreaterThan(20);
    for (const [, path, , v] of named) expect(v, path).toBe(hashOf(path));
    const how = readFileSync(join(out, "how", "data", "index.html"), "utf8");
    for (const [, path, v] of how.matchAll(/\bsrc="(\/(?:shots|screens|media)\/[^"?]+)(?:\?v=(\w+))?"/g)) expect(v, path).toBe(hashOf(path));
  });

  it("the stylesheet names each font the same way, so the preloaded file is the one it uses", () => {
    const fonts = [...readFileSync(join(out, "tokens.css"), "utf8").matchAll(/url\("\.\/fonts\/([^"?]+)(?:\?v=(\w+))?"\)/g)];
    expect(fonts.length).toBeGreaterThanOrEqual(5);
    for (const [, file, v] of fonts) expect(v, file).toBe(hashOf(`fonts/${file}`));
    for (const [, path] of home.matchAll(/<link rel="preload" href="\/(fonts\/[^"?]+)\?v=\w+" as="font"/g)) expect(home).toContain(`/${path}?v=${hashOf(path)}`);
    expect(home.match(/<link rel="preload" href="\/fonts\/[^"]+\?v=\w+" as="font"/g)).toHaveLength(2);
  });

  it("a share card's picture keeps its bare address", () => {
    expect(home).toContain('content="https://potyro.com/media/og.png"');
  });
});

describe("the apps page", () => {
  it("its logo leads to the site's home, as on every other page, and not to the app", () => {
    expect(apps).toMatch(/<a class="brand" href="\/">/);
    expect(home).toMatch(/<a class="brand" href="\/"/);
  });

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

// #10: the site counts page views as one number, and nothing about who opened the page.
describe("the visit count", () => {
  const source = readFileSync(join(here, "src", "page", "count.js"), "utf8");
  type Sent = { url: unknown; init: Record<string, unknown> };
  /** Run the script as a page would, in a browser that says this about itself. */
  function open(browser: { gpc?: boolean; dnt?: string; webdriver?: boolean; protocol?: string } = {}): Sent[] {
    const sent: Sent[] = [];
    const fetchFake = (url: unknown, init: Record<string, unknown>) => (sent.push({ url, init }), Promise.resolve({ ok: true }));
    const navigatorFake = { globalPrivacyControl: browser.gpc, doNotTrack: browser.dnt, webdriver: browser.webdriver ?? false };
    // Anything else the script reached for (document, localStorage, cookies) would throw here: it has none.
    new Function("navigator", "location", "fetch", source)(navigatorFake, { protocol: browser.protocol ?? "https:" }, fetchFake);
    return sent;
  }

  it("posts the event and nothing else: no id, no cookie, no referrer, not even which page", () => {
    expect(open()).toEqual([
      {
        url: "/count",
        init: { method: "POST", headers: { "content-type": "application/json" }, body: '{"event":"visit"}', credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", keepalive: true },
      },
    ]);
  });

  it("reads nothing from the visitor's browser and keeps nothing in it", () => {
    const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|cookie|document|userAgent|screen|language|href|pathname|caches/);
  });

  it("does not count a browser that asks not to be tracked, one driven by a program, or a page off https", () => {
    expect(open({ gpc: true })).toEqual([]);
    expect(open({ dnt: "1" })).toEqual([]);
    expect(open({ webdriver: true })).toEqual([]);
    expect(open({ protocol: "http:" })).toEqual([]);
  });

  it("is in every page's one script on potyro.com; the privacy page and the terms load no script, so reading them is not counted", () => {
    for (const f of ["site.js", "gallery.js", "text.js"]) expect(readFileSync(join(out, f), "utf8"), f).toContain(source.trim());
    for (const page of ["privacy", "terms"]) {
      const file = join(out, page, "index.html");
      if (existsSync(file)) expect(readFileSync(file, "utf8")).not.toMatch(/<script/);
    }
  });

  it("the server lets the pages post to their own name only, and passes the POST to the counter", () => {
    const caddy = readFileSync(join(here, "..", "deploy", "potyro.app.Caddyfile"), "utf8");
    const policy = /\(site_headers\)[\s\S]*?Content-Security-Policy "([^"]+)"/.exec(caddy)?.[1] ?? "";
    expect(policy).toContain("default-src 'none'");
    expect(policy.split(";").map((d) => d.trim())).toContain("connect-src 'self'");
    const site = caddy.slice(caddy.indexOf("\npotyro.com {"));
    expect(site).toMatch(/@count \{\s+method POST\s+path \/count\s+\}\s+reverse_proxy @count 127\.0\.0\.1:4204/);
  });
});
