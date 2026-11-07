// The privacy page and the terms of use (#117), as static pages: docs/legal/privacy.md and terms.md
// on the design system's tokens and fonts, with one small stylesheet and no script, so they load
// with JavaScript off and stay readable when the app does not start (docs/legal/README.md).
//
// The gate. A text that still has a placeholder (`<CONTACT EMAIL>`, `<DATE>` …), an open point in
// words ("to confirm", "to decide", "to verify"), no `Effective: YYYY-MM-DD` line, or still calls
// itself a draft is not in force, so nothing is built from it: `legalSite()` answers `ready: false` with a
// one-line notice, the builds emit no page, and the app and the gallery show no link to one. When
// the owner fills the texts in, the next build has the pages and the links, with nothing else to
// change. Read by packages/shell (vite.mjs) and gallery/src/build.mjs.
//
// What is emitted, relative to the site's root:
//   privacy/index.html, terms/index.html   a folder's page: what a plain file server serves at /privacy
//   privacy.html, terms.html               the same page: what Vite's servers (and `try_files {path}.html`) serve at /privacy
//   legal/legal.<hash>.css, legal/tokens.<hash>.css, legal/fonts/<font>.<hash>.woff2, legal/<logo>.<hash>.svg
//                                          named by their bytes, so a cache-first service worker never keeps an old one
// Every path in a page starts with `../`, which from /privacy and from /privacy/ alike is the root.
// "Open Potyro" goes to `appHref`: `../` on potyro.app, the app's own site beside the gallery.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml, renderMarkdown, stripComments } from "./markdown.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..", "..", "..");
const DESIGN = join(ROOT, "packages", "design");

/** Where the texts are: the repository's, unless `POTYRO_LEGAL_DIR` names another folder (the browser test's filled-in copies). */
export const LEGAL_DIR = join(ROOT, "docs", "legal");

/** The pages, by the path they are served at. */
export const PAGES = /** @type {const} */ (["privacy", "terms"]);

/** Where the texts' other links go: the repository, for the notes the drafts point at (README.md, facts.md). */
export const REPOSITORY = "https://github.com/potyro-app/potyro/blob/main/docs/legal/";

/** The logo files a page shows, light and dark grounds (packages/design/logo). */
const LOGOS = /** @type {const} */ (["wordmark-rosa.svg", "wordmark-rosa-on-dark.svg"]);
/** The tab's icon: the symbol on its dark circle, the shell's and the gallery's favicon too. */
const FAVICON = "symbol-circle-dark.svg";

/** Words a draft uses for a point still open. Outside the review notes they are on the page, so the gate stops them. */
const OPEN_POINT = /\bto (?:confirm|decide|verify)\b/gi;

/** The date a text takes effect, on a line of its own: `Effective: 2026-11-01`. */
const EFFECTIVE = /^Effective:[ \t]*(\d{4}-\d{2}-\d{2})[ \t]*$/m;

/** @param {string} day `YYYY-MM-DD` */
const isRealDay = (day) => {
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
};

/**
 * What still waits for the owner in one text, all outside the review notes and outside code: its
 * placeholders, `<LIKE THIS>`; an open point written as words ("to confirm", "to decide", "to
 * verify"); whether it still says it is a draft; and the date it takes effect, from its
 * `Effective: YYYY-MM-DD` line (null when there is none, or its date is not a day).
 * `effectivePending` says the line is there but still holds a placeholder.
 * @param {string} md
 * @returns {{ placeholders: string[]; openPoints: string[]; draft: boolean; effective: string | null; effectivePending: boolean }}
 */
