// What every text page of potyro.com shares (#32): Markdown to HTML with markdown-it, code coloured by
// shiki as classes (never inline styles: the site's policy has none), Mermaid drawn to SVG at build
// time with its styles moved into a stylesheet, and one page shell with the site's header and footer.
// Used by the docs layer (docs.mjs), the Learn-more pages and /developers (pages.mjs).
import { createRequire } from "node:module";
import MarkdownIt from "markdown-it";
import { createCssVariablesTheme, createHighlighter } from "shiki";
import { escapeHtml as e, inlineLogo, APP_SITE, CONTACT } from "../../gallery/src/build.mjs";

const require = createRequire(import.meta.url);
export const REPO_URL = "https://github.com/potyro-app/potyro";
const LANGS = ["typescript", "tsx", "javascript", "bash", "yaml", "json", "html", "css", "sql", "markdown", "diff"];
const KNOWN = new Set([...LANGS, "ts", "js", "sh", "shell", "yml", "jsonc", "md", "txt", "text"]);

/** @param {string} text */
export function slugify(text) {
  return text.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-");
}

/** Frontmatter as `key: value` lines, and the body after it. @param {string} text */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return { meta: /** @type {Record<string, string>} */ ({}), body: text, has: false };
  /** @type {Record<string, string>} */
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return { meta, body: text.slice(m[0].length), has: true };
}

let highlighterPromise;
const highlighter = () => (highlighterPromise ??= createHighlighter({ themes: [createCssVariablesTheme({ name: "potyro", variablePrefix: "--shiki-", variableDefaults: {}, fontStyle: true })], langs: LANGS }));

/** shiki's transformer: token colours as classes, no style attribute anywhere. @type {import("shiki").ShikiTransformer} */
const classesNotStyles = {
  pre(node) { node.properties.class = "code shiki"; delete node.properties.style; delete node.properties.tabindex; },
  code(node) { delete node.properties.style; },
  span(node) {
    const st = String(node.properties.style ?? "");
    const cls = [...st.matchAll(/--shiki-token-([\w-]+)/g)].map((m) => `tk-${m[1]}`);
    if (/font-style:italic/.test(st)) cls.push("tk-italic");
    delete node.properties.style;
    if (cls.length) node.properties.class = cls.join(" ");
    else if (node.properties.class === undefined) delete node.properties.class;
  },
};

/** @param {string} code @param {string} [lang] */
export async function highlight(code, lang = "typescript") {
  const h = await highlighter();
  return h.codeToHtml(code.replace(/\n$/, ""), { lang, theme: "potyro", transformers: [classesNotStyles] });
}

/**
 * A Markdown renderer. Code fences are coloured; a `mermaid` fence becomes a placeholder
 * (`<!--mermaid:N-->`) and its definition is collected, to be drawn after the page is rendered;
 * headings get ids and a self-link, H2 and H3 go into the contents; every link goes through `link`.
 * @param {{ link: (href: string) => string }} opts
 */
