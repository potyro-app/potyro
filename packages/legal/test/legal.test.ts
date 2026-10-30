// The legal pages (#117): the gate that keeps unfinished texts off the site, the page they become,
// and the shell's build step that emits them and tells the app whether to link them.
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEGAL_DIR, legalSite, readLegal, renderLegalPage, siteLink, unfinished } from "../src/build.mjs";
import { renderMarkdown, stripComments } from "../src/markdown.mjs";
import { legalFileFor, legalPagesPlugin } from "../src/vite.mjs";

const real = { privacy: readFileSync(join(LEGAL_DIR, "privacy.md"), "utf8"), terms: readFileSync(join(LEGAL_DIR, "terms.md"), "utf8") };

/** The texts as the owner will leave them: every placeholder filled, the draft note gone. */
function finished(md: string): string {
  return md
    .replace(/^> \*\*Draft\.\*\*[^\n]*\n(?:>[^\n]*\n)*/m, "")
    .replace(/<CONTACT EMAIL>/g, "privacy@example.org")
    .replace(/<ABUSE EMAIL>/g, "abuse@example.org")
    .replace(/<DATE>/g, "1 November 2026")
    .replace(/<RETENTION, to decide>/g, "A year");
}

function folder(texts: Partial<Record<"privacy" | "terms", string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "potyro-legal-"));
  for (const [page, md] of Object.entries(texts)) writeFileSync(join(dir, `${page}.md`), md);
  return dir;
}

describe("the gate", () => {
  it("the texts in the repository still wait for the owner, so nothing is built from them", () => {
    expect(unfinished(real.privacy).placeholders).toEqual(["<DATE>", "<CONTACT EMAIL>", "<RETENTION, to decide>"]);
    expect(unfinished(real.terms).placeholders).toEqual(["<DATE>", "<CONTACT EMAIL>", "<ABUSE EMAIL>"]);
    const site = legalSite({ dir: LEGAL_DIR });
    expect(site.ready).toBe(false);
    expect(site.files.size).toBe(0);
    if (site.ready) return;
    // One line, naming what is left and where to read about it.
    expect(site.notice).not.toContain("\n");
    expect(site.notice).toMatch(/^legal: \/privacy and \/terms not built: privacy\.md still has <DATE>, <CONTACT EMAIL>, <RETENTION, to decide>; privacy\.md still says it is a draft; terms\.md still has/);
    expect(site.notice).toContain("docs/legal/README.md");
  });

  it("one placeholder left in either text is enough to build neither", () => {
    const done = { privacy: finished(real.privacy), terms: finished(real.terms) };
    expect(readLegal(folder(done)).ready).toBe(true);
    expect(readLegal(folder({ ...done, terms: done.terms.replace("abuse@example.org", "<ABUSE EMAIL>") }))).toMatchObject({ ready: false, notice: expect.stringContaining("terms.md still has <ABUSE EMAIL>") });
    expect(readLegal(folder({ ...done, privacy: `> **Draft.** Not yet.\n\n${done.privacy}` }))).toMatchObject({ ready: false, notice: expect.stringContaining("privacy.md still says it is a draft") });
    expect(readLegal(folder({ privacy: done.privacy }))).toMatchObject({ ready: false, notice: expect.stringContaining("terms.md is missing") });
  });

  it("a placeholder inside a review note or in code is not one", () => {
    expect(unfinished("Write to us.\n<!-- <CONTACT EMAIL> once the box exists -->\n").placeholders).toEqual([]);
    expect(unfinished("Placeholders look like `<THIS>`.").placeholders).toEqual([]);
    expect(unfinished("Write to <CONTACT EMAIL>.").placeholders).toEqual(["<CONTACT EMAIL>"]);
  });
});

describe("the pages", () => {
  const dir = folder({ privacy: finished(real.privacy), terms: finished(real.terms) });
  const site = legalSite({ dir });

  it("are emitted at /privacy and /terms, both as a folder's page and as a file, with their own styles and fonts", () => {
    expect(site.ready).toBe(true);
    const paths = [...site.files.keys()];
    for (const p of ["privacy/index.html", "privacy.html", "terms/index.html", "terms.html", "legal/legal.css", "legal/tokens.css", "legal/favicon.svg", "legal/wordmark-rosa.svg", "legal/wordmark-rosa-on-dark.svg", "legal/fonts/figtree-latin.woff2", "legal/fonts/quicksand-latin.woff2"]) {
      expect(paths).toContain(p);
    }
    expect(site.files.get("privacy.html")).toBe(site.files.get("privacy/index.html"));
  });

  it("is the text, with no script and nothing from anyone else, and every path from the root", () => {
    const html = String(site.files.get("privacy/index.html"));
    expect(html).toContain('<h1 id="privacy">Privacy</h1>');
    expect(html).toContain('<h2 id="who-runs-potyro">Who runs Potyro</h2>');
    expect(html).toContain("privacy@example.org");
    expect(html).not.toMatch(/<script/i);
    // The review notes are not shown.
    expect(html).not.toContain("<!--");
    expect(html).not.toContain("facts.md F-");
    for (const [, ref] of html.matchAll(/(?:href|src)="([^"]+)"/g)) expect(ref).toMatch(/^(\.\.\/|#|https:\/\/|mailto:)/);
    expect(html).toMatch(/<link rel="stylesheet" href="\.\.\/legal\/legal\.css\?v=[0-9a-f]{10}" \/>/);
    // The terms link the privacy page, at its anchor.
    expect(String(site.files.get("terms/index.html"))).toContain('<a href="../privacy#your-rights">privacy page</a>');
  });

  it("the stylesheet uses the design system's values, not its own", () => {
    const css = String(site.files.get("legal/legal.css"));
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).toContain("var(--font-body)");
  });
});

