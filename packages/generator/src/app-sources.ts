// An app's own files, read from disk (Node only): its source and every module it imports by a relative
// path (`./words.ts`, and what those import), the code its words are in (docs/30). The browser has the
// same set as the package's `src/` modules.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs"];

/** The source at `entry`, and its own modules' sources in import order. */
export function readAppSources(entry: string): { source: string; modules: string[]; files: string[] } {
  const seen = new Set<string>([resolve(entry)]);
  const files: string[] = [];
  const modules: string[] = [];
  const visit = (file: string): void => {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const base = resolve(dirname(file), m[1]!);
      // TypeScript imports `./words.js` for `./words.ts`.
      const stem = base.replace(/\.(m?js|jsx)$/, "");
      const found = [...EXTENSIONS.map((x) => base + x), stem + ".ts", stem + ".tsx"].find((p) => existsSync(p) && !p.endsWith(".json") && !/\.(m?js|jsx)$/.test(p));
      if (!found || seen.has(found)) continue;
      seen.add(found);
      files.push(found);
      modules.push(readFileSync(found, "utf8"));
      visit(found);
    }
  };
  const source = readFileSync(entry, "utf8");
  visit(resolve(entry));
  return { source, modules, files };
}
