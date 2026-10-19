// `pnpm --filter @potyro/generator maps-to-po <app source> <locales folder> [--dry]` (docs/30 §7)
//
// Move an app's inline translation maps into locales/<lang>.po (src/maps-to-po.ts): in its source and
// in every module of its own it imports (`./words.ts`). Translations already in the catalogs are kept.
// Says what it could not move safely.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readPo, writePo, type CatalogEntry } from "@potyro/i18n/app-catalogs";
import { extractMessages, mergeCatalog } from "../src/app-catalog.js";
import { readAppSources } from "../src/app-sources.js";
import { convert, type Converted } from "../src/maps-to-po.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const [sourcePath, folder] = args.filter((a) => !a.startsWith("--"));
if (!sourcePath || !folder) {
  console.error("usage: maps-to-po <app source> <locales folder> [--dry]");
  process.exit(2);
}
const dry = args.includes("--dry");
const cwd = process.env.INIT_CWD ?? process.cwd();
const file = resolve(cwd, sourcePath);
const dir = resolve(cwd, folder);
const app = readAppSources(file);
const own = /\blanguage:\s*"([^"]+)"/.exec(app.source)?.[1] ?? "en";

// Every file of the app's own, converted: the source first, then its modules.
const converted: Array<{ path: string; out: Converted }> = [file, ...app.files].map((path) => ({ path, out: convert(readFileSync(path, "utf8"), own) }));
const main = converted[0]!.out;
const extracted = await extractMessages(main.source, converted.slice(1).map((c) => c.out.source));
if (!extracted) throw new Error(`${sourcePath}: no defineApp after converting`);
const ids = new Set(extracted.messages.map((m) => m.id));
const sum = (k: "maps" | "wrapped" | "marked" | "contexts"): number => converted.reduce((n, c) => n + c.out[k], 0);
console.log(`${sourcePath} (+${app.files.length} modules): ${sum("maps")} maps → strings, ${sum("wrapped")} wrapped in ctx.t, ${sum("marked")} marked with msg, ${sum("contexts")} told apart by a context, ${extracted.messages.length} messages`);

const languages = new Set(converted.flatMap((c) => Object.keys(c.out.catalogs)));
const reports = converted.flatMap((c) => c.out.reports.map((r) => (c.path === file ? r : `${c.path.split("/").pop()}: ${r}`)));
for (const lang of [...languages].sort()) {
  const target = join(dir, `${lang}.po`);
  // What the catalog already says, then what the maps said.
  const seed = new Map<string, CatalogEntry>();
  if (existsSync(target)) for (const e of readPo(readFileSync(target, "utf8")).entries) if (e.text) seed.set(e.context ? `${e.context}\u0004${e.id}` : e.id, { ...e, obsolete: false });
  for (const c of converted) {
    for (const [key, text] of c.out.catalogs[lang] ?? []) {
      const [context, id] = key.includes("\u0004") ? key.split("\u0004") : [undefined, key];
      if (!seed.has(key)) seed.set(key, { id: id!, ...(context ? { context } : {}), text, fuzzy: false, obsolete: false, references: [], notes: [] });
    }
  }
  const lost = [...seed.keys()].filter((k) => !ids.has(k.split("\u0004").pop()!));
  if (lost.length) reports.push(`${lang}: ${lost.length} translated text(s) the extractor does not find: ${lost.slice(0, 3).map((s) => JSON.stringify(s)).join(", ")}${lost.length > 3 ? "…" : ""}`);
  const { po, report } = mergeCatalog(writePo(lang, [...seed.values()]), lang, extracted.messages);
  console.log(`  ${lang}: ${report.translated}/${report.total} translated`);
  if (!dry) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(target, po);
  }
}
for (const r of reports) console.warn(`  ! ${r}`);
for (const p of extracted.problems) if (p.why !== "not-literal") console.warn(`  ! line ${p.line}: ${p.why}: ${p.text}`);
if (!dry) {
  for (const c of converted) if (c.out.maps) writeFileSync(c.path, c.out.source);
  console.log(`  then: pnpm i18n:app ${sourcePath} ${folder}`);
}
