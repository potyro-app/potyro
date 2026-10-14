// SCRATCH (uncommitted): words completeness per app source, against the six languages.
import { readFileSync } from "node:fs";
import { readSourceWords, sourceSlots, functionStrings, tMapGaps } from "../src/source-words.ts";
import { IntlMessageFormat } from "../../host/node_modules/intl-messageformat/lib/index.js";
const SIX = ["en", "pt-BR", "de", "es", "pl", "it"];
const files = process.argv.slice(2);
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const sw = await readSourceWords(src);
  if (!sw) {
    console.log(f, "NO DEFINITION");
    continue;
  }
  console.log(`\n===== ${f}  (${src.length} B) language=${sw.data.language} languages=${JSON.stringify(sw.data.languages)}`);
  const slots = sourceSlots(sw);
  for (const s of slots) {
    if (s.suggested !== undefined) console.log("  NO-WORDS", s.path, "→", s.suggested);
    else if (s.kind === "code") console.log("  CODE", s.path);
    else if (typeof s.value === "string") console.log("  PLAIN", s.path, JSON.stringify(s.value));
    else {
      const miss = SIX.filter((l) => !(l in (s.value as object)));
      if (miss.length) console.log("  GAP", s.path, miss.join(","));
    }
  }
  for (const g of tMapGaps(sw, SIX)) console.log("  T-GAP", g.line, g.missing.join(","), g.text.slice(0, 60));
  for (const s of functionStrings(sw)) console.log("  FN-STR", s.line, JSON.stringify(s.text));
  // Every ctx.t map's messages parse as ICU, in their own language, and format with sample vars.
  const visit = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (n.type === "CallExpression" && n.callee?.type === "MemberExpression" && n.callee.property?.name === "t" && n.arguments?.[0]?.type === "ObjectExpression") {
      for (const p of n.arguments[0].properties) {
        const lang = p.key?.name ?? p.key?.value;
        if (p.value?.type !== "StringLiteral") continue;
        try {
          const m = new IntlMessageFormat(p.value.value, lang);
          const vars: Record<string, unknown> = {};
          for (const name of p.value.value.match(/\{(\w+)/g) ?? []) vars[name.slice(1)] = 3;
          vars.who = "me";
          m.format(vars);
        } catch (e) {
          console.log("  ICU-BAD", n.loc?.start.line, lang, String(e).slice(0, 120));
        }
      }
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === "loc") continue;
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object" && (v as any).type) visit(v);
    }
  };
  visit(sw.ast);
}
