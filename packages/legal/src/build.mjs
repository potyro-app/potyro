// The privacy page and the terms of use (#117), as static pages: docs/legal/privacy.md and terms.md
// on the design system's tokens and fonts, with one small stylesheet and no script, so they load
// with JavaScript off and stay readable when the app does not start (docs/legal/README.md).
//
// The gate. A text that still has a placeholder (`<CONTACT EMAIL>`, `<DATE>` …) or still calls itself
// a draft is not in force, so nothing is built from it: `legalSite()` answers `ready: false` with a
// one-line notice, the builds emit no page, and the app and the gallery show no link to one. When
// the owner fills the texts in, the next build has the pages and the links, with nothing else to
// change. Read by packages/shell (vite.mjs) and gallery/src/build.mjs.
//
// What is emitted, relative to the site's root:
//   privacy/index.html, terms/index.html   a folder's page: what a plain file server serves at /privacy
//   privacy.html, terms.html               the same page: what Vite's servers (and `try_files {path}.html`) serve at /privacy
//   legal/legal.css, legal/tokens.css, legal/fonts/*, legal/*.svg
// Every path in a page starts with `../`, which from /privacy and from /privacy/ alike is the root.

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
export const REPOSITORY = "https://github.com/fuzue/appinator/blob/main/docs/legal/";

/** The logo files a page shows, light and dark grounds (packages/design/logo). */
const LOGOS = ["wordmark-rosa.svg", "wordmark-rosa-on-dark.svg"];
/** The tab's icon: the symbol on its dark circle, the shell's and the gallery's favicon too. */
const FAVICON = "symbol-circle-dark.svg";

/**
 * What still waits for the owner in one text: its placeholders, `<LIKE THIS>`, outside the review
 * notes and outside code, and whether it still says it is a draft.
 * @param {string} md
 * @returns {{ placeholders: string[]; draft: boolean }}
 */
export function unfinished(md) {
  const text = stripComments(md).replace(/`[^`\n]*`/g, "");
  const placeholders = [...new Set(text.match(/<[A-Z][^<>\n]*>/g) ?? [])];
  const draft = /^>\s*\*\*Draft\.\*\*/m.test(text);
  return { placeholders, draft };
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
    if (left.draft) problems.push(`${page}.md still says it is a draft`);
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
 * One page, as HTML. Pure.
 * @param {"privacy" | "terms"} page
 * @param {string} md
 * @param {{ css: string }} version  the stylesheets' hash, so a service worker that serves them cache-first sees a new one
 */
export function renderLegalPage(page, md, version) {
  const { html, headings } = renderMarkdown(md, { link: siteLink });
  const title = headings.find((h) => h.level === 1)?.text ?? (page === "privacy" ? "Privacy" : "Terms of use");
  const e = escapeHtml;
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
  <link rel="icon" href="../legal/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="../legal/tokens.css?v=${version.css}" />
  <link rel="stylesheet" href="../legal/legal.css?v=${version.css}" />
</head>
<body data-legal="${page}">
  <a class="skip" href="#text">Skip to the text</a>
  <header class="top">
    <a class="brand" href="../"><span class="wordmark" role="img" aria-label="Potyro"><img class="wordmark-light" src="../legal/wordmark-rosa.svg" alt="" width="133" height="50" /><img class="wordmark-dark" src="../legal/wordmark-rosa-on-dark.svg" alt="" width="133" height="50" /></span></a>
    <nav class="pages" aria-label="Potyro's terms">${nav("privacy", "Privacy")}${nav("terms", "Terms of use")}</nav>
  </header>
  <main class="text" id="text" tabindex="-1">
${html}
  </main>
  <footer class="foot">
    <nav aria-label="Potyro">${nav("privacy", "Privacy")}${nav("terms", "Terms of use")}<a href="../">Open Potyro</a></nav>
  </footer>
</body>
</html>
`;
}

/**
 * Every file the pages need, by the path it is served at — or, when the texts are not ready, none,
 * and the notice to print instead.
 * @param {{ dir?: string }} [opts]
 * @returns {{ ready: true; files: Map<string, string | Buffer> } | { ready: false; notice: string; files: Map<string, string | Buffer> }}
 */
export function legalSite(opts = {}) {
  const read = readLegal(opts.dir);
  /** @type {Map<string, string | Buffer>} */
  const files = new Map();
  if (!read.ready) return { ready: false, notice: read.notice, files };
  const tokens = readFileSync(join(DESIGN, "tokens.css"));
  const css = readFileSync(join(here, "page", "legal.css"));
  const version = { css: shortHash(Buffer.concat([tokens, css])) };
  files.set("legal/tokens.css", tokens);
  files.set("legal/legal.css", css);
  files.set("legal/favicon.svg", readFileSync(join(DESIGN, "logo", FAVICON)));
  for (const f of LOGOS) files.set(`legal/${f}`, readFileSync(join(DESIGN, "logo", f)));
  for (const f of readdirSync(join(DESIGN, "fonts"))) if (f.endsWith(".woff2")) files.set(`legal/fonts/${f}`, readFileSync(join(DESIGN, "fonts", f)));
  for (const page of PAGES) {
    const html = renderLegalPage(page, read.texts[page], version);
    files.set(`${page}/index.html`, html);
    files.set(`${page}.html`, html);
  }
  return { ready: true, files };
}
