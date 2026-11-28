// The gallery's data and page (docs/24 §10): the data is checked before anything is built or
// published, the words are in all six languages, and the page asks nothing of anyone else.
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCALES } from "../../packages/i18n/src/locale.ts";
import { remixLink as shellRemixLink, readDemoLink } from "../../packages/shell/src/demo-link.ts";
import { reportAddress } from "../../packages/shell/src/contact.ts";
import sharp from "sharp";
import { FORMAT, galleryProblems, hasShotSet, isDemoLink, LANGUAGES, publishable, readGallery, remixLink, shotFiles, shotPath, shownApps, SHOT_LOCALES } from "../src/data.mjs";
import { buildGallery, CONTACT, escapeHtml, imageSize, readShot, readStrings, renderPage, shotPicture } from "../src/build.mjs";
import { said, writeShot } from "../src/publish.mjs";
import { FEED_FORMAT, feedImage, galleryFeed } from "../src/feed.mjs";
import { FEED_FORMAT as SERVICE_FEED_FORMAT, feedProblems } from "../../packages/fediverse/src/feed.ts";

const here = new URL("..", import.meta.url).pathname;
const real = JSON.parse(readFileSync(join(here, "gallery.json"), "utf8"));
const strings = JSON.parse(readFileSync(join(here, "strings.json"), "utf8"));
const LINK = "https://potyro.app/s/AbCdEfGhIjKlMnOpQrStUv#k=Zm9vYmFyYmF6";
const six = (w: string) => Object.fromEntries(LANGUAGES.map((l) => [l, `${w} ${l}`]));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function withApp(over: Record<string, unknown>) {
  const g = clone(real);
  g.apps = [{ id: "groceries", status: "ready", from: { example: "groceries" }, category: "home", name: six("Groceries"), line: six("A list"), ...over }];
  return g;
}

/** A 1×1 PNG, the smallest real screenshot. */
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

describe("the gallery's data", () => {
  it("the file in the repo is valid, and speaks Potyro's six languages", () => {
    expect(galleryProblems(real)).toEqual([]);
    expect([...LANGUAGES]).toEqual([...LOCALES]);
    expect(real.format).toBe(FORMAT);
  });

  it("publishes only apps that work sealed today; the rest are coming soon, with what they wait for", () => {
    const g = readGallery(real);
    // The apps drawn as their own screens lead (they run sealed since #267; Photo Garden since #388);
    // the examples follow, then the live feeds and Notes, whose demos open on a replay and on notes
    // (#389). An app on an open PR waits for it.
    expect(publishable(g).map((a) => a.id)).toEqual([
      // The most alive first — the apps with screens and mechanisms of their own — the small
      // utilities last (owner, 2026-11-06: "more complex like this one must have a higher priority").
      "write-together", "draw-guess", "piano", "photo-garden", "mirror-monsters", "daily-puzzle", "photo-puzzle", "palette-catcher",
      "mood-sleep", "earthquakes", "word-watch", "ticker", "plant-doctor", "poster-event", "receipt-split", "markdown-notes", "pantry",
      "recipes", "groceries", "plants", "places", "split", "workout",
      "countdowns", "where-i-parked", "which-is-cheaper", "qr-maker",
    ]);
    // The workbench is empty (2026-10-20): every app that was on it has shipped.
    const soon = g.apps.filter((a) => a.status === "coming-soon");
    expect(soon).toEqual([]);
    expect(publishable(g, ["plants"]).map((a) => a.id)).toEqual(["plants"]);
  });

  it("refuses words missing in a language, or too long for a card", () => {
    const missing = withApp({ name: { ...six("G"), pl: "" } });
    expect(galleryProblems(missing)).toContain("app groceries name has no pl");
    const long = withApp({ line: { ...six("x"), de: "x".repeat(200) } });
    expect(galleryProblems(long).join()).toMatch(/line.de is 200 characters/);
    const extra = withApp({ name: { ...six("G"), fr: "Courses" } });
    expect(galleryProblems(extra).join()).toMatch(/fr, which Potyro does not speak/);
  });

  it("refuses an app that is not where it says, in no category, or listed twice", () => {
    expect(galleryProblems(withApp({ from: { package: ["../etc/passwd"] } })).join()).toMatch(/where it comes from/);
    expect(galleryProblems(withApp({ from: { package: ["apps/notes/notes.app.tsx"], files: "../etc" } })).join()).toMatch(/files is a folder under apps/);
    expect(galleryProblems(withApp({ from: { package: ["apps/notes/notes.app.tsx"], files: "apps/notes/files", seed: "apps/notes/seed.json" } }))).toEqual([]);
    expect(galleryProblems(withApp({ category: "nope" })).join()).toMatch(/category nope/);
    const twice = withApp({});
    twice.apps.push(clone(twice.apps[0]));
    expect(galleryProblems(twice).join()).toMatch(/listed twice/);
  });

  it("accepts only hosted demo links, https, with their key and nothing else in the fragment", () => {
    expect(isDemoLink(LINK)).toBe(true);
    expect(isDemoLink(`${LINK}&remix=1`)).toBe(false);
    expect(isDemoLink("https://potyro.app/#try=UEsDBA")).toBe(false);
    expect(isDemoLink("https://evil.example/phish")).toBe(false);
    expect(isDemoLink("http://potyro.app/s/AbCdEfGhIjKlMnOpQrStUv#k=x")).toBe(false);
    // http only for this machine, and only when asked
    expect(isDemoLink("http://localhost:4977/s/AbCdEfGhIjKlMnOpQrStUv#k=x")).toBe(false);
    expect(isDemoLink("http://localhost:4977/s/AbCdEfGhIjKlMnOpQrStUv#k=x", { allowLocal: true })).toBe(true);
    expect(galleryProblems(withApp({ link: "javascript:alert(1)", screenshot: "shots/g.jpg" })).join()).toMatch(/not a demo link/);
    expect(galleryProblems(withApp({ link: LINK })).join()).toMatch(/has a screenshot/);
    expect(galleryProblems(withApp({ link: LINK, screenshot: "../../x.jpg" })).join()).toMatch(/screenshot must be/);
  });

  it("makes the same remix link the shell reads as Make it mine", () => {
    expect(remixLink(LINK)).toBe(shellRemixLink(LINK));
    const url = new URL(remixLink(LINK));
    expect(readDemoLink(url.pathname, url.hash)).toMatchObject({ kind: "hosted", remix: true });
    expect(remixLink(remixLink(LINK))).toBe(remixLink(LINK));
  });
});

