// The corpus's sources, read from the repository (Node only — the build script and the staleness
// test). Which files count is decided by `inCorpus` in corpus.ts; this only walks the disk.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inCorpus, type CorpusFile } from "./corpus.js";

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