describe("the Markdown the texts use", () => {
  it("headings get GitHub's anchors, so a link written for the repository works on the page", () => {
    const { headings } = renderMarkdown("# Privacy\n\n## Sync, sharing with people, and backup\n\n### AI inside apps, and the free allowance\n\n## Voice\n\n## Voice\n");
    expect(headings.map((h) => h.id)).toEqual(["privacy", "sync-sharing-with-people-and-backup", "ai-inside-apps-and-the-free-allowance", "voice", "voice-1"]);
  });

  it("lists continue on an indented line, and a note inside one does not split it", () => {
    const { html } = renderMarkdown("- **One**: first\n  and more.\n  <!-- a note -->\n- Two\n");
    expect(html).toBe("<ul><li><strong>One</strong>: first and more.</li><li>Two</li></ul>");
  });

  it("tables, quotes, code and links; anything else is escaped text", () => {
    const { html } = renderMarkdown("| A | B |\n|---|---|\n| x | <y> |\n\n> **Note** `<!-- -->` stays\n\nSee [the terms](terms.md) & <b>this</b>.");
    expect(html).toContain('<th scope="col">A</th>');
    expect(html).toContain("<td>&lt;y&gt;</td>");
    expect(html).toContain("<blockquote><p><strong>Note</strong> <code>&lt;!-- --&gt;</code> stays</p></blockquote>");
    expect(html).toContain('<a href="terms.md">the terms</a> &amp; &lt;b&gt;this&lt;/b&gt;.');
    expect(stripComments("a `<!-- -->` b <!-- gone --> c")).toBe("a `<!-- -->` b  c");
  });

  it("links to the other text go to its page; to the review files, to the repository", () => {
    expect(siteLink("privacy.md")).toBe("../privacy");
    expect(siteLink("privacy.md#your-rights")).toBe("../privacy#your-rights");
    expect(siteLink("#your-rights")).toBe("#your-rights");
    expect(siteLink("facts.md")).toMatch(/^https:\/\/github\.com\/.+\/docs\/legal\/facts\.md$/);
    expect(siteLink("https://garanteprivacy.it")).toBe("https://garanteprivacy.it");
  });

  it("a page keeps its title even without a heading", () => {
    expect(renderLegalPage("terms", "No heading here.", { css: "0" })).toContain("<title>Terms of use · Potyro</title>");
  });
});

describe("the shell's build step", () => {
  const filled = folder({ privacy: finished(real.privacy), terms: finished(real.terms) });

  function run(dir: string) {
    const lines: string[] = [];
    const plugin = legalPagesPlugin({ dir, log: (l) => lines.push(l) });
    const emitted: string[] = [];
    plugin.generateBundle.call({ emitFile: (f) => (emitted.push(f.fileName), f.fileName) });
    return { define: plugin.config().define, emitted, lines };
  }

  it("with the texts unfinished: no page, the flag off, and one line saying why", () => {
    const { define, emitted, lines } = run(LEGAL_DIR);
    expect(define).toEqual({ "import.meta.env.VITE_POTYRO_LEGAL": '""' });
    expect(emitted).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^legal: \/privacy and \/terms not built/);
  });

  it("with the texts finished: the pages, and the flag on", () => {
    const { define, emitted, lines } = run(filled);
    expect(define).toEqual({ "import.meta.env.VITE_POTYRO_LEGAL": '"1"' });
    expect(emitted).toEqual(expect.arrayContaining(["privacy/index.html", "privacy.html", "terms/index.html", "terms.html", "legal/legal.css"]));
    expect(lines).toEqual([]);
  });

  it("the dev server answers /privacy, /privacy/ and /privacy.html with the page, and leaves the rest to the app", () => {
    const site = legalSite({ dir: filled });
    expect(site.ready).toBe(true);
    for (const url of ["/privacy", "/privacy/", "/privacy.html", "/privacy?x=1", "/privacy/index.html"]) expect(legalFileFor(site.files, url)?.path).toBe("privacy/index.html");
    expect(legalFileFor(site.files, "/legal/legal.css?v=abc")?.path).toBe("legal/legal.css");
    for (const url of ["/", "/privacy-policy", "/s/abc", "/legal/nothing.css"]) expect(legalFileFor(site.files, url)).toBeNull();
  });
});