describe("the gallery's words", () => {
  it("every language says everything English says, with the same placeholders", () => {
    expect(() => readStrings(strings)).not.toThrow();
    const broken = clone(strings);
    broken.pl.tryLabel = "Wypróbuj";
    delete broken.de.privacy;
    expect(() => readStrings(broken)).toThrow(/de has no "privacy"[\s\S]*pl "tryLabel" does not keep the placeholders/);
  });
});

describe("the page", () => {
  const published = () => {
    const g = withApp({ link: LINK, screenshot: "shots/groceries.png" });
    g.apps.push(...clone(real.apps.filter((a: { status: string }) => a.status === "coming-soon")));
    return readGallery(g);
  };
  const html = () => renderPage(published(), readStrings(strings), { css: "c", js: "j", shots: { "shots/groceries.png": { width: 412, height: 860 } } });

  it("offers Try it and Make it mine for each app, with the remix intent on the second", () => {
    const page = html();
    expect(page).toContain(`href="${escapeHtml(LINK)}"`);
    expect(page).toContain(`href="${escapeHtml(`${LINK}&remix=1`)}"`);
    expect(page).toContain('aria-label="Try Groceries en"');
    expect(page).toContain('aria-label="Make Groceries en mine"');
    expect(page).toContain('width="412" height="860"');
    // The workbench is empty since 2026-10-20: the page leaves the section out rather than show a bare heading.
    expect(shownApps(published()).soon).toEqual([]);
    expect(page).not.toContain('<section class="soon"');
  });

  it("has no inline style: potyro.com's CSP is style-src 'self', and the browser blocks one with an error", () => {
    expect(html()).not.toMatch(/\sstyle="/);
  });

  it("asks nothing of anyone else: every address it loads is its own", () => {
    const page = html();
    const loads = [...page.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]!);
    const external = loads.filter((u) => /^(https?:)?\/\//.test(u));
    // Links a person follows — the demo links and Potyro itself — are not loads; nothing else may be external.
    expect(external.every((u) => u.startsWith("https://potyro.app/"))).toBe(true);
    expect(page).not.toMatch(/<link[^>]+href="https?:/);
    expect(page).not.toMatch(/<script[^>]+src="https?:/);
    const css = readFileSync(join(here, "src/page/gallery.css"), "utf8");
    expect(css).not.toMatch(/url\(\s*["']?https?:/);
    expect(css).not.toMatch(/@import/);
    const js = readFileSync(join(here, "src/page/gallery.js"), "utf8");
    expect(js).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|https?:\/\//);
  });

  it("says the report address in one place, and escapes what it is given", () => {
    expect(html()).toContain(`mailto:${CONTACT}?subject=`);
    // The same address the app's demo bar reports to (packages/shell/src/contacts.json, #11).
    expect(CONTACT).toBe(reportAddress());
    const g = published();
    g.apps[0]!.name.en = '<img src=x onerror="alert(1)">';
    const page = renderPage(g, readStrings(strings), { css: "c", js: "j", shots: {} });
    expect(page).not.toContain("<img src=x");
    // inside the data block too
    expect(page.split('id="page-data">')[1]).not.toMatch(/<img/);
  });

  it("builds into a folder: the page, its style and script, and only the screenshots it shows", () => {
    const dir = mkdtempSync(join(tmpdir(), "gallery-test-"));
    const data = join(dir, "gallery.json");
    mkdirSync(join(dir, "shots"));
    writeFileSync(join(dir, "shots", "groceries.png"), PNG);
    writeFileSync(join(dir, "shots", "stray.png"), PNG);
    writeFileSync(data, JSON.stringify(published()));
    const done = buildGallery({ data, out: join(dir, "out") });
    expect(done.published).toBe(1);
    const page = readFileSync(join(dir, "out", "index.html"), "utf8");
    expect(page).toContain('src="shots/groceries.png" width="1" height="1"');
    expect(() => readFileSync(join(dir, "out", "shots", "stray.png"))).toThrow();
    for (const f of ["gallery.css", "gallery.js", "favicon.svg", "shots/groceries.png"]) expect(readFileSync(join(dir, "out", f)).length).toBeGreaterThan(0);
  });

  it("the logo leads to the app when the gallery stands alone, and to the site's home when it is one of its pages", () => {
    const alone = renderPage(published(), readStrings(strings), { css: "c", js: "j", shots: {} });
    const onSite = renderPage(published(), readStrings(strings), { css: "c", js: "j", shots: {}, base: "/" });
    expect(alone).toContain('<a class="brand" href="https://potyro.app/">');
    expect(onSite).toContain('<a class="brand" href="/">');
  });

  it("links the privacy page and the terms only when it has them (#117)", () => {
    expect(html()).not.toMatch(/href="(privacy|terms)\//);
    const page = renderPage(published(), readStrings(strings), { css: "c", js: "j", shots: {}, legal: true });
    expect(page).toContain('<a href="privacy/" data-t="legalPrivacy">Privacy</a>');
    expect(page).toContain('<a href="terms/" data-t="legalTerms">Terms of use</a>');
  });

  it("builds the legal pages beside the page only once their texts are finished", () => {
    const dir = mkdtempSync(join(tmpdir(), "gallery-test-"));
    const data = join(dir, "gallery.json");
    mkdirSync(join(dir, "shots"));
    writeFileSync(join(dir, "shots", "groceries.png"), PNG);
    writeFileSync(data, JSON.stringify(published()));
    // Copies of the texts as the owner will leave them: the Draft note gone, every placeholder filled.
    const finished = (page: string) =>
      readFileSync(join(here, "..", "docs", "legal", `${page}.md`), "utf8")
        .replace(/^> \*\*Draft\.\*\*[^\n]*\n(?:>[^\n]*\n)*/m, "")
        .replace(/<DATE>/g, "2026-11-01")
        .replace(/<[A-Z][^<>\n]*>/g, "filled");
    const texts = (name: string, edit: (page: string, md: string) => string) => {
      const folder = join(dir, name);
      mkdirSync(folder);
      for (const page of ["privacy", "terms"]) writeFileSync(join(folder, `${page}.md`), edit(page, finished(page)));
      return folder;
    };
    // An unfinished copy (one placeholder left): no pages, no links, and the reason.
    const waiting = buildGallery({ data, out: join(dir, "waiting"), legal: texts("unfinished", (page, md) => (page === "terms" ? `${md}\nWrite to <ABUSE EMAIL>.\n` : md)) });
    expect(waiting.legal).toMatch(/^legal: \/privacy and \/terms not built: terms\.md still has <ABUSE EMAIL>/);
    expect(existsSync(join(dir, "waiting", "privacy"))).toBe(false);
    expect(readFileSync(join(dir, "waiting", "index.html"), "utf8")).not.toContain('data-t="legalPrivacy"');
    // Finished copies: both pages, their own styles, and the footer links.
    const done = buildGallery({ data, out: join(dir, "out"), legal: texts("finished", (_, md) => md) });
    expect(done.legal).toBeNull();
    for (const f of ["privacy/index.html", "terms/index.html"]) expect(existsSync(join(dir, "out", f))).toBe(true);
    const files = (sub: string) => readdirSync(join(dir, "out", sub));
    expect(files("legal").some((f) => /^legal\.[0-9a-f]{10}\.css$/.test(f))).toBe(true);
    expect(files("legal").some((f) => /^tokens\.[0-9a-f]{10}\.css$/.test(f))).toBe(true);
    expect(files(join("legal", "fonts")).some((f) => /^figtree-latin\.[0-9a-f]{10}\.woff2$/.test(f))).toBe(true);
    expect(readFileSync(join(dir, "out", "index.html"), "utf8")).toContain('href="privacy/"');
    const privacy = readFileSync(join(dir, "out", "privacy", "index.html"), "utf8");
    // On potyro.com, "Open Potyro" is the app, as it is in the gallery's own footer — not potyro.com again.
    expect(privacy).toContain('<a href="https://potyro.app/">Open Potyro</a>');
    // potyro.com's CSP is style-src 'self' and script-src 'self': no inline style, no script.
    expect(privacy).not.toMatch(/\sstyle="|<style|<script/);
  });

  it("refuses to build a published app without its screenshot", () => {
    const dir = mkdtempSync(join(tmpdir(), "gallery-test-"));
    const data = join(dir, "gallery.json");
    writeFileSync(data, JSON.stringify(published()));
    expect(() => buildGallery({ data, out: join(dir, "out") })).toThrow(/screenshot shots\/groceries.png is not in/);
  });

  it("reads a screenshot's size from its header", () => {
    expect(imageSize(PNG)).toEqual({ width: 1, height: 1 });
    expect(imageSize(Buffer.from("not an image"))).toBeNull();
  });
});

// #33: an app's picture is a set — every language and theme it was shot in, AVIF and WebP, 1x and 2x.
describe("an app's pictures", () => {
  /** A screen as the publisher takes it: 824 px across, 2x of the stranger's 412. */
  const screen = (colour: string) => sharp({ create: { width: 824, height: 1720, channels: 3, background: colour } }).png().toBuffer();
  const app = { id: "groceries", screenshot: shotPath("groceries") };
  /** A gallery folder with the pictures the publisher writes for these languages. */
  async function shot(locales: readonly string[]) {
    const dir = mkdtempSync(join(tmpdir(), "gallery-shots-"));
    for (const locale of locales) for (const theme of ["light", "dark"]) await writeShot(await screen(theme === "dark" ? "#1c1b1c" : "#ffffff"), dir, "groceries", locale, theme);
    return dir;
  }

  it("names every file by language, theme and width, and the fallback is the first of each", () => {
    expect(shotPath("groceries")).toBe("shots/en/groceries-light-412.webp");
    expect(shotPath("groceries", { locale: "pt-BR", theme: "dark", width: 824, format: "avif" })).toBe("shots/pt-BR/groceries-dark-824.avif");
    expect(shotFiles("groceries", "en")).toHaveLength(8);
    expect(hasShotSet(app)).toBe(true);
    expect(hasShotSet({ id: "groceries", screenshot: "shots/groceries.jpg" })).toBe(false);
    // The data accepts the fallback's path, and still refuses a path out of the folder.
    expect(galleryProblems(withApp({ link: LINK, screenshot: app.screenshot }))).toEqual([]);
    expect(galleryProblems(withApp({ link: LINK, screenshot: "shots/../../x.webp" })).join()).toMatch(/screenshot must be/);
  });

  it("the publisher writes each shot as AVIF and WebP at 1x and 2x, the size the page will say", async () => {
    const dir = await shot(["en"]);
    for (const f of shotFiles("groceries", "en")) {
      const meta = await sharp(join(dir, f)).metadata();
      expect([f, meta.format === "heif" ? "avif" : meta.format, meta.width, meta.height]).toEqual([f, f.split(".").pop(), f.includes("-824.") ? 824 : 412, f.includes("-824.") ? 1720 : 860]);
    }
    expect(imageSize(readFileSync(join(dir, app.screenshot)))).toEqual({ width: 412, height: 860 });
  });

  it("a set is a <picture>: dark for a device in dark, AVIF before WebP, both widths, and its size", () => {
    const html = shotPicture(app, { width: 412, height: 860, locales: ["en", "pt-BR"] }, { base: "/" });
    expect(html).toMatch(/^<picture data-shot-locales="en pt-BR">/);
    const sources = [...html.matchAll(/<source ([^>]+)\/>/g)].map((m) => m[1]!);
    expect(sources.map((x) => [x.match(/data-theme-of="(\w+)"/)![1], x.match(/media="([^"]+)"/)?.[1] ?? null, x.match(/type="([^"]+)"/)![1]])).toEqual([
      ["dark", "(prefers-color-scheme: dark)", "image/avif"],
      ["dark", "(prefers-color-scheme: dark)", "image/webp"],
      ["light", null, "image/avif"],
    ]);
    expect(sources[0]).toContain('srcset="/shots/en/groceries-dark-412.avif 412w, /shots/en/groceries-dark-824.avif 824w"');
    for (const x of sources) expect(x).toMatch(/ sizes="[^"]+"/);
    // The <img> is the light WebP, with the size that keeps the page still while it arrives.
    expect(html).toMatch(/<img src="\/shots\/en\/groceries-light-412\.webp" srcset="\/shots\/en\/groceries-light-412\.webp 412w, \/shots\/en\/groceries-light-824\.webp 824w" sizes="[^"]+" width="412" height="860" /);
    // One file someone put there stays the one <img> it was.
    expect(shotPicture({ id: "groceries", screenshot: "shots/groceries.png" }, { width: 1, height: 1 })).toBe('<img src="shots/groceries.png" width="1" height="1" alt="" loading="lazy" decoding="async" />');
  });

  it("the build copies every file of every whole language, and names the languages on the card", async () => {
    const dir = await shot(SHOT_LOCALES);
    // A language shot only in part does not count: the card keeps the first for it.
    const partial = await shot(["en"]);
    mkdirSync(join(partial, "shots", "pt-BR"));
    writeFileSync(join(partial, shotPath("groceries", { locale: "pt-BR" })), readFileSync(join(dir, shotPath("groceries", { locale: "pt-BR" }))));
    expect(readShot(partial, app).shot).toEqual({ width: 412, height: 860, locales: ["en"] });
    expect(readShot(dir, app)).toEqual({ shot: { width: 412, height: 860, locales: [...SHOT_LOCALES] }, files: SHOT_LOCALES.flatMap((l) => shotFiles("groceries", l)) });

    writeFileSync(join(dir, "gallery.json"), JSON.stringify(withApp({ link: LINK, screenshot: app.screenshot })));
    buildGallery({ data: join(dir, "gallery.json"), out: join(dir, "out") });
    const page = readFileSync(join(dir, "out", "index.html"), "utf8");
    expect(page).toContain(`<picture data-shot-locales="${SHOT_LOCALES.join(" ")}">`);
    // Every address the page asks for is a file in the folder.
    const asked = [...page.matchAll(/srcset="([^"]+)"/g)].flatMap((m) => m[1]!.split(", ").map((c) => c.split(" ")[0]!));
    expect(asked).toHaveLength(8);
    for (const f of [...asked, ...SHOT_LOCALES.flatMap((l) => shotFiles("groceries", l))]) expect(existsSync(join(dir, "out", f)), f).toBe(true);
  });

  it("refuses to build a set with a file missing in the first language, and says the command", async () => {
    const dir = await shot(["en"]);
    writeFileSync(join(dir, "gallery.json"), JSON.stringify(withApp({ link: LINK, screenshot: app.screenshot })));
    const gone = join(dir, shotPath("groceries", { theme: "dark", width: 824, format: "avif" }));
    rmSync(gone);
    expect(() => buildGallery({ data: join(dir, "gallery.json"), out: join(dir, "out") })).toThrow(/groceries-dark-824\.avif\): pnpm gallery:shoot --only groceries/);
  });

  it("every published app in the repo has its whole set, in every language the gallery shoots", () => {
    for (const a of shownApps(readGallery(clone(real))).published) {
      expect(hasShotSet(a), a.id).toBe(true);
      expect(readShot(here, a).shot, a.id).toEqual({ width: 412, height: 860, locales: [...SHOT_LOCALES] });
    }
  });

  it("presses a button by its name in the screen's language, from Potyro's catalog", () => {
    expect(said("en", "Fetch and open")).toBe("Fetch and open");
    expect(said("pt-BR", "Fetch and open")).toBe("Baixar e abrir");
    expect(said("pt-BR", "words no catalog has")).toBe("words no catalog has");
  });
});

describe("the feed the gallery's fediverse account posts from (docs/33)", () => {
  const sizeOf = (path: string) => imageSize(readFileSync(join(here, path)));

  it("the gallery in the repo makes a feed the service takes: every published app, in six languages", () => {
    const g = readGallery(clone(real));
    const made = JSON.parse(JSON.stringify(galleryFeed(g, readStrings(strings), sizeOf)));
    expect(FEED_FORMAT).toBe(SERVICE_FEED_FORMAT);
    expect(feedProblems(made)).toEqual([]);
    expect(made.languages).toEqual([...LANGUAGES]);
    expect(made.apps.map((a: { id: string }) => a.id)).toEqual(shownApps(g).published.map((a) => a.id));
  });

  it("an app says its two links, when its link was made, and its widest light WebP with its real size", () => {
    const g = readGallery(clone(real));
    const first = shownApps(g).published[0]!;
    const [app] = galleryFeed(g, readStrings(strings), sizeOf).apps;
    expect(app).toMatchObject({ id: first.id, link: first.link, remix: remixLink(first.link!), publishedAt: first.publishedAt, name: first.name, line: first.line });
    expect(app!.image).toMatchObject({ path: `shots/en/${first.id}-light-824.webp`, mediaType: "image/webp", width: 824 });
    expect(app!.image!.height).toBeGreaterThan(824);
  });

  it("an app with one picture and no set carries that picture; coming-soon apps are not in the feed", () => {
    const g = withApp({ link: LINK, screenshot: "shots/groceries.png" });
    g.apps.push({ id: "later", status: "coming-soon", waitsFor: "#1", category: "home", name: six("Later"), line: six("Soon") });
    const made = galleryFeed(readGallery(g), readStrings(strings), () => ({ width: 412, height: 860 }));
    expect(made.apps).toHaveLength(1);
    expect(made.apps[0]!.image).toEqual({ path: "shots/groceries.png", mediaType: "image/png", width: 412, height: 860 });
    expect(made.apps[0]).not.toHaveProperty("publishedAt");
  });

  it("refuses a picture whose size cannot be read, rather than post without saying", () => {
    expect(() => feedImage({ id: "groceries", screenshot: "shots/groceries.png" }, () => null)).toThrow(/groceries.*feed/);
  });

  it("the build writes it beside the page", () => {
    const dir = mkdtempSync(join(tmpdir(), "gallery-feed-"));
    mkdirSync(join(dir, "shots"));
    writeFileSync(join(dir, "shots", "groceries.png"), PNG);
    writeFileSync(join(dir, "gallery.json"), JSON.stringify(withApp({ link: LINK, screenshot: "shots/groceries.png" })));
    buildGallery({ data: join(dir, "gallery.json"), out: join(dir, "out") });
    const made = JSON.parse(readFileSync(join(dir, "out", "feed.json"), "utf8"));
    expect(feedProblems(made)).toEqual([]);
    expect(made.apps[0].image).toEqual({ path: "shots/groceries.png", mediaType: "image/png", width: 1, height: 1 });
    rmSync(dir, { recursive: true, force: true });
  });
});
