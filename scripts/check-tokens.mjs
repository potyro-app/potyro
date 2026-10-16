// Design tokens are real only if nothing bypasses them (#92).
//
// Two checks over packages/shell/src/styles.css:
//   1. Every `var(--x)` names a token that is defined somewhere in the file, or is one the markup
//      sets inline (`--accent` per app, `--tile-accent` per tile, `--k-hue` per person). The audit
//      found twelve references to tokens that did not exist, each quietly falling back to a hex
//      literal — which is how the palette drifted.
//   2. Inside a `/* tokens-only: start … */` … `/* tokens-only: end */` region, no raw colour: no
//      hex, no `oklch()` / `rgb()` / `hsl()` with literal channels, no named colour. A colour there
//      is a token, or a `color-mix` / relative-colour expression of tokens.
//
// A lightweight regex scan, like check-boundaries.mjs. Good enough to fail closed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../packages/shell/src/styles.css", import.meta.url));
const css = readFileSync(file, "utf8");
const lines = css.split("\n");

/** Tokens the markup sets on an element rather than the stylesheet. */
const INLINE = new Set([
  "--accent",
  "--tile-accent",
  "--k-hue",
  "--swatch",
  // The Start screen (#96): each tile's colour (contrast-checked in tile-colour.ts), its press tilt
  // and size, a group's tint, and the wall's measured grid and turnstile delay (launcher-metro.tsx).
  "--tile-bg",
  "--tile-tx",
  "--tile-ty",
  "--tile-w",
  "--tile-h",
  "--group-tint",
  "--metro-unit",
  "--metro-gap",
  "--metro-cols",
  "--metro-leave",
  // Where a balloon's tail sits, measured against the button it hangs off (`useAnchored`).
  "--k-tail",
  // Set on <html> by Capacitor 8 on Android: the status and gesture bars, when env() reports 0.
  "--safe-area-inset-top",
  "--safe-area-inset-right",
  "--safe-area-inset-bottom",
  "--safe-area-inset-left",
]);

const problems = [];

// 1. Undefined tokens.
const defined = new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
for (const [i, line] of lines.entries()) {
  for (const m of line.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) {
    const name = m[1];
    if (!defined.has(name) && !INLINE.has(name)) problems.push(`${i + 1}: var(${name}) — no such token is defined`);
  }
}

// 2. Raw colours inside tokens-only regions.
const RAW = [
  { re: /#[0-9a-fA-F]{3,8}\b/, what: "a hex colour" },
  { re: /\b(?:oklch|oklab|rgb|rgba|hsl|hsla|lab|lch)\(\s*(?!from\b)[^)]*\d/, what: "a colour with literal channels" },
  // `transparent` and `currentColor` are not colours of the palette; every other keyword is.
  { re: /(?:^|[\s:,(])(?:white|black|red|green|blue|gray|grey|yellow|orange|pink|purple)\b(?!-)/, what: "a named colour" },
];
let region = null;
for (const [i, raw] of lines.entries()) {
  const line = raw.replace(/\/\*.*?\*\//g, ""); // ignore comments on the line itself
  const start = /tokens-only:\s*start(?:\s*—\s*(.*?))?\s*\*\//.exec(raw);
  if (start) {
    region = { name: start[1] ?? "region", at: i + 1 };
    continue;
  }
  if (/tokens-only:\s*end/.test(raw)) {
    region = null;
    continue;
  }
  if (!region) continue;
  for (const { re, what } of RAW) {
    if (re.test(line) && !/^\s*\/\*/.test(raw)) {
      problems.push(`${i + 1}: ${what} inside the tokens-only region "${region.name}" (from line ${region.at}): ${line.trim()}`);
      break;
    }
  }
}
if (region) problems.push(`tokens-only region "${region.name}" opened at line ${region.at} is never closed`);

if (problems.length) {
  console.error(`check-tokens: ${problems.length} problem(s) in packages/shell/src/styles.css\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`check-tokens: ${defined.size} tokens defined, every reference resolves, tokens-only regions are clean.`);
