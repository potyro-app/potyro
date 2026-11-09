#!/usr/bin/env node
// Every repository path a doc names must exist. A doc that points a reader at a file that is not
// there is worse than one that names no file, and nothing else notices the moment a file moves.
//
//   node scripts/check-doc-paths.mjs [file …]      default: README.md, CLAUDE.md, docs/00, docs/32 (the code map), docs/README.md, the skills
//
// A "path" is a token starting with one of ROOTS and continuing with path characters, read from
// anywhere in the text (prose, backticks, code blocks). Trailing punctuation and a `:line` suffix
// are dropped. Paths with a glob or placeholder character (`*`, `<`, `…`) are skipped.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["packages", "apps", "examples", "docs", "scripts", "gallery", "e2e"];
const DEFAULT = ["README.md", "AGENTS.md", "CLAUDE.md", "docs/00-how-potyro-works.md", "docs/32-code-map.md", "docs/contributing/code-map.md", "docs/contributing/running-the-repository.md", "docs/contributing/tests.md", "docs/README.md", ".claude/skills/new-app/SKILL.md", ".claude/skills/ctx-member/SKILL.md", ".claude/skills/ship-pr/SKILL.md"];
const TOKEN = new RegExp(`(?<![\\w/.-])(?:${ROOTS.join("|")})/[\\w./\\-*<>…]+`, "g");
const DOC_NAMES = readdirSync(join(ROOT, "docs"));

/** `docs/22` is how the docs name each other: it exists when a file `docs/22-*.md` does. */
function exists(path) {
  const short = /^docs\/(\d\d)$/.exec(path);
  if (short) return DOC_NAMES.some((n) => n.startsWith(`${short[1]}-`));
  return existsSync(join(ROOT, path));
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
let checked = 0;
const missing = [];
for (const file of files) {
  const full = isAbsolute(file) ? file : join(ROOT, file);
  if (!existsSync(full)) {
    missing.push(`${file} (the file itself)`);
    continue;
  }
  const lines = readFileSync(full, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const raw of line.match(TOKEN) ?? []) {
      if (/[*<>…]/.test(raw)) continue;
      const path = raw.replace(/:\d+(-\d+)?$/, "").replace(/[.,;:)\]]+$/, "");
      checked += 1;
      if (!exists(path)) missing.push(`${path} (${file}:${i + 1})`);
    }
  });
}
if (missing.length) {
  for (const m of missing) console.error(`missing: ${m}`);
  process.exit(1);
}
console.log(`ok: ${checked} paths in ${files.length} files`);
