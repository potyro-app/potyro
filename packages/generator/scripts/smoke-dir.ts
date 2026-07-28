// Run the deep gate (`smoke.ts`) over every .app.ts in a directory. No model calls — this re-scores
// artifacts an eval run already produced, so it is free and repeatable.
//
//   pnpm --filter @karta/generator smoke:dir -- eval-out/baseline

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadApp } from "../src/score.js";
import { smokeApp, smokePassed, type SmokeResult } from "../src/smoke.js";

async function main(): Promise<void> {
  const dir = resolve(process.argv[2] ?? "eval-out/baseline");
  const files = readdirSync(dir).filter((f) => /\.app\.tsx?$/.test(f)).sort();
  console.log(`smoke: ${files.length} apps in ${dir}\n`);

  const rows: Array<{ id: string; passed: boolean; smoke: SmokeResult | null; error?: string }> = [];
  for (const file of files) {
    const id = file.replace(/\.app\.tsx?$/, "");
    try {
      const app = await loadApp(readFileSync(join(dir, file), "utf8"));
      const smoke = await smokeApp(app as never);
      const passed = smokePassed(smoke);
      rows.push({ id, passed, smoke });
      const first = smoke.errors[0]?.split("\n")[0] ?? "";
      console.log(`${passed ? "✓" : "✗"} ${id.padEnd(22)} ${passed ? "" : first.slice(0, 96)}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      rows.push({ id, passed: false, smoke: null, error });
      console.log(`! ${id.padEnd(22)} load failed: ${error.split("\n")[0].slice(0, 90)}`);
    }
  }

  const passed = rows.filter((r) => r.passed).length;
  const pct = (n: number) => `${Math.round((n / Math.max(rows.length, 1)) * 100)}%`;
  const gate = (k: keyof SmokeResult) => rows.filter((r) => r.smoke && r.smoke[k] === true).length;

  console.log(
    [
      "",
      "=".repeat(60),
      `SMOKE (n=${rows.length})  — apps whose own logic actually runs`,
      `  seeded:     ${gate("seeded")}/${rows.length} (${pct(gate("seeded"))})`,
      `  computed:   ${gate("computedOk")}/${rows.length} (${pct(gate("computedOk"))})`,
      `  bindings:   ${gate("bindingsOk")}/${rows.length} (${pct(gate("bindingsOk"))})`,
      `  actions:    ${gate("actionsOk")}/${rows.length} (${pct(gate("actionsOk"))})`,
      `  reminders:  ${gate("remindersOk")}/${rows.length} (${pct(gate("remindersOk"))})`,
      `  ALL PASS:   ${passed}/${rows.length} (${pct(passed)})`,
      "",
    ].join("\n"),
  );

  writeFileSync(join(dir, "smoke.json"), JSON.stringify(rows, null, 2));
  console.log(`smoke.json written to ${dir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
