#!/usr/bin/env node
// `pnpm site:build` — potyro.com as one static folder (#32): the home (site/src/home.mjs) at /, the
// gallery (gallery/src/build.mjs) at /apps/, the privacy page and the terms (packages/legal) when their
// texts are ready, and every file they need beside them: the design system's tokens and fonts, the
// colour clock (hours.css), the logo, the apps' screenshots, the recordings. Nothing from anyone else;
// no inline style, no inline script (deploy/potyro.app.Caddyfile). Deployed by rsync (docs/16).
//
//   pnpm site:build [--out dist/site] [--allow-local]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_SITE, GALLERY_DIR, hoursCss, imageSize, LOGO_FILES, pageScript, readStrings, renderPage } from "../gallery/src/build.mjs";
import { readGallery, shownApps } from "../gallery/src/data.mjs";
import { legalSite } from "../packages/legal/src/build.mjs";
import { CODE, highlightCode, lucidePaths, renderHome, tilesCss } from "./src/home.mjs";
import { renderDocs } from "./src/docs.mjs";
import { renderPages } from "./src/pages.mjs";
import { sitePage } from "./src/render.mjs";

const SITE = "https://potyro.com";

const here = dirname(fileURLToPath(import.meta.url));
export const SITE_DIR = here;
const ROOT = resolve(here, "..");
const DESIGN = join(ROOT, "packages", "design");

/** The files a page names with a stamp of their bytes, and where a page names them. */
const STAMPED_FILE = /^\/(?:fonts|logo|shots|screens|media)\//;
const STAMPED_ATTR = /\b(href|src|poster)="(\/(?:fonts|logo|shots|screens|media)\/[^"?#]+)"/g;

/** @param {Buffer | string} bytes */
const shortHash = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 10);
/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/**
 * The site's words, checked, by language. English says everything; another language says what the
 * home says (the home's own render checks that none is missing) and no word English does not have:
 * the docs and the Learn-more pages are written in English only.
 * @param {unknown} raw
 */
export function readWords(raw) {
  const words = /** @type {Record<string, Record<string, string>>} */ (raw);
  const en = words?.en;
  if (!en || !Object.keys(en).length) throw new Error("site/words.json has no en");
  for (const [lang, said] of Object.entries(words)) {
    for (const [k, v] of Object.entries(said)) {
      if (typeof v !== "string" || !v.trim()) throw new Error(`site/words.json: ${lang} "${k}" is empty`);
      if (!(k in en)) throw new Error(`site/words.json: ${lang} has "${k}", which en does not`);
    }
  }
  return words;
}

/**
 * Build the site into `out` (emptied first).
 * @param {{ out?: string; allowLocal?: boolean; legal?: string }} [opts]
 */
