// The documentation at /docs (#32): every doc of docs/ with frontmatter, the ADRs and the tutorials,
// as pages in the site's chrome. An index from the frontmatter (title, description, status, order),
// a sidebar of every page, previous and next, a banner on a historical doc, "On this page" from the
// headings. The docs name each other as "docs/22 §6" in prose and by relative .md links; both become
// links here, at build time, so the repository text stays as it is written.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { escapeHtml as e } from "../../gallery/src/build.mjs";
import { drawDiagrams, frontmatter, markdown, REPO_URL, sitePage, tocHtml } from "./render.mjs";

/**
 * @typedef {{ file: string; url: string; title: string; description: string; status: string; order: number; group: "current" | "historical" | "tutorials" | "adr" }} DocEntry
 */

/** The page a doc file is served at. `file` is the path under docs/, posix. @param {string} file */
export function docUrl(file) {
  if (file === "README.md") return "/docs/";
  if (file === "tutorials/README.md") return "/docs/tutorials/";
  return `/docs/${file.replace(/\.md$/, "")}/`;
}

/** The title and the first paragraph of a doc without frontmatter (the tutorials). @param {string} body */
function titleAndLead(body) {
  const h1 = /^# (.+)$/m.exec(body);
  const after = h1 ? body.slice(h1.index + h1[0].length) : body;
  const para = after.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith("#") && !p.startsWith("```") && !p.startsWith("|") && !p.startsWith("<"));
  const lead = (para ?? "").replace(/\s+/g, " ").replace(/\*\*|`|\[([^\]]*)\]\([^)]*\)/g, "$1").slice(0, 200);
  return { title: h1?.[1] ?? "", lead };
}

/**
 * Every page the docs layer has, in reading order per group.
 * @param {string} docsDir
 * @returns {DocEntry[]}
 */
export function collectDocs(docsDir) {
  /** @type {DocEntry[]} */
  const out = [];
  const read = (/** @type {string} */ file) => frontmatter(readFileSync(join(docsDir, file), "utf8"));
  for (const name of readdirSync(docsDir).filter((n) => /^\d\d-.*\.md$/.test(n)).sort()) {
    const { meta, has } = read(name);
    if (!has || !meta.title || !meta.status) throw new Error(`docs/${name} has no frontmatter with title and status (pnpm lint:docs)`);
    if (meta.audience === "owner") continue;
    out.push({ file: name, url: docUrl(name), title: meta.title, description: meta.description ?? "", status: meta.status, order: meta.order === undefined ? Infinity : Number(meta.order), group: meta.status === "current" ? "current" : "historical" });
  }
  if (existsSync(join(docsDir, "adr"))) {
    for (const name of readdirSync(join(docsDir, "adr")).filter((n) => n.endsWith(".md")).sort()) {
      const { meta, body } = read(`adr/${name}`);
      const { title, lead } = titleAndLead(body);
      out.push({ file: `adr/${name}`, url: docUrl(`adr/${name}`), title: meta.title ?? title, description: meta.description ?? lead, status: meta.status ?? "historical", order: Infinity, group: "adr" });
    }
  }
  if (existsSync(join(docsDir, "tutorials"))) {
    const names = readdirSync(join(docsDir, "tutorials")).filter((n) => n.endsWith(".md")).sort((a, b) => (a === "README.md" ? -1 : b === "README.md" ? 1 : a.localeCompare(b)));
    for (const name of names) {
      const { meta, body } = read(`tutorials/${name}`);
      const { title, lead } = titleAndLead(body);
      out.push({ file: `tutorials/${name}`, url: docUrl(`tutorials/${name}`), title: meta.title ?? title, description: meta.description ?? lead, status: "current", order: Infinity, group: "tutorials" });
    }
  }
  const current = out.filter((d) => d.group === "current").sort((a, b) => a.order - b.order || a.file.localeCompare(b.file));
  const rest = out.filter((d) => d.group !== "current");
  return [...current, ...rest.filter((d) => d.group === "tutorials"), ...rest.filter((d) => d.group === "historical"), ...rest.filter((d) => d.group === "adr")];
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
  const byNumber = new Map(entries.filter((d) => /^\d\d-/.test(d.file)).map((d) => [d.file.slice(0, 2), d]));
  /** @type {Map<string, string>} */
  const files = new Map();
  /** @type {{ id: string; def: string }[]} */
  const diagrams = [];
  /** @type {{ entry: DocEntry; html: string; toc: { level: string; id: string; text: string }[]; ids: string[] }[]} */
  const rendered = [];

  for (const entry of entries) {
    const md = markdown({ link: (href) => resolveDocLink(href, entry.file, known) });
    const { body } = frontmatter(readFileSync(join(docsDir, entry.file), "utf8"));
    // "docs/22 §6" in prose becomes a link to that page.
    const linked = body.replace(/(^|[^\w/`[])docs\/(\d\d)\b( §[\d.]+)?/g, (m, before, n, sec) => {
      const target = byNumber.get(n);
      return target ? `${before}[docs/${n}${sec ?? ""}](${target.url})` : m;
    });
    const h1 = /^# (.+)$/m.exec(linked);
    const content = h1 ? linked.replace(h1[0], "") : linked;
    const { html, toc, diagrams: defs } = await md.render(content);
    const slug = entry.url.replace(/^\/docs\/|\/$/g, "").replace(/\//g, "-") || "index";
    const ids = defs.map((def, i) => { const id = `d-${slug}-${i}`; diagrams.push({ id, def }); return id; });
    rendered.push({ entry, html, toc, ids });
  }
  const drawn = await drawDiagrams(diagrams);
  const svgById = new Map(diagrams.map((d, i) => [d.id, drawn[i]]));

  const side = (/** @type {DocEntry | null} */ current) => {
    const group = (/** @type {DocEntry["group"]} */ g, /** @type {string} */ label) => {
      const items = entries.filter((d) => d.group === g);
      if (!items.length) return "";
      return `<li><p class="eyebrow">${e(label)}</p><ol>${items.map((d) => `<li><a href="${d.url}"${current && d.url === current.url ? ' aria-current="page"' : ""}>${e(d.title)}</a></li>`).join("")}</ol></li>`;
    };
    return `<nav class="pages" aria-label="${e(w.docsAll)}"><p class="eyebrow">${e(w.docsAll)}</p><ol class="groups">${group("current", w.docsCurrent)}${group("tutorials", w.docsTutorials)}${group("historical", w.docsHistorical)}${group("adr", w.docsDecisions)}</ol></nav>`;
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
    const banner = r.entry.group === "historical" ? `<p class="banner">${e(w.docsHistoricalNote)} <a href="/docs/">${e(w.docsAll)}</a>.</p>` : "";
    const main = `
<div class="layout">
  <aside class="side">${tocHtml(r.toc, w.docsOnThisPage)}${side(r.entry)}</aside>
  <article>
    <p class="eyebrow">${e(w.docs)}</p>
    <h1>${e(r.entry.title)}</h1>
    ${r.entry.description ? `<p class="lede">${e(r.entry.description)}</p>` : ""}
    ${banner}
    ${html}
    <nav class="pager" aria-label="${e(w.docsAll)}">${prev ? `<a class="prev" href="${prev.url}"><span>${e(w.docsPrevious)}</span>${e(prev.title)}</a>` : "<span></span>"}${next ? `<a class="next" href="${next.url}"><span>${e(w.docsNext)}</span>${e(next.title)}</a>` : ""}</nav>
    <p class="source"><a href="${REPO_URL}/blob/main/docs/${e(r.entry.file)}">${e(w.docsSource)}</a></p>
  </article>
</div>`;
    files.set(`${r.entry.url.slice(1)}index.html`, sitePage({ title: r.entry.title, description: r.entry.description || w.docsDescription, path: r.entry.url, main, current: "docs", styles, v, logos, w, legal }));
  }

  // The index: what the README lists, as a page.
  const list = (/** @type {DocEntry["group"]} */ g, /** @type {string} */ label, /** @type {string} */ note) => {
    const items = entries.filter((d) => d.group === g);
    if (!items.length) return "";
    return `<section aria-labelledby="g-${g}"><h2 id="g-${g}">${e(label)}</h2>${note ? `<p class="note">${e(note)}</p>` : ""}<ul class="doc-list">${items.map((d) => `<li><a href="${d.url}">${e(d.title)}</a>${d.description ? `<span>${e(d.description)}</span>` : ""}</li>`).join("")}</ul></section>`;
  };
  const start = entries.find((d) => d.file.startsWith("00-"));
  const indexMain = `
<div class="layout one">
  <article>
    <p class="eyebrow">${e(w.docs)}</p>
    <h1>${e(w.docsTitle)}</h1>
    <p class="lede">${e(w.docsLead)}${start ? ` <a href="${start.url}">${e(start.title)}</a>.` : ""}</p>
    ${list("current", w.docsCurrent, "")}
    ${list("tutorials", w.docsTutorials, w.docsTutorialsNote)}
    ${list("historical", w.docsHistorical, w.docsHistoricalNote)}
    ${list("adr", w.docsDecisions, "")}
  </article>
</div>`;
  files.set("docs/index.html", sitePage({ title: w.docsTitle, description: w.docsDescription, path: "/docs/", main: indexMain, current: "docs", styles: [], v, logos, w, legal }));
  return { files, entries };
}
