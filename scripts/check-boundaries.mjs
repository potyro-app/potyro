// Architectural boundary check (docs/09 invariant #5).
//
// Enforces the seams from docs/02:
//   - `views` must not import `store` / `host` / `capabilities` concrete packages.
//   - `runtime` must not import concrete Store/Capabilities/Host impls (only interfaces
//     from their packages' type entrypoints are allowed; concrete impl files are not).
//   - App modules (examples/*.app.ts) must reach host power only via `ctx` — they may
//     import `karta` (defineApp + types) but never a host/store/capabilities package.
//
// This is intentionally a lightweight regex scan (no dep-cruiser dependency yet). It is
// good enough to fail closed on the obvious violations; tighten later.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** @type {{ pkg: string; forbidden: RegExp[]; note: string }[]} */
const rules = [
  {
    pkg: "packages/views/src",
    forbidden: [/@karta\/store/, /@karta\/host/, /@karta\/capabilities/],
    note: "views may only depend on the runtime API + schema types",
  },
  {
    pkg: "examples",
    forbidden: [/@karta\/store/, /@karta\/host/, /@karta\/capabilities/, /@karta\/runtime/, /@karta\/views/, /@karta\/shell/],
    note: "app modules reach host power only via ctx; import `karta` only",
  },
];

const IGNORE_DIRS = new Set(["node_modules", "dist", ".vite", "coverage"]);

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (IGNORE_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

let violations = 0;
for (const rule of rules) {
  const base = join(root, rule.pkg);
  for (const file of walk(base)) {
    const src = readFileSync(file, "utf8");
    for (const pattern of rule.forbidden) {
      if (pattern.test(src)) {
        violations++;
        console.error(
          `[boundaries] ${relative(root, file)} imports ${pattern.source} — ${rule.note}`,
        );
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n[boundaries] ${violations} violation(s) found.`);
  process.exit(1);
}
console.log("[boundaries] OK");
