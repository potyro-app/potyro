#!/usr/bin/env node
// `pnpm site:build` — potyro.com as one static folder (#32): the home (site/src/home.mjs) at /, the
// gallery (gallery/src/build.mjs) at /apps/, the privacy page and the terms (packages/legal) when their
// texts are ready, and every file they need beside them: the design system's tokens and fonts, the
// colour clock (hours.css), the logo, the apps' screenshots, the recordings. Nothing from anyone else;
// no inline style, no inline script (deploy/potyro.app.Caddyfile). Deployed by rsync (docs/16).
//
//   pnpm site:build [--out dist/site] [--allow-local]
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_SITE, GALLERY_DIR, hoursCss, imageSize, LOGO_FILES, readStrings, renderPage } from "../gallery/src/build.mjs";
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

/** @param {Buffer | string} bytes */
const shortHash = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 10);
/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** The home's words, checked: every key that the English has, and only English for now. @param {unknown} raw */
export function readWords(raw) {
  const words = /** @type {Record<string, Record<string, string>>} */ (raw);
  const en = words?.en;
  if (!en || !Object.keys(en).length) throw new Error("site/words.json has no en");
  for (const [k, v] of Object.entries(en)) if (typeof v !== "string" || !v.trim()) throw new Error(`site/words.json: en "${k}" is empty`);
  return en;
}

/**
 * Build the site into `out` (emptied first).
 * @param {{ out?: string; allowLocal?: boolean; legal?: string }} [opts]
 */
export async function buildSite(opts = {}) {
  const out = resolve(opts.out ?? join(ROOT, "dist", "site"));
  const gallery = readGallery(readJson(join(GALLERY_DIR, "gallery.json")), { allowLocal: opts.allowLocal });
  const strings = readStrings(readJson(join(GALLERY_DIR, "strings.json")));
  const words = readWords(readJson(join(here, "words.json")));

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  /** Every page written, by its address from the root: what the sitemap lists. @type {string[]} */
  const written = [];
  const put = (/** @type {string} */ path, /** @type {Buffer | string} */ bytes) => {
    if (path === "index.html" || path.endsWith("/index.html")) written.push(`/${path.slice(0, -"index.html".length)}`);
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), bytes);
  };
  const copyDir = (/** @type {string} */ from, /** @type {string} */ to, /** @type {(name: string) => boolean} */ keep = () => true) => {
    mkdirSync(join(out, to), { recursive: true });
    for (const f of readdirSync(from)) if (keep(f) && statSync(join(from, f)).isFile()) copyFileSync(join(from, f), join(out, to, f));
  };

  // ---- the shared files ----
  const tokens = readFileSync(join(DESIGN, "tokens.css"));
  const hours = hoursCss();
  const chrome = readFileSync(join(GALLERY_DIR, "src", "page", "chrome.css"), "utf8");
  const galleryCss = chrome + "\n" + readFileSync(join(GALLERY_DIR, "src", "page", "gallery.css"), "utf8");
  const siteCss = chrome + "\n" + readFileSync(join(here, "src", "page", "home.css"), "utf8") + "\n/* the hero's tiles, placed */\n" + tilesCss();
  const textCss = chrome + "\n" + readFileSync(join(here, "src", "page", "text.css"), "utf8");
  const galleryJs = readFileSync(join(GALLERY_DIR, "src", "page", "gallery.js"));
  const siteJs = readFileSync(join(here, "src", "page", "site.js"));
  put("tokens.css", tokens);
  put("hours.css", hours);
  put("gallery.css", galleryCss);
  put("site.css", siteCss);
  put("text.css", textCss);
  put("gallery.js", galleryJs);
  put("site.js", siteJs);
  copyFileSync(join(GALLERY_DIR, "src", "page", "favicon.svg"), join(out, "favicon.svg"));
  copyDir(join(DESIGN, "fonts"), "fonts", (f) => f.endsWith(".woff2"));
  mkdirSync(join(out, "logo"), { recursive: true });
  for (const f of LOGO_FILES) copyFileSync(join(DESIGN, "logo", f), join(out, "logo", f));
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
  mkdirSync(join(out, "media"), { recursive: true });
  for (const f of readdirSync(join(here, "media"))) {
    if (/\.(jpg|png)$/.test(f)) picture(join(here, "media", f), `/media/${f}`);
    else copyFileSync(join(here, "media", f), join(out, "media", f));
  }

  // ---- the legal pages, when their texts are ready ----
  const legal = legalSite({ dir: opts.legal, appHref: APP_SITE });
  for (const [path, body] of legal.files) put(path, body);

  // ---- the pages ----
  const v = { css: shortHash(Buffer.concat([tokens, Buffer.from(hours), Buffer.from(siteCss), Buffer.from(galleryCss), Buffer.from(textCss)])), js: shortHash(Buffer.concat([siteJs, galleryJs])) };
  const code = await highlightCode(CODE);
  const home = renderHome({ gallery, words, lucide: lucidePaths(DESIGN), code, logos, v, sizes, legal: legal.ready });
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
  writeFileSync(join(out, "404.html"), sitePage({ title: words.notFoundTitle, description: words.notFoundText, path: "/404.html", main: lost, current: "", styles: [], v, logos, w: words, legal: legal.ready }));
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
