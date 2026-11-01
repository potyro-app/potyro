// The legal pages (#117): the gate that keeps unfinished texts off the site, the page they become,
// and the shell's build step that emits them and tells the app whether to link them.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEGAL_DIR, legalSite, readLegal, renderLegalPage, siteLink, unfinished } from "../src/build.mjs";
import { renderMarkdown, stripComments } from "../src/markdown.mjs";
import { legalFileFor, legalPagesPlugin } from "../src/vite.mjs";

const real = { privacy: readFileSync(join(LEGAL_DIR, "privacy.md"), "utf8"), terms: readFileSync(join(LEGAL_DIR, "terms.md"), "utf8") };

/** The texts as the owner will leave them: every placeholder filled (addresses as example ones), the draft note gone, the date set. */
function finished(md: string): string {
  return md
    .replace(/^> \*\*Draft\.\*\*[^\n]*\n(?:>[^\n]*\n)*/m, "")
    // The real addresses (filled in on 2026-11-01) become example ones, so the fixtures do not depend on them.
    .replace(/<CONTACT EMAIL>|contact@potyro\.com/g, "privacy@example.org")
    .replace(/<ABUSE EMAIL>|abuse@potyro\.com/g, "abuse@example.org")
    .replace(/<DATE>/g, "2026-11-01")
    .replace(/<HOSTING LOCATION>/g, "Finland")
    .replace(/<RETENTION, to decide>/g, "A year");
}

/** An unfinished copy, as the repository's texts are today: a placeholder left in each and the Draft note on the privacy page. */
function unfinishedCopy(): Record<"privacy" | "terms", string> {
  const done = { privacy: finished(real.privacy), terms: finished(real.terms) };
  return {
    privacy: `> **Draft.** Not in force yet.\n\n${done.privacy.replace("Finland", "<HOSTING LOCATION>")}`,
    terms: done.terms.replace("abuse@example.org", "<ABUSE EMAIL>"),
  };
}

function folder(texts: Partial<Record<"privacy" | "terms", string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "potyro-legal-"));
  for (const [page, md] of Object.entries(texts)) writeFileSync(join(dir, `${page}.md`), md);
  return dir;
}

describe("the repository's texts", () => {
  // Whether they are finished is the owner's to change, so no test here pins either state: the
  // gate's cases below run on copies.
  it("are both there, and read as pages with a title", () => {
    for (const md of [real.privacy, real.terms]) {
      expect(renderMarkdown(md).headings.filter((h) => h.level === 1)).toHaveLength(1);
      expect(() => unfinished(md)).not.toThrow();
    }
  });
});

