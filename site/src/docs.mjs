// The documentation at /docs (#32): the pages under docs/<section>/, in five sections (start,
// concepts, guides, reference, contributing), as pages in the site's chrome. An index from the
// frontmatter (title, description, section, order), a sidebar of every page by section, previous
// and next, "On this page" from the headings. The numbered notes (docs/NN-*.md) and the ADRs are the
// engineering record and are not published; relative links to them, or to any other file of the
// repository, go to GitHub.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { escapeHtml as e } from "../../gallery/src/build.mjs";
import { drawDiagrams, frontmatter, markdown, REPO_URL, sitePage, tocHtml } from "./render.mjs";

/** The sections, in reading order; the label of each is a word of words.json (docsSection<Id>). */
export const SECTIONS = /** @type {const} */ ([
  { id: "start", word: "docsSectionStart" },
  { id: "concepts", word: "docsSectionConcepts" },
  { id: "guides", word: "docsSectionGuides" },
  { id: "reference", word: "docsSectionReference" },
  { id: "contributing", word: "docsSectionContributing" },
]);

/**
 * @typedef {{ file: string; url: string; title: string; description: string; section: string; order: number }} DocEntry
 */

/** The page a doc file is served at. `file` is the path under docs/, posix. @param {string} file */
export function docUrl(file) {
  if (file === "README.md") return "/docs/";
  return `/docs/${file.replace(/\.md$/, "")}/`;
}

/**
 * Every page the docs layer has, in reading order: section by section, then by `order`.
 * @param {string} docsDir
 * @returns {DocEntry[]}
 */
export function collectDocs(docsDir) {
  /** @type {DocEntry[]} */
  const out = [];
  for (const { id } of SECTIONS) {
    const dir = join(docsDir, id);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
      const file = `${id}/${name}`;
      const { meta, has } = frontmatter(readFileSync(join(dir, name), "utf8"));
      if (!has || !meta.title || !meta.description || meta.section !== id || meta.order === undefined) {
        throw new Error(`docs/${file} needs frontmatter with title, description, section: ${id} and order (pnpm lint:docs)`);
      }
      out.push({ file, url: docUrl(file), title: meta.title, description: meta.description, section: id, order: Number(meta.order) });
    }
  }
  /** @type {Map<string, number>} */
  const rank = new Map(SECTIONS.map((s, i) => [String(s.id), i]));
  return out.sort((a, b) => (rank.get(a.section) ?? 0) - (rank.get(b.section) ?? 0) || a.order - b.order || a.file.localeCompare(b.file));
}

/**
 * Where a link written in a doc goes on the site: another doc's page (with its anchor), a legal
 * page, or the repository for anything else in the tree.
 * @param {string} href @param {string} fromFile  the doc's path under docs/ @param {Set<string>} known  doc files under docs/
 */
export function resolveDocLink(href, fromFile, known) {
  // Absolute (a scheme, protocol-relative, or the site's own root), or an anchor: as it is.
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(href)) return href;
  const [path, hash = ""] = href.split("#");
  const anchor = hash ? `#${hash}` : "";
  if (!path) return href;
  const target = posix.normalize(posix.join("docs", posix.dirname(fromFile), path));
  if (target.startsWith("docs/")) {
    const inDocs = target.slice(5);
    if (known.has(inDocs)) return docUrl(inDocs) + anchor;
    if (inDocs === "legal/privacy.md") return "/privacy/";
    if (inDocs === "legal/terms.md") return "/terms/";
  }
  if (target.startsWith("../")) return href;
  const dir = path.endsWith("/");
  return `${REPO_URL}/${dir ? "tree" : "blob"}/main/${target}${anchor}`;
}

/**
 * Render the docs layer. Returns the files to write, by path from the root.
 * @param {object} input
 * @param {string} input.docsDir
 * @param {Record<string, string>} input.w
 * @param {Record<string, string>} input.logos
 * @param {{ css: string; js: string }} input.v
 * @param {boolean} input.legal
 * @returns {Promise<{ files: Map<string, string>; entries: DocEntry[] }>}
 */