export function unfinished(md) {
  const text = stripComments(md).replace(/`[^`\n]*`/g, "");
  const placeholders = [...new Set(text.match(/<[A-Z][^<>\n]*>/g) ?? [])];
  // A placeholder's own words (`<RETENTION, to decide>`) are already named as the placeholder.
  const words = text.replace(/<[A-Z][^<>\n]*>/g, "");
  const openPoints = [...new Set((words.match(OPEN_POINT) ?? []).map((w) => w.toLowerCase()))];
  const draft = /^>\s*\*\*Draft\.\*\*/m.test(text);
  const day = EFFECTIVE.exec(text)?.[1];
  const effective = day && isRealDay(day) ? day : null;
  const effectivePending = /^Effective:[^\n]*<[A-Z][^<>\n]*>/m.test(text);
  return { placeholders, openPoints, draft, effective, effectivePending };
}

/**
 * Whether the pages can be built from the texts in `dir`, and if not, the one line that says why.
 * @param {string} [dir]
 * @returns {{ ready: true; texts: Record<"privacy" | "terms", string> } | { ready: false; notice: string }}
 */
export function readLegal(dir = process.env.POTYRO_LEGAL_DIR || LEGAL_DIR) {
  /** @type {Record<string, string>} */
  const texts = {};
  const problems = [];
  for (const page of PAGES) {
    let md;
    try {
      md = readFileSync(join(dir, `${page}.md`), "utf8");
    } catch {
      problems.push(`${page}.md is missing`);
      continue;
    }
    const left = unfinished(md);
    if (left.placeholders.length) problems.push(`${page}.md still has ${left.placeholders.join(", ")}`);
    if (left.openPoints.length) problems.push(`${page}.md still says ${left.openPoints.map((w) => `"${w}"`).join(", ")}`);
    if (left.draft) problems.push(`${page}.md still says it is a draft`);
    if (!left.effective && !left.effectivePending) problems.push(`${page}.md has no "Effective: YYYY-MM-DD" line`);
    texts[page] = md;
  }
  if (problems.length) return { ready: false, notice: `legal: /privacy and /terms not built: ${problems.join("; ")} (docs/legal/README.md).` };
  return { ready: true, texts: /** @type {Record<"privacy" | "terms", string>} */ (texts) };
}

/** @param {Buffer | string} bytes */
const shortHash = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 10);

/**
 * Where a link in a text goes on the site: the other page, an anchor on it, or the repository for
 * the review files the drafts mention.
 * @param {string} href
 */
export function siteLink(href) {
  const m = /^(privacy|terms)\.md(#.*)?$/.exec(href);
  if (m) return `../${m[1]}${m[2] ?? ""}`;
  if (/^[\w.-]+\.md(#.*)?$/.test(href)) return `${REPOSITORY}${href}`;
  return href;
}

/**
 * The files a page refers to, by the path each is served at (from the site's root). Each name holds
 * a hash of its bytes, so a service worker that serves them cache-first gets the new file when the
 * design system changes one (packages/shell/public/sw.js keeps a fetched file until its CACHE name
 * changes).
 * @typedef {{ tokens: string; css: string; favicon: string; wordmark: string; wordmarkDark: string }} LegalAssets
 */

/**
 * One page, as HTML. Pure.
 * @param {"privacy" | "terms"} page
 * @param {string} md
 * @param {{ assets: LegalAssets; appHref?: string }} opts
 *   `appHref`: where "Open Potyro" and the logo go — the app. `../` (the default) is the app on
 *   potyro.app; beside the gallery on potyro.com it is the app's own site.
 */
export function renderLegalPage(page, md, opts) {
  const { html, headings } = renderMarkdown(md, { link: siteLink });
  const title = headings.find((h) => h.level === 1)?.text ?? (page === "privacy" ? "Privacy" : "Terms of use");
  const e = escapeHtml;
  const app = e(opts.appHref ?? "../");
  const at = (/** @type {string} */ path) => `../${e(path)}`;
  const { assets } = opts;
  const nav = (/** @type {"privacy" | "terms"} */ p, /** @type {string} */ label) => `<a href="../${p}"${p === page ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${e(title)} · Potyro</title>
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#1c1b1c" media="(prefers-color-scheme: dark)" />
  <meta name="referrer" content="no-referrer" />
  <link rel="icon" href="${at(assets.favicon)}" type="image/svg+xml" />
  <link rel="stylesheet" href="${at(assets.tokens)}" />
  <link rel="stylesheet" href="${at(assets.css)}" />
</head>
<body data-legal="${page}">
  <a class="skip" href="#text">Skip to the text</a>
  <header class="top">
    <a class="brand" href="${app}"><span class="wordmark" role="img" aria-label="Potyro"><img class="wordmark-light" src="${at(assets.wordmark)}" alt="" width="133" height="50" /><img class="wordmark-dark" src="${at(assets.wordmarkDark)}" alt="" width="133" height="50" /></span></a>
    <nav class="pages" aria-label="Potyro's terms">${nav("privacy", "Privacy")}${nav("terms", "Terms of use")}</nav>
  </header>
  <main class="text" id="text" tabindex="-1">
${html}
  </main>
  <footer class="foot">
    <nav aria-label="Potyro">${nav("privacy", "Privacy")}${nav("terms", "Terms of use")}<a href="${app}">Open Potyro</a></nav>
  </footer>
</body>
</html>
`;
}

/**
 * `legal/<name>.<hash>.<ext>`, the path a file is served at.
 * @param {string} folder
 * @param {string} name
 * @param {Buffer | string} bytes
 */
const hashedPath = (folder, name, bytes) => {
  const dot = name.lastIndexOf(".");
  return `${folder}/${name.slice(0, dot)}.${shortHash(bytes)}${name.slice(dot)}`;
};

/**
 * Every file the pages need, by the path it is served at — or, when the texts are not ready, none,
 * and the notice to print instead.
 * @param {{ dir?: string; appHref?: string }} [opts]  `appHref`: see renderLegalPage
 * @returns {{ ready: true; files: Map<string, string | Buffer> } | { ready: false; notice: string; files: Map<string, string | Buffer> }}
 */
export function legalSite(opts = {}) {
  const read = readLegal(opts.dir);
  /** @type {Map<string, string | Buffer>} */
  const files = new Map();
  if (!read.ready) return { ready: false, notice: read.notice, files };
  const put = (/** @type {string} */ folder, /** @type {string} */ name, /** @type {Buffer | string} */ bytes) => {
    const path = hashedPath(folder, name, bytes);
    files.set(path, bytes);
    return path;
  };
  // The fonts first: tokens.css names them, so it is rewritten to their hashed names, then hashed itself.
  /** @type {Record<string, string>} */
  const fonts = {};
  for (const f of readdirSync(join(DESIGN, "fonts"))) {
    if (f.endsWith(".woff2")) fonts[f] = put("legal/fonts", f, readFileSync(join(DESIGN, "fonts", f))).slice("legal/fonts/".length);
  }
  const tokens = readFileSync(join(DESIGN, "tokens.css"), "utf8").replace(/url\("\.\/fonts\/([^"]+)"\)/g, (_, f) => {
    if (!fonts[f]) throw new Error(`legal: tokens.css names fonts/${f}, which packages/design/fonts does not have`);
    return `url("./fonts/${fonts[f]}")`;
  });
  const logo = (/** @type {string} */ f) => readFileSync(join(DESIGN, "logo", f));
  /** @type {LegalAssets} */
  const assets = {
    tokens: put("legal", "tokens.css", tokens),
    css: put("legal", "legal.css", readFileSync(join(here, "page", "legal.css"))),
    favicon: put("legal", "favicon.svg", logo(FAVICON)),
    wordmark: put("legal", LOGOS[0], logo(LOGOS[0])),
    wordmarkDark: put("legal", LOGOS[1], logo(LOGOS[1])),
  };
  for (const page of PAGES) {
    const html = renderLegalPage(page, read.texts[page], { assets, appHref: opts.appHref });
    files.set(`${page}/index.html`, html);
    files.set(`${page}.html`, html);
  }
  return { ready: true, files };
}
