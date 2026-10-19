// `pnpm i18n:app <app source> <locales folder> [--add pl,de] [--check]` (docs/30 §4)
//
// Extract the app's messages, write `<folder>/messages.pot`, and merge them into every
// `<folder>/<lang>.po` there (and into new ones for `--add`). Prints, per language, what is translated,
// fuzzy and missing, and the words it could not take. `--check` writes nothing and fails when any file
// would change: the CI guard that a catalog is in step with its app.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { extractMessages, mergeCatalog, writeTemplate } from "../src/app-catalog.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const check = args.includes("--check");
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--add"));
const [sourcePath, folder] = positional;
if (!sourcePath || !folder) {
  console.error("usage: pnpm i18n:app <app source> <locales folder> [--add pl,de] [--check]");
  process.exit(2);
}
const cwd = process.env.INIT_CWD ?? process.cwd();
const source = readFileSync(resolve(cwd, sourcePath), "utf8");
const dir = resolve(cwd, folder);
const extracted = await extractMessages(source);
if (!extracted) {
  console.error(`${sourcePath}: no defineApp({...}) found`);
  process.exit(1);
}

const languages = new Set(existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".po")).map((f) => f.slice(0, -3)) : []);
for (const l of (flag("--add") ?? "").split(",").filter(Boolean)) languages.add(l);
if (extracted.language) languages.delete(extracted.language);

let stale = 0;
const put = (file: string, text: string): void => {
  const was = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (was === text) return;
  stale++;
  if (check) console.error(`stale: ${file}`);
  else {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, text);
  }
};

put(join(dir, "messages.pot"), writeTemplate(extracted.messages));
for (const language of [...languages].sort()) {
  const file = join(dir, `${language}.po`);
  const { po, report } = mergeCatalog(existsSync(file) ? readFileSync(file, "utf8") : null, language, extracted.messages);
  put(file, po);
  const missing = report.total - report.translated - report.fuzzy;
  console.log(`${language}: ${report.translated}/${report.total} translated${report.fuzzy ? `, ${report.fuzzy} fuzzy` : ""}${missing ? `, ${missing} missing` : ""}${report.obsolete ? `, ${report.obsolete} obsolete` : ""}`);
}
for (const p of extracted.problems) console.warn(`  line ${p.line}: ${p.why === "not-literal" ? "ctx.t needs the words written out, not computed" : "words behind code cannot be extracted"}: ${p.text}`);
if (check && stale) {
  console.error(`${stale} file(s) out of step with ${sourcePath}: run pnpm i18n:app ${sourcePath} ${folder}`);
  process.exit(1);
}
