#!/usr/bin/env node
// Make an app package (#253): the app's source, the files it ships with, and an optional seed, as one
// zip that Add an app installs.
//
//   pnpm pack:app <app.tsx> [file …] [--seed seed.json] [--files <dir>] [-o out.zip]
//
// Every `file` ships at the top of the app's folder under its own name; `--files <dir>` ships a whole
// folder, keeping its sub-folders. The format is `potyro-app/1` (packages/store/src/app-package.ts);
// packages/store/test/app-package.test.ts runs this script and reads its zip back with the real
// reader, so the two cannot drift apart.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(new URL("../packages/store/package.json", import.meta.url));
const { zipSync, strToU8 } = require("fflate");

const cwd = process.env.INIT_CWD ?? process.cwd();
const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const seedPath = take("--seed");
const filesDir = take("--files");
const out = take("-o") ?? take("--out");
const [sourcePath, ...loose] = args;
if (!sourcePath) {
  console.error("usage: pnpm pack:app <app.tsx> [file …] [--seed seed.json] [--files <dir>] [-o out.zip]");
  process.exit(2);
}

const sourceName = /x$/i.test(sourcePath) ? "app.tsx" : "app.ts";
const shipped = new Map();
for (const f of loose) shipped.set(basename(f), readFileSync(resolve(cwd, f)));
if (filesDir) {
  const root = resolve(cwd, filesDir);
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else shipped.set(relative(root, full).split("\\").join("/"), readFileSync(full));
    }
  };
  walk(root);
}

const entries = {
  "manifest.json": strToU8(
    JSON.stringify({ format: "potyro-app/1", source: sourceName, files: [...shipped].map(([path, data]) => ({ path, size: data.byteLength })) }, null, 2),
  ),
  [sourceName]: readFileSync(resolve(cwd, sourcePath)),
};
for (const [path, data] of shipped) entries[`files/${path}`] = new Uint8Array(data);
if (seedPath) {
  const seed = readFileSync(resolve(cwd, seedPath), "utf8");
  JSON.parse(seed); // fail here, not on someone's device
  entries["seed.json"] = strToU8(seed);
}

const target = resolve(cwd, out ?? `${basename(sourcePath).replace(/\.app\.[jt]sx?$|\.[jt]sx?$/, "")}.potyro-app.zip`);
writeFileSync(target, zipSync(entries));
console.log(`${relative(cwd, target)}: the app and ${shipped.size} file${shipped.size === 1 ? "" : "s"}${seedPath ? ", with a seed" : ""}`);
