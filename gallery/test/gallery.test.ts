// The gallery's data and page (docs/24 §10): the data is checked before anything is built or
// published, the words are in all six languages, and the page asks nothing of anyone else.
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCALES } from "../../packages/i18n/src/locale.ts";
import { remixLink as shellRemixLink, readDemoLink } from "../../packages/shell/src/demo-link.ts";
import { reportAddress } from "../../packages/shell/src/contact.ts";
import { FORMAT, galleryProblems, isDemoLink, LANGUAGES, publishable, readGallery, remixLink, shownApps } from "../src/data.mjs";
import { buildGallery, CONTACT, escapeHtml, imageSize, readStrings, renderPage } from "../src/build.mjs";

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
      "mood-sleep", "draw-guess", "mirror-monsters", "photo-garden", "daily-puzzle", "photo-puzzle", "palette-catcher", "piano",
      "recipes", "groceries", "plants", "places", "split", "workout", "receipt-split",
      "pantry", "plant-doctor", "poster-event", "earthquakes", "word-watch", "ticker", "markdown-notes",
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
    expect(page.split('id="gallery-data">')[1]).not.toMatch(/<img/);
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
