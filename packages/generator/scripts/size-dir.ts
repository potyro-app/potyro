// Measure generated-app SIZE across one or more eval-out dirs and print them side by side.
// Over-production is a quality problem the compile/validate/render/smoke gates cannot see: an app
// with 17 fields nobody asked for passes every gate. This is the counter-metric.
//
//   pnpm --filter @karta/generator exec vite-node scripts/size-dir.ts eval-out/fixed eval-out/budget

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadApp } from "../src/score.js";

interface Size {
  id: string;
  entities: number;
  fields: number;
  maxFields: number;
  pages: number;
  computed: number;
  actions: number;
  custom: number;
  loc: number;
}

async function measure(dir: string): Promise<Size[]> {
  const out: Size[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".app.ts")).sort()) {
    const source = readFileSync(join(dir, file), "utf8");
    try {
      const app = (await loadApp(source)) as unknown as {
        entities: Record<string, { fields: Record<string, unknown>; computed?: object; actions?: object }>;
        pages: Array<{ view: { type: string } }>;
      };
      const ents = Object.values(app.entities ?? {});
      const perEntity = ents.map((e) => Object.keys(e.fields ?? {}).length);
      out.push({
        id: file.replace(/\.app\.ts$/, ""),
        entities: ents.length,
        fields: perEntity.reduce((a, b) => a + b, 0),
        maxFields: perEntity.length ? Math.max(...perEntity) : 0,
        pages: (app.pages ?? []).length,
        computed: ents.reduce((n, e) => n + Object.keys(e.computed ?? {}).length, 0),
        actions: ents.reduce((n, e) => n + Object.keys(e.actions ?? {}).length, 0),
        custom: (app.pages ?? []).filter((p) => p.view?.type === "custom").length,
        loc: source.split("\n").length,
      });
    } catch {
      // Unloadable apps are excluded rather than counted as size 0, which would flatter the mean.
    }
  }
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

async function main(): Promise<void> {
  const dirs = process.argv.slice(2).map((d) => resolve(d));
  if (!dirs.length) throw new Error("usage: size-dir.ts <dir> [dir...]");

  const sets = await Promise.all(dirs.map(async (d) => ({ dir: d, sizes: await measure(d) })));
  const metrics: Array<[string, (s: Size) => number]> = [
    ["entities", (s) => s.entities],
    ["fields (total)", (s) => s.fields],
    ["fields (largest entity)", (s) => s.maxFields],
    ["pages", (s) => s.pages],
    ["computed", (s) => s.computed],
    ["actions", (s) => s.actions],
    ["custom views", (s) => s.custom],
    ["lines of code", (s) => s.loc],
  ];

  const names = sets.map((s) => s.dir.split("/").pop()!);
  console.log(`\n${"metric".padEnd(24)}${names.map((n) => `${n} (mean/med)`.padStart(24)).join("")}`);
  console.log("-".repeat(24 + names.length * 24));
  for (const [label, get] of metrics) {
    const cells = sets.map((s) => {
      const xs = s.sizes.map(get);
      return `${mean(xs).toFixed(1)} / ${median(xs).toFixed(0)}`.padStart(24);
    });
    console.log(label.padEnd(24) + cells.join(""));
  }
  console.log("-".repeat(24 + names.length * 24));
  console.log(
    "apps measured".padEnd(24) + sets.map((s) => String(s.sizes.length).padStart(24)).join(""),
  );
  console.log(
    "entities with 11+ fields".padEnd(24) +
      sets.map((s) => String(s.sizes.filter((x) => x.maxFields >= 11).length).padStart(24)).join("") +
      "\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
