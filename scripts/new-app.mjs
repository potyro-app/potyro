#!/usr/bin/env node
// `pnpm new:app <id>` — a folder in drafts/ with a Potyro app in it, linked to this repository's
// `potyro` package, so an app can be written, checked and packed here without becoming part of
// Potyro (AGENTS.md). drafts/ is ignored by git, is not in the workspace, and is read by nothing
// else in the repo, so a draft never touches the lockfile or the tests.
//
//   pnpm new:app reading-list            → drafts/reading-list/, installed on its own
//   cd drafts/reading-list && pnpm typecheck && pnpm test && pnpm build
//                                         → dist/reading-list.potyro-app.zip
//
// The folder is what `npm create potyro` makes (packages/create-potyro/template), with two changes:
// `potyro` is a link to packages/schema, and the build packs whichever `*.app.ts` or `*.app.tsx`
// the folder holds, so the app may use JSX for a custom view.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { create, slugOf } from "../packages/create-potyro/index.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const arg = process.argv[2];
if (!arg || arg.startsWith("-")) {
  console.error("usage: pnpm new:app <id>      (a lowercase slug: letters, digits, dashes)");
  process.exit(2);
}
const id = slugOf(arg);
const dir = join(ROOT, "drafts", id);
if (existsSync(dir)) {
  console.error(`drafts/${id} exists already: pick another id, or remove the folder`);
  process.exit(1);
}

const written = create(dir);

const pkgPath = join(dir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.scripts.build = `potyro pack -o dist/${id}.potyro-app.zip`;
pkg.devDependencies.potyro = "link:../../packages/schema";
pkg.devDependencies.react = "^18.3.1";
pkg.devDependencies["@types/react"] = "^18.3.12";
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

execSync("pnpm install --ignore-workspace --prefer-offline", { cwd: dir, stdio: "inherit" });

console.log(`\ndrafts/${id}/`);
for (const f of written) console.log(`  ${f}`);
console.log(`
Next:
  edit drafts/${id}/${id}.app.ts            the whole app
  pnpm check:app drafts/${id}/${id}.app.ts   run it on sample records (from the repository root)
  cd drafts/${id}
  pnpm typecheck && pnpm test              the types, and that the app is valid
  pnpm build                               → dist/${id}.potyro-app.zip`);