export function markdown(opts) {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
  /** @type {string[]} */
  let diagrams = [];
  /** @type {{ level: string; id: string; text: string }[]} */
  let toc = [];
  /** @type {Map<string, number>} */
  let seen = new Map();
  /** @type {Map<string, string>} */
  const pending = new Map();

  md.renderer.rules.fence = (/** @type {import("markdown-it").Token[]} */ tokens, /** @type {number} */ idx) => {
    const t = tokens[idx];
    const lang = (t.info.trim().split(/\s+/)[0] || "").toLowerCase();
    if (lang === "mermaid") {
      diagrams.push(t.content);
      return `<!--mermaid:${diagrams.length - 1}-->\n`;
    }
    const key = `<!--code:${pending.size}-->`;
    pending.set(key, JSON.stringify({ code: t.content, lang: KNOWN.has(lang) ? lang : "text" }));
    return key + "\n";
  };
  md.core.ruler.push("potyro-headings", (/** @type {import("markdown-it").StateCore} */ state) => {
    for (let i = 0; i < state.tokens.length; i++) {
      const open = state.tokens[i];
      if (open.type !== "heading_open") continue;
      const inline = state.tokens[i + 1];
      const text = (inline.children ?? []).filter((/** @type {import("markdown-it").Token} */ c) => c.type === "text" || c.type === "code_inline").map((/** @type {import("markdown-it").Token} */ c) => c.content).join("");
      let id = slugify(text) || "section";
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      if (n) id = `${id}-${n}`;
      open.attrSet("id", id);
      if (open.tag === "h2" || open.tag === "h3") toc.push({ level: open.tag, id, text });
      if (open.tag !== "h1" && inline.children) {
        const a = new state.Token("link_open", "a", 1);
        a.attrSet("href", `#${id}`);
        a.attrSet("class", "anchor");
        inline.children.unshift(a);
        inline.children.push(new state.Token("link_close", "a", -1));
      }
    }
  });
  md.core.ruler.push("potyro-links", (/** @type {import("markdown-it").StateCore} */ state) => {
    for (const block of state.tokens) {
      if (block.type !== "inline" || !block.children) continue;
      for (const child of block.children) {
        if (child.type === "link_open") {
          const href = child.attrGet("href") ?? "";
          if (child.attrGet("class") !== "anchor") child.attrSet("href", opts.link(href));
          if (/^https?:\/\//.test(child.attrGet("href") ?? "")) child.attrSet("rel", "noopener");
        }
        if (child.type === "image") child.attrSet("src", opts.link(child.attrGet("src") ?? ""));
      }
    }
  });
  md.renderer.rules.table_open = () => '<div class="table-scroll"><table>';
  md.renderer.rules.table_close = () => "</table></div>";

  return {
    /** Render a body: returns the HTML with placeholders for diagrams filled later, the contents, and the diagram definitions. @param {string} body */
    async render(body) {
      diagrams = []; toc = []; seen = new Map(); pending.clear();
      let html = md.render(body);
      for (const [key, json] of pending) {
        const { code, lang } = JSON.parse(json);
        html = html.replace(key, await highlight(code, lang));
      }
      return { html, toc, diagrams };
    },
  };
}

// ---- Mermaid, drawn at build, recoloured with the tokens, its styles taken out ----------------------
/** Mermaid theme variable → [a sentinel hex nothing else uses, the token it stands for]. */
const VARS = {
  primaryColor: ["#010101", "var(--surface)"], primaryTextColor: ["#010102", "var(--ink)"], primaryBorderColor: ["#010103", "var(--line-strong)"],
  lineColor: ["#010104", "var(--ink-soft)"], secondaryColor: ["#010105", "var(--aguada)"], tertiaryColor: ["#010106", "var(--bg)"], background: ["#010106", "var(--bg)"],
  mainBkg: ["#010101", "var(--surface)"], nodeBorder: ["#010103", "var(--line-strong)"], clusterBkg: ["#010107", "var(--bg)"], clusterBorder: ["#010108", "var(--line)"],
  titleColor: ["#010102", "var(--ink)"], edgeLabelBackground: ["#010106", "var(--bg)"], nodeTextColor: ["#010102", "var(--ink)"], textColor: ["#010102", "var(--ink)"],
  actorBkg: ["#010101", "var(--surface)"], actorBorder: ["#010103", "var(--line-strong)"], actorTextColor: ["#010102", "var(--ink)"], actorLineColor: ["#010103", "var(--line-strong)"],
  signalColor: ["#010104", "var(--ink-soft)"], signalTextColor: ["#010102", "var(--ink)"], labelBoxBkgColor: ["#010101", "var(--surface)"], labelBoxBorderColor: ["#010103", "var(--line-strong)"],
  labelTextColor: ["#010102", "var(--ink)"], loopTextColor: ["#010102", "var(--ink)"], noteBkgColor: ["#010105", "var(--aguada)"], noteBorderColor: ["#010109", "var(--traco)"],
  noteTextColor: ["#010102", "var(--ink)"], activationBkgColor: ["#010105", "var(--aguada)"], activationBorderColor: ["#010109", "var(--traco)"], sequenceNumberColor: ["#01010a", "var(--on-accent)"],
};
const themeVariables = Object.fromEntries(Object.entries(VARS).map(([k, [hex]]) => [k, hex]));
const replacements = [...new Map(Object.values(VARS).map(([hex, token]) => [hex, token]))];

/**
 * An SVG with no style of its own: its <style> blocks and every style="" attribute moved into one
 * stylesheet scoped by the drawing's id. @param {string} svg @param {string} id
 */
export function unstyle(svg, id) {
  /** @type {string[]} */
  const rules = [];
  let out = svg.replace(/<style[^>]*>([\s\S]*?)<\/style>/g, (_, css) => { rules.push(css.trim()); return ""; });
  /** @type {Map<string, string>} */
  const classes = new Map();
  out = out.replace(/<([a-zA-Z][\w:-]*)(\s[^<>]*?)?(\/?)>/g, (m, tag, attrs = "", slash) => {
    const st = /\sstyle="([^"]*)"/.exec(attrs);
    if (!st) return m;
    const decl = st[1].trim().replace(/;?$/, "");
    let rest = attrs.replace(st[0], "");
    if (!decl) return `<${tag}${rest}${slash}>`;
    let cls = classes.get(decl);
    if (!cls) { cls = `s${classes.size}`; classes.set(decl, cls); rules.push(`#${id} .${cls} { ${decl} }`); }
    const has = /\sclass="([^"]*)"/.exec(rest);
    rest = has ? rest.replace(has[0], ` class="${has[1]} ${cls}"`) : `${rest} class="${cls}"`;
    return `<${tag}${rest}${slash}>`;
  });
  return { svg: out, css: rules.join("\n") };
}