describe("the gate", () => {
  const done = { privacy: finished(real.privacy), terms: finished(real.terms) };
  const notice = (texts: Partial<Record<"privacy" | "terms", string>>) => {
    const read = readLegal(folder(texts));
    return read.ready ? null : read.notice;
  };

  it("unfinished copies build nothing, and one line says what is left and where to read about it", () => {
    const site = legalSite({ dir: folder(unfinishedCopy()) });
    expect(site.ready).toBe(false);
    expect(site.files.size).toBe(0);
    if (site.ready) return;
    expect(site.notice).not.toContain("\n");
    expect(site.notice).toBe('legal: /privacy and /terms not built: privacy.md still has <HOSTING LOCATION>; privacy.md still says it is a draft; terms.md still has <ABUSE EMAIL> (docs/legal/README.md).');
  });

  it("finished texts are ready, and the page says the day they take effect", () => {
    expect(readLegal(folder(done)).ready).toBe(true);
    expect(String(legalSite({ dir: folder(done) }).files.get("privacy/index.html"))).toContain("<p>Effective: 2026-11-01</p>");
  });

  it("one placeholder left in either text is enough to build neither", () => {
    expect(notice({ ...done, terms: done.terms.replace("abuse@example.org", "<ABUSE EMAIL>") })).toContain("terms.md still has <ABUSE EMAIL>");
    expect(notice({ ...done, privacy: `> **Draft.** Not yet.\n\n${done.privacy}` })).toContain("privacy.md still says it is a draft");
    expect(notice({ privacy: done.privacy })).toContain("terms.md is missing");
  });

  it("an open point written as words stops it too: to confirm, to decide, to verify, in any case", () => {
    // The hosting row as the draft once had it, a placeholder in all but name.
    expect(notice({ ...done, privacy: done.privacy.replace("| Finland |", "| Germany or Finland, to confirm |") })).toContain('privacy.md still says "to confirm"');
    expect(notice({ ...done, terms: `${done.terms}\nHow long: To Decide.\n` })).toContain('terms.md still says "to decide"');
    expect(notice({ ...done, terms: `${done.terms}\nThe logs (to verify).\n` })).toContain('terms.md still says "to verify"');
    // In a review note or in code it is not on the page, so it is not one.
    expect(notice({ ...done, terms: `${done.terms}\n<!-- the location, to confirm -->\nWrite \`to decide\` for an open point.\n` })).toBeNull();
    // A placeholder that says it is open is named once, as the placeholder.
    expect(unfinished("Kept for <RETENTION, to decide>.")).toMatchObject({ placeholders: ["<RETENTION, to decide>"], openPoints: [] });
  });

  it("each text needs its Effective: YYYY-MM-DD line, with a real day", () => {
    const without = done.privacy.replace(/^Effective: .*$/m, "");
    expect(notice({ ...done, privacy: without })).toBe('legal: /privacy and /terms not built: privacy.md has no "Effective: YYYY-MM-DD" line (docs/legal/README.md).');
    expect(notice({ ...done, terms: done.terms.replace("Effective: 2026-11-01", "Effective: 1 November 2026") })).toContain('terms.md has no "Effective: YYYY-MM-DD" line');
    expect(notice({ ...done, terms: done.terms.replace("Effective: 2026-11-01", "Effective: 2026-02-30") })).toContain('terms.md has no "Effective: YYYY-MM-DD" line');
    // In a note it does not count.
    expect(notice({ ...done, privacy: `${without}\n<!-- Effective: 2026-11-01 -->\n` })).toContain('privacy.md has no "Effective: YYYY-MM-DD" line');
    // Still a placeholder: that is what is said, once.
    expect(notice({ ...done, terms: done.terms.replace("Effective: 2026-11-01", "Effective: <DATE>") })).toBe("legal: /privacy and /terms not built: terms.md still has <DATE> (docs/legal/README.md).");
    expect(unfinished("Effective: 2026-11-01\n").effective).toBe("2026-11-01");
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
    for (const p of ["privacy/index.html", "privacy.html", "terms/index.html", "terms.html"]) expect(paths).toContain(p);
    for (const p of [/^legal\/legal\.[0-9a-f]{10}\.css$/, /^legal\/tokens\.[0-9a-f]{10}\.css$/, /^legal\/favicon\.[0-9a-f]{10}\.svg$/, /^legal\/wordmark-rosa\.[0-9a-f]{10}\.svg$/, /^legal\/wordmark-rosa-on-dark\.[0-9a-f]{10}\.svg$/, /^legal\/fonts\/figtree-latin\.[0-9a-f]{10}\.woff2$/, /^legal\/fonts\/quicksand-latin\.[0-9a-f]{10}\.woff2$/]) {
      expect(paths.filter((path) => p.test(path)), String(p)).toHaveLength(1);
    }
    expect(site.files.get("privacy.html")).toBe(site.files.get("privacy/index.html"));
  });

  it("name every file they load by its bytes, so a cache-first service worker never keeps an old font or logo", () => {
    const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex").slice(0, 10);
    for (const [path, body] of site.files) {
      if (!path.startsWith("legal/")) continue;
      expect(path, path).toMatch(new RegExp(`\\.${hash(body)}\\.(css|svg|woff2)$`));
    }
    // The fonts are named by their bytes too: tokens.css is rewritten to those names, and each is there.
    const tokensPath = [...site.files.keys()].find((p) => /^legal\/tokens\./.test(p))!;
    const fonts = [...String(site.files.get(tokensPath)).matchAll(/url\("\.\/fonts\/([^"]+)"\)/g)].map((m) => m[1]!);
    expect(fonts.length).toBeGreaterThan(0);
    for (const f of fonts) {
      expect(f).toMatch(/\.[0-9a-f]{10}\.woff2$/);
      expect(site.files.has(`legal/fonts/${f}`), f).toBe(true);
    }
    // And the page loads exactly the files that are there.
    const html = String(site.files.get("privacy/index.html"));
    const loaded = [...html.matchAll(/(?:href|src)="\.\.\/(legal\/[^"]+)"/g)].map((m) => m[1]!);
    expect(loaded).toHaveLength(5);
    for (const path of loaded) expect(site.files.has(path), path).toBe(true);
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
    expect(html).toMatch(/<link rel="stylesheet" href="\.\.\/legal\/legal\.[0-9a-f]{10}\.css" \/>/);
    // The terms link the privacy page, at its anchor.
    expect(String(site.files.get("terms/index.html"))).toContain('<a href="../privacy#your-rights">privacy page</a>');
  });

  it("the stylesheet uses the design system's values, not its own", () => {
    const css = String([...site.files].find(([p]) => /^legal\/legal\./.test(p))?.[1]);
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

  const assets = { tokens: "legal/t.css", css: "legal/l.css", favicon: "legal/f.svg", wordmark: "legal/w.svg", wordmarkDark: "legal/d.svg" };

  it("a page keeps its title even without a heading", () => {
    expect(renderLegalPage("terms", "No heading here.", { assets })).toContain("<title>Terms of use · Potyro</title>");
  });

  it("Open Potyro and the logo go to the app: the site's root on potyro.app, the app's own site beside the gallery", () => {
    const links = (html: string) => [...html.matchAll(/<a class="brand" href="([^"]+)"|<a href="([^"]+)">Open Potyro<\/a>/g)].map((m) => m[1] ?? m[2]);
    expect(links(renderLegalPage("privacy", "# Privacy", { assets }))).toEqual(["../", "../"]);
    expect(links(renderLegalPage("privacy", "# Privacy", { assets, appHref: "https://potyro.app/" }))).toEqual(["https://potyro.app/", "https://potyro.app/"]);
    const dir = folder({ privacy: finished(real.privacy), terms: finished(real.terms) });
    expect(String(legalSite({ dir, appHref: "https://potyro.app/" }).files.get("terms/index.html"))).toContain('<a href="https://potyro.app/">Open Potyro</a>');
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
    const { define, emitted, lines } = run(folder(unfinishedCopy()));
    expect(define).toEqual({ "import.meta.env.VITE_POTYRO_LEGAL": '""' });
    expect(emitted).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^legal: \/privacy and \/terms not built/);
  });

  it("with the texts finished: the pages, and the flag on", () => {
    const { define, emitted, lines } = run(filled);
    expect(define).toEqual({ "import.meta.env.VITE_POTYRO_LEGAL": '"1"' });
    expect(emitted).toEqual(expect.arrayContaining(["privacy/index.html", "privacy.html", "terms/index.html", "terms.html", expect.stringMatching(/^legal\/legal\.[0-9a-f]{10}\.css$/)]));
    expect(lines).toEqual([]);
  });

  it("the dev server answers /privacy, /privacy/ and /privacy.html with the page, and leaves the rest to the app", () => {
    const site = legalSite({ dir: filled });
    expect(site.ready).toBe(true);
    for (const url of ["/privacy", "/privacy/", "/privacy.html", "/privacy?x=1", "/privacy/index.html"]) expect(legalFileFor(site.files, url)?.path).toBe("privacy/index.html");
    const css = [...site.files.keys()].find((p) => /^legal\/legal\./.test(p))!;
    expect(legalFileFor(site.files, `/${css}?x=1`)?.path).toBe(css);
    for (const url of ["/", "/privacy-policy", "/s/abc", "/legal/nothing.css"]) expect(legalFileFor(site.files, url)).toBeNull();
  });
});
