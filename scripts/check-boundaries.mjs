// Architectural boundary check (docs/09 invariant #5).
//
// Enforces the seams from docs/02:
//   - `views` must not import `store` / `host` / `capabilities` concrete packages.
//   - `runtime` must not import concrete Store/Capabilities/Host impls (only interfaces
//     from their packages' type entrypoints are allowed; concrete impl files are not).
//   - App modules (examples/*.app.ts) must reach host power only via `ctx` — they may
//     import `potyro` (defineApp + types) but never a host/store/capabilities package.
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
    // The console guard (e2e/console-guard.ts) only watches specs that take `test` from it. A spec
    // taking `test` from Playwright directly is a spec whose console errors nobody sees — which is
    // how nine errors per load went unnoticed (fix/opfs-access-handles). The guard itself is the one
    // file that may: it imports `test as base`.
    pkg: "e2e",
    forbidden: [/^import\s*\{[^}]*\btest\b(?!\s+as\s+base)[^}]*\}\s*from\s*["']@playwright\/test["']/m],
    note: "e2e takes `test` from ./console-guard, so the console guard sees it",
  },
  {
    pkg: "packages/views/src",
    forbidden: [/@potyro\/store/, /@potyro\/host/, /@potyro\/capabilities/, /@potyro\/shell/],
    note: "views may only depend on the runtime API + schema types (+ @potyro/i18n for its own words)",
  },
  {
    // Potyro's catalogs and locale logic are shared by shell and views (#298), and later by the
    // host for `ctx.locale` (#302), so they sit below all of them and depend on none.
    pkg: "packages/i18n/src",
    // Real imports only: the package's own docs show `from "@potyro/i18n"` in comments.
    forbidden: [/^(?:import|export)\b[^\n]*["']@potyro\//m, /import\(\s*["']@potyro\//],
    note: "i18n depends on no Potyro package; shell, views and (later) host depend on it",
  },
  {
    // The relay that files requests to the Potyro team runs on the server, alone (#263): it must not
    // pull any of the app into it, and the Studio imports only its browser-safe payload.
    pkg: "packages/platform-requests/src",
    forbidden: [/^(?:import|export)\b[^\n]*["']@potyro\//m, /import\(\s*["']@potyro\//],
    note: "platform-requests depends on no Potyro package; the shell depends on it",
  },
  {
    // The share service for demo links runs on the server, alone (docs/24 §4): it must not pull any
    // of the app into it, and the shell imports only its browser-safe wire format.
    pkg: "packages/share-links/src",
    forbidden: [/^(?:import|export)\b[^\n]*["']@potyro\//m, /import\(\s*["']@potyro\//],
    note: "share-links depends on no Potyro package; the shell depends on it",
  },
  {
    pkg: "examples",
    forbidden: [/@potyro\/store/, /@potyro\/host/, /@potyro\/capabilities/, /@potyro\/runtime/, /@potyro\/views/, /@potyro\/shell/],
    note: "app modules reach host power only via ctx; import `potyro` only",
  },
  {
    pkg: "apps",
    forbidden: [/@potyro\/store/, /@potyro\/host/, /@potyro\/capabilities/, /@potyro\/runtime/, /@potyro\/views/, /@potyro\/shell/],
    note: "personal apps are app modules too: import `potyro` only",
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