/**
 * Draw Mermaid definitions in a browser, once for all of them. Returns, per definition, the SVG
 * (no style inside) and the CSS it needs. @param {{ id: string; def: string }[]} items
 */
export async function drawDiagrams(items) {
  if (!items.length) return [];
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ path: require.resolve("mermaid/dist/mermaid.min.js") });
    /** @type {string[]} */
    const svgs = await page.evaluate(
      async ({ items, themeVariables }) => {
        // @ts-ignore mermaid is the script tag's global
        mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables, fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif", fontSize: 14, flowchart: { htmlLabels: false, useMaxWidth: false, curve: "basis" }, sequence: { useMaxWidth: false, mirrorActors: false } });
        const out = [];
        for (const { id, def } of items) {
          try {
            // @ts-ignore
            const { svg } = await mermaid.render(id, def);
            out.push(svg);
          } catch (err) {
            throw new Error(`diagram ${id} did not render: ${err instanceof Error ? err.message : String(err)}\n\n${def}`);
          }
        }
        return out;
      },
      { items, themeVariables },
    );
    return svgs.map((svg, i) => {
      let s = svg;
      for (const [hex, token] of replacements) s = s.replaceAll(new RegExp(hex, "gi"), token);
      s = s.replace(/<svg /, '<svg class="mermaid" ');
      return unstyle(s, items[i].id);
    });
  } finally {
    await browser.close();
  }
}

// ---- the page shell -----------------------------------------------------------------------------------
/**
 * A text page in the site's chrome.
 * @param {object} p
 * @param {string} p.title  the <title>, without the site's name
 * @param {string} p.description
 * @param {string} p.path  the page's path from the root, `/docs/...`
 * @param {string} p.main  the <main> contents
 * @param {"apps" | "docs" | "developers" | ""} p.current
 * @param {string[]} p.styles  stylesheet paths after tokens/hours/site
 * @param {{ css: string; js: string }} p.v
 * @param {Record<string, string>} p.logos
 * @param {Record<string, string>} p.w  the site's words
 * @param {boolean} p.legal
 * @param {string} [p.hour]  a data-traco for the page
 * @param {string} [p.lang]
 * @param {string} [p.image]  an Open Graph image path from the root
 */
