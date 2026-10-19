// `pnpm --filter @potyro/generator maps-to-po <app source> <locales folder> [--dry]` (docs/30 §7)
//
// Move an app's inline translation maps into locales/<lang>.po (src/maps-to-po.ts), and say what it
// could not move safely.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writePo, type CatalogEntry } from "@potyro/i18n/app-catalogs";
import { extractMessages, mergeCatalog } from "../src/app-catalog.js";
import { convert } from "../src/maps-to-po.js";


const args = process.argv.slice(2).filter((a) => a !== "--");
const [sourcePath, folder] = args.filter((a) => !a.startsWith("--"));
if (!sourcePath || !folder) {
  console.error("usage: maps-to-po <app source> <locales folder> [--dry]");
  process.exit(2);
}
const cwd = process.env.INIT_CWD ?? process.cwd();
const file = resolve(cwd, sourcePath);
const dir = resolve(cwd, folder);
const before = readFileSync(file, "utf8");
const own = /\blanguage:\s*"([^"]+)"/.exec(before)?.[1] ?? "en";
const out = convert(before, own);
const extracted = await extractMessages(out.source);
if (!extracted) throw new Error(`${sourcePath}: no defineApp after converting`);
const ids = new Set(extracted.messages.map((m) => m.id));
console.log(`${sourcePath}: ${out.maps} maps → strings, ${out.wrapped} wrapped in ctx.t, ${out.contexts} told apart by a context, ${extracted.messages.length} messages`);
for (const [lang, cat] of Object.entries(out.catalogs).sort()) {
  const lost = [...cat.keys()].filter((k) => !ids.has(k.split("\u0004").pop()!));
  if (lost.length) out.reports.push(`${lang}: ${lost.length} translated text(s) the extractor does not find: ${lost.slice(0, 3).map((s) => JSON.stringify(s)).join(", ")}${lost.length > 3 ? "…" : ""}`);
  const seed: CatalogEntry[] = [...cat].map(([key, text]) => {
    const [context, id] = key.includes("\u0004") ? key.split("\u0004") : [undefined, key];
    return { id: id!, ...(context ? { context } : {}), text, fuzzy: false, obsolete: false, references: [], notes: [] };
  });
  const { po, report } = mergeCatalog(writePo(lang, seed), lang, extracted.messages);
  console.log(`  ${lang}: ${report.translated}/${report.total} translated`);
  if (!args.includes("--dry")) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${lang}.po`), po);
  }
}
for (const r of out.reports) console.warn(`  ! ${r}`);
for (const p of extracted.problems) console.warn(`  ! line ${p.line}: ${p.why}: ${p.text}`);
if (!args.includes("--dry")) {
  writeFileSync(file, out.source);
  if (!existsSync(join(dir, "messages.pot"))) console.log(`  run: pnpm i18n:app ${sourcePath} ${folder}`);
}

