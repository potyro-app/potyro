// The corpus's sources, read from the repository (Node only — the build script and the staleness
// test). Which files count is decided by `inCorpus` in corpus.ts; this only walks the disk.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inCorpus, type CorpusFile } from "./corpus.js";
import type { WordPair } from "./corpus-lexicon.js";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const ROOTS = ["examples", "apps", "docs", "packages/schema/src/types"];
const SKIP = new Set(["node_modules", "dist", "test", ".vite", "coverage"]);

function walk(dir: string, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
}

/**
 * A doc's frontmatter (`---` … `---` at the very top; the site's title, description, status and
 * order) is for the site and the index, not for the model: it is removed before a doc is packed.
 * Only a block that is closed is removed; a lone `---` is a horizontal rule and stays.
 */
export function stripFrontmatter(text: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n(?:\r?\n)*/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

export function collectCorpusFiles(root: string = REPO_ROOT): CorpusFile[] {
  const paths: string[] = [];
  for (const r of ROOTS) walk(join(root, r), paths);
  return paths
    .map((full) => relative(root, full).split(sep).join("/"))
    .filter(inCorpus)
    .map((path) => ({ path, text: stripFrontmatter(readFileSync(join(root, path), "utf8")) }));
}

/** Longest message the catalogs lend priming: a label or a button, not a sentence. */
const CATALOG_MAX_WORDS = 3;

/** An app's own catalog beside it (docs/30): `examples/files/recipes/locales/pl.po`, `apps/piano/locales/pl.po`. */
const APP_CATALOG = /^(?:examples|apps)\/(?:[^/]+\/)+locales\/([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,4})?)\.po$/;

/** Every catalog the repository has: Potyro's own (packages/i18n/locales/<language>/messages.po), then
 *  each example's and app's, with the language each is in. */
function catalogs(root: string): Array<{ language: string; file: string }> {
  const out: Array<{ language: string; file: string }> = [];
  const shell = join(root, "packages/i18n/locales");
  for (const language of readdirSync(shell).sort()) out.push({ language, file: join(shell, language, "messages.po") });
  const files: string[] = [];
  for (const r of ["examples", "apps"]) walk(join(root, r), files);
  for (const full of files.sort()) {
    const m = APP_CATALOG.exec(relative(root, full).split(sep).join("/"));
    if (m) out.push({ language: m[1]!, file: full });
  }
  return out;
}

/**
 * Short messages in every language beside their English, from the catalogs: Potyro's own ("Mapa" is
 * "Map", "Wykres" is "Chart") and every example's and app's ("Przepis" is "Recipe"). Since docs/30 an
 * app says its words in English and carries the other languages in catalogs beside it, so these are
 * where an app's words in other languages are. Messages with placeholders or markup and untranslated
 * ones are left out; sorted, so the same catalogs make the same corpus.
 */
export function collectCatalogWords(root: string = REPO_ROOT): WordPair[] {
  const seen = new Set<string>();
  const out: WordPair[] = [];
  for (const { language, file } of catalogs(root)) {
    if (language === "en") continue;
    let po: string;
    try {
      po = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const m of po.matchAll(/^msgid "((?:[^"\\]|\\.)*)"\r?\nmsgstr "((?:[^"\\]|\\.)*)"/gm)) {
      const [english, text] = [m[1]!, m[2]!];
      if (!english || !text || text === english || /[{<]/.test(english + text)) continue;
      if (english.split(/\s+/).length > CATALOG_MAX_WORDS) continue;
      const key = `${language}\u0001${text}\u0001${english}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([language, text, english]);
    }
  }
  return out.sort((a, b) => (a.join("\u0001") < b.join("\u0001") ? -1 : 1));
}
