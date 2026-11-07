#!/usr/bin/env node
// CLAUDE.md names every package, or an agent starts from a map with a hole in it. The package
// list went stale once (nine packages named, eighteen present) and stayed so for months: nothing
// noticed. This does: every directory under packages/ and every top-level area must be named in
// CLAUDE.md, and every path a doc names must exist (check-doc-paths.mjs). Part of `pnpm lint:docs`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
const dirs = readdirSync(join(ROOT, "packages")).filter((d) => statSync(join(ROOT, "packages", d)).isDirectory());
const missing = dirs.filter((d) => !text.includes(`packages/${d}`));
for (const area of ["apps/", "examples/", "e2e/", "gallery/", "scripts/", "docs/32-code-map.md", ".claude/skills/"]) {
  if (!text.includes(area)) missing.push(area);
}
if (missing.length) {
  console.error(`CLAUDE.md does not name: ${missing.join(", ")} — add them to "The packages"`);
  process.exit(1);
}
console.log(`[agent-map] OK — CLAUDE.md names all ${dirs.length} packages and every top-level area`);
