// The site's own text pages (#8): the Learn-more page behind each block of the home (site/how/*.md)
// and /developers (site/developers.md). Markdown with frontmatter, in the site's chrome; the words
// are the files', so they are edited as text. A `{{package-map}}` token in a page is the package
// map's diagram from docs/00, drawn at build, so the picture and the document never drift apart.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml as e } from "../../gallery/src/build.mjs";
import { drawDiagrams, frontmatter, markdown, sitePage, tocHtml } from "./render.mjs";
import { docUrl } from "./docs.mjs";

/** The ideas of the home, in its order; each has a page at /how/<id>/. */
export const IDEAS = ["data", "database", "make", "together", "ai", "share", "safe"];

/** The second Mermaid block of docs/00 is the package map. @param {string} docsDir */
export function packageMapDiagram(docsDir) {
  const text = readFileSync(join(docsDir, "00-how-potyro-works.md"), "utf8");
  const blocks = [...text.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
  const map = blocks.find((b) => /packages\/schema|schema/.test(b) && /shell/.test(b));
  if (!map) throw new Error("docs/00 has no package-map diagram");
  return map;
}

/** Where a link in a site page goes: `/...` as it is, `docs/NN` to that doc, anything else as written. @param {string} href */
const siteLink = (href) => {
  const m = /^docs\/(\d\d-[\w-]+\.md|adr\/[\w-]+\.md|tutorials\/[\w-]+\.md)(#.*)?$/.exec(href);
  return m ? docUrl(m[1]) + (m[2] ?? "") : href;
};

/**
 * Render the Learn-more pages and /developers. Returns files by path from the root.
 * @param {object} input
 * @param {string} input.siteDir
 * @param {string} input.docsDir
 * @param {Record<string, string>} input.w
 * @param {Record<string, string>} input.logos
 * @param {{ css: string; js: string }} input.v
 * @param {boolean} input.legal
 * @param {Record<string, string>} input.hours  idea → hour, the home's
 */
export async function renderPages({ siteDir, docsDir, w, logos, v, legal, hours }) {
  /** @type {Map<string, string>} */
  const files = new Map();
  const md = markdown({ link: siteLink });
  /** @type {{ id: string; def: string }[]} */
  const diagrams = [];
  /** @type {{ path: string; url: string; meta: Record<string, string>; html: string; toc: { level: string; id: string; text: string }[]; ids: string[]; kind: "how" | "developers" }[]} */
  const pages = [];

  const add = async (/** @type {string} */ file, /** @type {string} */ url, /** @type {"how" | "developers"} */ kind) => {
    const { meta, body, has } = frontmatter(readFileSync(file, "utf8"));
    if (!has || !meta.title || !meta.lead) throw new Error(`${file}: a page needs frontmatter with title and lead`);
    const withMap = body.replace("{{package-map}}", "```mermaid\n" + packageMapDiagram(docsDir) + "```");
    const { html, toc, diagrams: defs } = await md.render(withMap);
    const slug = url.replace(/^\/|\/$/g, "").replace(/\//g, "-");
    const ids = defs.map((def, i) => { const id = `d-${slug}-${i}`; diagrams.push({ id, def }); return id; });
    pages.push({ path: file, url, meta, html, toc, ids, kind });
  };
  for (const id of IDEAS) await add(join(siteDir, "how", `${id}.md`), `/how/${id}/`, "how");
  await add(join(siteDir, "developers.md"), "/developers/", "developers");

  const drawn = await drawDiagrams(diagrams);
  const svgById = new Map(diagrams.map((d, i) => [d.id, drawn[i]]));

  for (const p of pages) {
    let html = p.html.replace(/<!--mermaid:(\d+)-->/g, (_, n) => `<figure class="diagram">${svgById.get(p.ids[Number(n)])?.svg ?? ""}</figure>`);
    const css = p.ids.map((id) => svgById.get(id)?.css ?? "").filter(Boolean).join("\n");
    const styles = [];
    if (css) {
      const path = `${p.url.slice(1)}diagrams.css`;
      files.set(path, css + "\n");
      styles.push(`/${path}`);
    }
    const idea = p.kind === "how" ? p.url.split("/")[2] : "";
    const hour = p.kind === "how" ? hours[idea] : undefined;
    const others = p.kind === "how" ? `<nav class="more" aria-label="${e(w.howOthers)}"><p class="eyebrow">${e(w.howOthers)}</p><ul>${IDEAS.filter((i) => i !== idea).map((i) => `<li><a href="/how/${i}/" data-traco="${e(hours[i])}">${e(w[i])}</a></li>`).join("")}</ul></nav>` : "";
    const main = `
<div class="layout one">
  <article class="${p.kind}">
    <header class="head"><p class="eyebrow">${e(p.kind === "how" ? w.howEyebrow : w.developers)}</p><h1>${e(p.meta.title)}</h1><p class="lede">${e(p.meta.lead)}</p></header>
    ${p.kind === "developers" ? tocHtml(p.toc, w.docsOnThisPage) : ""}
    ${html}
    ${others}
  </article>
</div>`;
    files.set(`${p.url.slice(1)}index.html`, sitePage({ title: p.meta.title, description: p.meta.description ?? p.meta.lead, path: p.url, main, current: p.kind === "developers" ? "developers" : "", styles, v, logos, w, legal, hour }));
  }
  return { files, pages: pages.map((p) => p.url) };
}
