// The source a modify case changes, read from disk (Node only: the prime eval and its test).
// Curated examples live in examples/; an eval-only fixture beside the generator (as the modify eval
// reads them, run-modify-edits-eval.ts).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./corpus-files.js";

export function caseSource(app: string, root: string = REPO_ROOT): string {
  for (const dir of [join(root, "examples"), join(root, "packages/generator/fixtures")]) {
    for (const ext of [".app.ts", ".app.tsx"]) {
      const file = join(dir, `${app}${ext}`);
      if (existsSync(file)) return readFileSync(file, "utf8");
    }
  }
  throw new Error(`no app "${app}" in examples/ or packages/generator/fixtures/`);
}