export async function buildSite(opts = {}) {
  const out = resolve(opts.out ?? join(ROOT, "dist", "site"));
  const gallery = readGallery(readJson(join(GALLERY_DIR, "gallery.json")), { allowLocal: opts.allowLocal });
  const strings = readStrings(readJson(join(GALLERY_DIR, "strings.json")));
  const allWords = readWords(readJson(join(here, "words.json")));
  const words = allWords.en;

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  /** Every page written, by its address from the root: what the sitemap lists. @type {string[]} */
  const written = [];
  /**
   * A picture, a recording, a font or a logo, by the address it is served at → a hash of its bytes.
   * A page names each as `/media/x.webm?v=<hash>`, so the address changes when the file does and the
   * server can let a browser keep it for a year (deploy/potyro.app.Caddyfile); the bare address, which
   * a share card and an old link use, still answers, with a day.
   * @type {Map<string, string>}
   */
  const stamps = new Map();
  const stamped = (/** @type {string} */ html) => html.replace(STAMPED_ATTR, (whole, attr, path) => (stamps.has(path) ? `${attr}="${path}?v=${stamps.get(path)}"` : whole));
  const put = (/** @type {string} */ path, /** @type {Buffer | string} */ bytes) => {
    if (path === "index.html" || path.endsWith("/index.html")) written.push(`/${path.slice(0, -"index.html".length)}`);
    if (STAMPED_FILE.test(`/${path}`)) stamps.set(`/${path}`, shortHash(bytes));
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), path.endsWith(".html") ? stamped(String(bytes)) : bytes);
  };
  const copy = (/** @type {string} */ from, /** @type {string} */ to) => put(to, readFileSync(from));
  const copyDir = (/** @type {string} */ from, /** @type {string} */ to, /** @type {(name: string) => boolean} */ keep = () => true) => {
    for (const f of readdirSync(from)) if (keep(f) && statSync(join(from, f)).isFile()) copy(join(from, f), `${to}/${f}`);
  };

  // ---- the shared files ----
  // The fonts first: tokens.css names them, and names each with its stamp.
  copyDir(join(DESIGN, "fonts"), "fonts", (f) => f.endsWith(".woff2"));
  const tokens = Buffer.from(
    readFileSync(join(DESIGN, "tokens.css"), "utf8").replace(/url\("\.\/fonts\/([^"]+)"\)/g, (_, f) => {
      if (!stamps.has(`/fonts/${f}`)) throw new Error(`tokens.css names fonts/${f}, which packages/design/fonts does not have`);
      return `url("./fonts/${f}?v=${stamps.get(`/fonts/${f}`)}")`;
    }),
  );
  const hours = hoursCss();
  const chrome = readFileSync(join(GALLERY_DIR, "src", "page", "chrome.css"), "utf8");
  const galleryCss = chrome + "\n" + readFileSync(join(GALLERY_DIR, "src", "page", "gallery.css"), "utf8");
  const siteCss = chrome + "\n" + readFileSync(join(here, "src", "page", "home.css"), "utf8") + "\n/* the hero's tiles, placed */\n" + tilesCss();
  const textCss = chrome + "\n" + readFileSync(join(here, "src", "page", "text.css"), "utf8");
  // Each page loads one script: what every page shares (the language, the theme), the site's visit
  // count (#10, src/page/count.js: potyro.com's own, so the gallery built alone has none), then its own.
  const count = readFileSync(join(here, "src", "page", "count.js"));
  const counted = (/** @type {Buffer} */ own) => pageScript(Buffer.concat([count, Buffer.from("\n"), own]));
  const galleryJs = counted(readFileSync(join(GALLERY_DIR, "src", "page", "gallery.js")));
  const siteJs = counted(readFileSync(join(here, "src", "page", "site.js")));
  const textJs = counted(Buffer.from(""));
  put("tokens.css", tokens);
  put("hours.css", hours);
  put("gallery.css", galleryCss);
  put("site.css", siteCss);
  put("text.css", textCss);
  put("gallery.js", galleryJs);
  put("site.js", siteJs);
  put("text.js", textJs);
  copy(join(GALLERY_DIR, "src", "page", "favicon.svg"), "favicon.svg");
  for (const f of LOGO_FILES) copy(join(DESIGN, "logo", f), `logo/${f}`);
  const logos = Object.fromEntries(["wordmark-rosa.svg", "wordmark-large.svg", "tagline.svg", "symbol-rosa.svg"].map((f) => [f, readFileSync(join(DESIGN, "logo", f), "utf8")]));

  // ---- pictures: the gallery's shots, the home's screens, the recordings ----
  /** @type {Record<string, { width: number; height: number }>} */
  const sizes = {};
  const picture = (/** @type {string} */ from, /** @type {string} */ served) => {
    if (!existsSync(from)) throw new Error(`${served}: ${from} is missing`);
    const bytes = readFileSync(from);
    const size = imageSize(bytes);
    if (!size) throw new Error(`${served}: not a PNG or JPEG`);
    sizes[served] = size;
    put(served.replace(/^\//, ""), bytes);
  };
  const { published } = shownApps(gallery);
  for (const app of published) picture(join(GALLERY_DIR, app.screenshot ?? ""), `/${app.screenshot}`);
  for (const f of readdirSync(join(here, "shots"))) if (f.endsWith(".jpg")) picture(join(here, "shots", f), `/screens/${f}`);
  for (const f of readdirSync(join(here, "media"))) {
    if (/\.(jpg|png)$/.test(f)) picture(join(here, "media", f), `/media/${f}`);
    else copy(join(here, "media", f), `media/${f}`);
  }

  // ---- the legal pages, when their texts are ready ----
  const legal = legalSite({ dir: opts.legal, appHref: APP_SITE });
  for (const [path, body] of legal.files) put(path, body);

  // ---- the pages ----
  const v = { css: shortHash(Buffer.concat([tokens, Buffer.from(hours), Buffer.from(siteCss), Buffer.from(galleryCss), Buffer.from(textCss)])), js: shortHash(Buffer.concat([siteJs, galleryJs, textJs])) };
  const code = await highlightCode(CODE);
  const home = renderHome({ gallery, words: allWords, lucide: lucidePaths(DESIGN), code, logos, v, sizes, legal: legal.ready });
  put("index.html", home);
  /** @type {Record<string, { width: number; height: number }>} */
  const shots = Object.fromEntries(published.map((a) => [a.screenshot ?? "", sizes[`/${a.screenshot}`]]));
  const apps = renderPage(gallery, strings, { css: v.css, js: v.js, shots, logos: { "wordmark-large": logos["wordmark-large.svg"], tagline: logos["tagline.svg"] }, legal: legal.ready, base: "/" });
  put("apps/index.html", apps);

  // ---- the text pages: the docs, the Learn-more pages, /developers ----
  const docs = await renderDocs({ docsDir: join(ROOT, "docs"), w: words, logos, v, legal: legal.ready });
  for (const [path, body] of docs.files) put(path, body);
  const hoursOf = { data: "azul", database: "anil", make: "amarelo", together: "verde", ai: "roxo", share: "laranja", safe: "menta" };
  const pages = await renderPages({ siteDir: here, docsDir: join(ROOT, "docs"), w: words, logos, v, legal: legal.ready, hours: hoursOf });
  for (const [path, body] of pages.files) put(path, body);

  // ---- for crawlers and for a mistyped address ----
  // The server answers an unknown address with 404.html and the 404 status (deploy/potyro.app.Caddyfile).
  const lost = `<div class="layout one"><article class="how"><header class="head"><h1>${words.notFoundTitle}</h1><p class="lede">${words.notFoundText}</p></header><p><a href="/">${words.notFoundHome}</a> · <a href="/apps/">${words.notFoundApps}</a></p></article></div>`;
  writeFileSync(join(out, "404.html"), stamped(sitePage({ title: words.notFoundTitle, description: words.notFoundText, path: "/404.html", main: lost, current: "", styles: [], v, logos, w: words, legal: legal.ready })));
  const listed = [...new Set(written)].sort();
  put("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${listed.map((path) => `  <url><loc>${SITE}${path}</loc></url>`).join("\n")}\n</urlset>\n`);
  put("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

  return { out, apps: published.length, docs: docs.entries.length, pages: pages.pages.length, legal: legal.ready ? null : legal.notice };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const take = (/** @type {string} */ flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const cwd = process.env.INIT_CWD ?? process.cwd();
  try {
    const done = await buildSite({ out: take("--out") ? resolve(cwd, /** @type {string} */ (take("--out"))) : undefined, allowLocal: args.includes("--allow-local") });
    console.log(`site: the home, ${done.apps} apps at /apps/, ${done.docs} docs, ${done.pages} pages → ${done.out}`);
    if (done.legal) console.log(done.legal);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