export async function renderDocs({ docsDir, w, logos, v, legal }) {
  const entries = collectDocs(docsDir);
  const known = new Set(entries.map((d) => d.file));
  /** @type {Map<string, string>} */
  const files = new Map();
  /** @type {{ id: string; def: string }[]} */
  const diagrams = [];
  /** @type {{ entry: DocEntry; html: string; toc: { level: string; id: string; text: string }[]; ids: string[] }[]} */
  const rendered = [];

  for (const entry of entries) {
    const md = markdown({ link: (href) => resolveDocLink(href, entry.file, known) });
    const { body } = frontmatter(readFileSync(join(docsDir, entry.file), "utf8"));
    const h1 = /^# (.+)$/m.exec(body);
    const content = h1 ? body.replace(h1[0], "") : body;
    const { html, toc, diagrams: defs } = await md.render(content);
    const slug = entry.url.replace(/^\/docs\/|\/$/g, "").replace(/\//g, "-") || "index";
    const ids = defs.map((def, i) => { const id = `d-${slug}-${i}`; diagrams.push({ id, def }); return id; });
    rendered.push({ entry, html, toc, ids });
  }
  const drawn = await drawDiagrams(diagrams);
  const svgById = new Map(diagrams.map((d, i) => [d.id, drawn[i]]));

  const side = (/** @type {DocEntry | null} */ current) => {
    const group = (/** @type {(typeof SECTIONS)[number]} */ s) => {
      const items = entries.filter((d) => d.section === s.id);
      if (!items.length) return "";
      return `<li><p class="eyebrow">${e(w[s.word])}</p><ol>${items.map((d) => `<li><a href="${d.url}"${current && d.url === current.url ? ' aria-current="page"' : ""}>${e(d.title)}</a></li>`).join("")}</ol></li>`;
    };
    return `<nav class="pages" aria-label="${e(w.docsAll)}"><p class="eyebrow">${e(w.docsAll)}</p><ol class="groups">${SECTIONS.map(group).join("")}</ol></nav>`;
  };

  for (const [i, r] of rendered.entries()) {
    let html = r.html.replace(/<!--mermaid:(\d+)-->/g, (_, n) => `<figure class="diagram">${svgById.get(r.ids[Number(n)])?.svg ?? ""}</figure>`);
    const css = r.ids.map((id) => svgById.get(id)?.css ?? "").filter(Boolean).join("\n");
    const styles = [];
    if (css) {
      const path = `${r.entry.url.slice(1)}diagrams.css`;
      files.set(path, css + "\n");
      styles.push(`/${path}`);
    }
    const prev = rendered[i - 1]?.entry;
    const next = rendered[i + 1]?.entry;
    const main = `
<div class="layout">
  <aside class="side">${tocHtml(r.toc, w.docsOnThisPage)}${side(r.entry)}</aside>
  <article>
    <p class="eyebrow">${e(w[SECTIONS.find((s) => s.id === r.entry.section)?.word ?? "docs"])}</p>
    <h1>${e(r.entry.title)}</h1>
    ${r.entry.description ? `<p class="lede">${e(r.entry.description)}</p>` : ""}
    ${html}
    <nav class="pager" aria-label="${e(w.docsAll)}">${prev ? `<a class="prev" href="${prev.url}"><span>${e(w.docsPrevious)}</span>${e(prev.title)}</a>` : "<span></span>"}${next ? `<a class="next" href="${next.url}"><span>${e(w.docsNext)}</span>${e(next.title)}</a>` : ""}</nav>
    <p class="source"><a href="${REPO_URL}/blob/main/docs/${e(r.entry.file)}">${e(w.docsSource)}</a></p>
  </article>
</div>`;
    files.set(`${r.entry.url.slice(1)}index.html`, sitePage({ title: r.entry.title, description: r.entry.description || w.docsDescription, path: r.entry.url, main, current: "docs", styles, v, logos, w, legal }));
  }

  // The index: every page, by section.
  const list = (/** @type {(typeof SECTIONS)[number]} */ sec) => {
    const items = entries.filter((d) => d.section === sec.id);
    if (!items.length) return "";
    return `<section aria-labelledby="g-${sec.id}"><h2 id="g-${sec.id}">${e(w[sec.word])}</h2><ul class="doc-list">${items.map((d) => `<li><a href="${d.url}">${e(d.title)}</a>${d.description ? `<span>${e(d.description)}</span>` : ""}</li>`).join("")}</ul></section>`;
  };
  const start = entries[0];
  const indexMain = `
<div class="layout one">
  <article>
    <p class="eyebrow">${e(w.docs)}</p>
    <h1>${e(w.docsTitle)}</h1>
    <p class="lede">${e(w.docsLead)}${start ? ` <a href="${start.url}">${e(start.title)}</a>.` : ""}</p>
    ${SECTIONS.map(list).join("\n    ")}
  </article>
</div>`;
  files.set("docs/index.html", sitePage({ title: w.docsTitle, description: w.docsDescription, path: "/docs/", main: indexMain, current: "docs", styles: [], v, logos, w, legal }));
  return { files, entries };
}
