// `pnpm check:app <file.app.ts>` — run an app the way the Studio checks a generated one, with no
// model and no browser: bundle the source, validate the shape, then open every page on sample
// records and call every computed value, filter, sort and action (`smoke.ts`). Exit 0 when all of
// it passes; otherwise each failure, one per line. For an agent packing an app (AGENTS.md).
//
//   pnpm check:app drafts/reading-list/reading-list.app.ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadApp } from "../src/score.js";
import { smokeApp, smokePassed } from "../src/smoke.js";

async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("-"));
  if (!arg) {
    console.error("usage: pnpm check:app <file.app.ts | file.app.tsx>");
    process.exit(2);
  }
  const file = resolve(process.env.INIT_CWD ?? process.cwd(), arg);
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    console.error(`cannot read ${arg}`);
    process.exit(2);
  }

  let app;
  try {
    app = await loadApp(source, dirname(file));
  } catch (e) {
    console.log(`✗ ${arg} does not load:\n  ${String(e instanceof Error ? e.message : e).split("\n").join("\n  ")}`);
    process.exit(1);
  }
  console.log(`✓ loads and validates: ${app.id}, ${app.pages.length} page(s)`);

  const smoke = await smokeApp(app as never);
  const ok = smokePassed(smoke);
  const r = smoke.ran;
  console.log(`  ${r.records} sample record(s) in ${r.entities} entities; ${r.pages} page(s), ${r.computed} computed value(s), ${r.actions} action(s), ${r.reminders} reminder(s), ${r.customViews} custom view(s) run`);
  for (const page of smoke.emptyPages ?? []) console.log(`  ! page "${page}" showed none of the sample records: is its filter right?`);
  if (ok) {
    console.log("✓ runs on sample records");
  } else {
    console.log("✗ fails on sample records:");
    for (const e of smoke.errors) console.log(`  - ${e.split("\n")[0]}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