export function sitePage(p) {
  const wordmark = inlineLogo(p.logos["wordmark-rosa.svg"], "mark wordmark");
  const nav = (/** @type {string} */ href, /** @type {string} */ key, /** @type {string} */ label) => `<a href="${href}"${p.current === key ? ' aria-current="page"' : ""}>${e(label)}</a>`;
  const mail = `mailto:${CONTACT}?subject=${encodeURIComponent(p.w.reportSubject)}`;
  const title = `${p.title} · Potyro`;
  const image = `https://potyro.com${p.image ?? "/media/og.png"}`;
  return `<!doctype html>
<html lang="${p.lang ?? "en"}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${e(title)}</title>
  <meta name="description" content="${e(p.description)}" />
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#1c1b1c" media="(prefers-color-scheme: dark)" />
  <meta name="referrer" content="no-referrer" />
  <link rel="canonical" href="https://potyro.com${e(p.path)}" />
  <meta property="og:site_name" content="Potyro" />
  <meta property="og:title" content="${e(title)}" />
  <meta property="og:description" content="${e(p.description)}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://potyro.com${e(p.path)}" />
  <meta property="og:image" content="${e(image)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${e(title)}" />
  <meta name="twitter:description" content="${e(p.description)}" />
  <meta name="twitter:image" content="${e(image)}" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/tokens.css?v=${p.v.css}" />
  <link rel="stylesheet" href="/hours.css?v=${p.v.css}" />
  <link rel="stylesheet" href="/text.css?v=${p.v.css}" />
${p.styles.map((s) => `  <link rel="stylesheet" href="${s}" />`).join("\n")}
</head>
<body${p.hour ? ` data-traco="${e(p.hour)}"` : ""}>
  <a class="skip" href="#main">${e(p.w.skip)}</a>
  <header class="top">
    <a class="brand" href="/" aria-label="Potyro">${wordmark}</a>
    <nav class="site-nav" aria-label="Potyro's site">${nav("/apps/", "apps", p.w.apps)}${nav("/docs/", "docs", p.w.docs)}${nav("/developers/", "developers", p.w.developers)}</nav>
    <a class="btn-cta" href="${APP_SITE}">${e(p.w.cta)}</a>
  </header>
  <main id="main" tabindex="-1">
${p.main}
  </main>
  <footer class="foot">
    <p class="privacy">${e(p.w.privacy)}</p>
    <nav class="foot-links" aria-label="Potyro">
      <a href="${APP_SITE}">${e(p.w.open)}</a>
      <a href="/apps/">${e(p.w.apps)}</a>
      <a href="/docs/">${e(p.w.docs)}</a>
      <a href="/developers/">${e(p.w.developers)}</a>
      <a href="${REPO_URL}">${e(p.w.source)}</a>${p.legal ? `
      <a href="/privacy/">${e(p.w.legalPrivacy)}</a>
      <a href="/terms/">${e(p.w.legalTerms)}</a>` : ""}
      <a href="${e(mail)}">${e(p.w.report)}</a>
    </nav>
    <p class="made">${inlineLogo(p.logos["symbol-rosa.svg"], "mark symbol")} <span>${e(p.w.made)}</span></p>
  </footer>
</body>
</html>
`;
}

/** "On this page", from a body's H2 and H3. @param {{ level: string; id: string; text: string }[]} toc @param {string} label */
export function tocHtml(toc, label) {
  if (toc.length < 2) return "";
  return `<nav class="toc" aria-label="${e(label)}"><p class="eyebrow">${e(label)}</p><ol>${toc.map((t) => `<li class="${t.level}"><a href="#${t.id}">${e(t.text)}</a></li>`).join("")}</ol></nav>`;
}
