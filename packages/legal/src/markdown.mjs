// The Markdown the legal texts are written in, as HTML. Not a general Markdown parser: the subset
// docs/legal/privacy.md and terms.md use, and nothing more — headings, paragraphs, lists (one level,
// continued by an indented line), block quotes, pipe tables, **bold**, `code` and [links](href).
// Anything else is shown as the text it is, escaped. The review notes in `<!-- -->` comments are
// left out (docs/legal/README.md: "so they do not show when the page is served").

/** @param {string} s */
export const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/**
 * The review notes taken out. A comment written as code (`` `<!-- -->` ``, which the drafts use to
 * name the convention) is text, so a `<!--` right after a backtick is kept. A line that held only a
 * note goes with it, so a note inside a list does not split the list in two.
 * @param {string} md
 */
export function stripComments(md) {
  const lines = md.replace(/\r\n?/g, "\n").replace(/(?<!`)<!--[\s\S]*?-->/g, "\u0000").split("\n");
  return lines.filter((l) => !(l.includes("\u0000") && !l.replace(/\u0000/g, "").trim())).map((l) => l.replace(/\u0000/g, "")).join("\n");
}

/**
 * The anchor a heading gets: GitHub's, so a link written for the repository works on the page
 * (`privacy.md#your-rights` → `#your-rights`). Lower case, punctuation dropped, spaces as hyphens.
 * @param {string} text
 */
export function slug(text) {
  return text
    .toLowerCase()
    .replace(/[`*_[\]()]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** The plain text of a heading's Markdown (for its anchor). @param {string} md */
const plain = (md) => md.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*]/g, "");

/**
 * One line of inline Markdown as HTML: code spans first (nothing inside them is Markdown), then
 * links, then bold.
 * @param {string} text
 * @param {(href: string) => string} link
 */
export function inline(text, link) {
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) => {
      if (i % 2) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      return escapeHtml(part)
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
          const to = link(href.replace(/&amp;/g, "&"));
          const away = /^https?:/.test(to);
          return `<a href="${escapeHtml(to)}"${away ? ' rel="noopener"' : ""}>${label}</a>`;
        })
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    })
    .join("");
}

/** @param {string} line */
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/**
 * The text as HTML, and its headings (anchor, level, text) for the page's checks.
 * @param {string} md
 * @param {{ link?: (href: string) => string }} [opts]
 * @returns {{ html: string; headings: { id: string; level: number; text: string }[] }}
 */
export function renderMarkdown(md, opts = {}) {
  const link = opts.link ?? ((h) => h);
  const lines = stripComments(md).split("\n");
  /** @type {string[]} */
  const out = [];
  /** @type {{ id: string; level: number; text: string }[]} */
  const headings = [];
  const used = new Map();
  let i = 0;
  const isBlank = (/** @type {string | undefined} */ l) => l === undefined || !l.trim();
  const startsBlock = (/** @type {string} */ l) => /^(#{1,6}\s|>\s?|-\s|\|)/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const text = h[2].trim();
      let id = slug(plain(text));
      const n = used.get(id) ?? 0;
      used.set(id, n + 1);
      if (n) id = `${id}-${n}`;
      headings.push({ id, level: h[1].length, text: plain(text) });
      out.push(`<h${h[1].length} id="${escapeHtml(id)}">${inline(text, link)}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quoted.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${renderMarkdown(quoted.join("\n"), opts).html}</blockquote>`);
      continue;
    }
    if (/^\|/.test(line) && /^\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      i += 2;
      /** @type {string[][]} */
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        `<div class="table"><table><thead><tr>${head.map((c) => `<th scope="col">${inline(c, link)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${head.map((_c, k) => `<td>${inline(r[k] ?? "", link)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    if (/^-\s/.test(line)) {
      /** @type {string[]} */
      const items = [];
      while (i < lines.length && /^-\s/.test(lines[i])) {
        let item = lines[i++].replace(/^-\s+/, "");
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^-\s/.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(`<li>${inline(item, link)}</li>`);
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    const para = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(" "), link)}</p>`);
  }
  return { html: out.join("\n"), headings };
}
