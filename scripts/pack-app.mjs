#!/usr/bin/env node
// Make an app package (#253): the app's source, the files it ships with, and an optional seed, as one
// zip that Add an app installs.
//
//   pnpm pack:app <app.tsx> [file …] [--seed seed.json] [--files <dir>] [-o out.zip]
//
// Every `file` ships at the top of the app's folder under its own name; `--files <dir>` ships a whole
// folder, keeping its sub-folders. Those are DATA, read at run time with `ctx.files`.
//
// The modules the source imports (`./plan.ts`, and what they import in turn) are CODE (#258): they go
// in the package's `src/`, by their path from the source's folder, and the shell's bundler resolves
// `./plan.ts` from there. Only what the app really runs is packed — esbuild walks the imports, so a
// type-only import adds nothing — and an import that leaves the source's folder is refused. The format is `potyro-app/1` (packages/store/src/app-package.ts);
// packages/store/test/app-package.test.ts runs this script and reads its zip back with the real
// reader, so the two cannot drift apart.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(new URL("../packages/store/package.json", import.meta.url));
const { zipSync, strToU8 } = require("fflate");
const { build } = createRequire(new URL("../packages/shell/package.json", import.meta.url))("esbuild");

// Paths are the caller's. `pnpm pack:app` runs from the repo root and says where it was called from in
// INIT_CWD; a package script (`pnpm --filter x build`) runs in the package, while INIT_CWD names the
// root. So the current folder wins when the path is there, and INIT_CWD is the fallback.
const here = process.cwd();
const there = process.env.INIT_CWD ?? here;
const cwd = here;
const at = (p) => (existsSync(resolve(here, p)) ? resolve(here, p) : resolve(there, p));
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
for (const f of loose) shipped.set(basename(f), readFileSync(at(f)));
if (filesDir) {
  const root = at(filesDir);
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else shipped.set(relative(root, full).split("\\").join("/"), readFileSync(full));
    }
  };
  walk(root);
}

/** The source's own modules, by path from its folder: every local file the bundle would pull in. */
async function modulesOf(entry) {
  const root = dirname(entry);
  const { metafile } = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    jsx: "automatic",
    logLevel: "silent",
    // What the shell provides, and libraries by URL (#266): not the package's own modules.
    external: ["potyro", "karta", "react", "react/*", "https://*", "http://*"],
  });
  const modules = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const full = resolve(process.cwd(), input);
    if (full === entry) continue;
    const rel = relative(root, full);
    if (rel.startsWith("..") || rel.startsWith(sep)) throw new Error(`${input} is outside the app's folder: a module must sit beside ${basename(entry)} or below it`);
    modules.set(rel.split(sep).join("/"), readFileSync(full));
  }
  return modules;
}

/**
 * What the app declares — name, icon, entities, pages, permissions — as data for the manifest (#271),
 * so the Add-an-app card can describe it without running it.
 *
 * Read HERE, by running the app's top level in Node: this is the author's own code on the author's
 * machine, and Node is a full JavaScript environment, so a top level that needs `Intl` (which the
 * sealed box lacks) reads fine. Libraries by URL are inert stand-ins — nothing is fetched. An app
 * that cannot be read here is still packed, without a declaration: the card then reads it itself.
 */
async function declarationOf(entry) {
  const schema = fileURLToPath(new URL("../packages/schema/src/index.ts", import.meta.url));
  const declare = fileURLToPath(new URL("../packages/store/src/app-declaration.ts", import.meta.url));
  const fromShell = createRequire(new URL("../packages/shell/package.json", import.meta.url));
  const STAND_IN =
    "var h = new Proxy(function () {}, { get: function (_t, k) { if (k === Symbol.toPrimitive) return function () { return ''; }; if (k === 'then' || k === '__esModule') return undefined; return h; }, apply: function () { return h; }, construct: function () { return h; } }); module.exports = h;";
  const dir = mkdtempSync(join(tmpdir(), "pack-app-"));
  try {
    await build({
      stdin: {
        contents: `import app from ${JSON.stringify(entry)};\nimport { declareApp } from ${JSON.stringify(declare)};\nexport default declareApp(app);\n`,
        resolveDir: dirname(entry),
        loader: "ts",
      },
      bundle: true,
      write: true,
      outfile: join(dir, "declared.mjs"),
      format: "esm",
      platform: "node",
      jsx: "automatic",
      logLevel: "silent",
      plugins: [
        {
          name: "pack-app-declare",
          setup(b) {
            b.onResolve({ filter: /^(potyro|karta)$/ }, () => ({ path: schema }));
            b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => ({ path: fromShell.resolve(args.path) }));
            b.onResolve({ filter: /^https?:\/\// }, (args) => ({ path: args.path, namespace: "stand-in" }));
            b.onLoad({ filter: /.*/, namespace: "stand-in" }, () => ({ contents: STAND_IN, loader: "js" }));
          },
        },
      ],
    });
    const mod = await import(pathToFileURL(join(dir, "declared.mjs")).href);
    if (!mod.default) throw new Error("it does not export an app (`export default defineApp({ … })`)");
    return mod.default;
  } catch (e) {
    const why = e?.errors?.[0]?.text ?? e?.message ?? String(e);
    console.warn(`pack:app: packed without a description of the app, so Add an app will read it from its code (${why.split("\n")[0]})`);
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const entryPath = at(sourcePath);
let modules;
try {
  modules = await modulesOf(entryPath);
} catch (e) {
  console.error(`pack:app: ${e?.errors?.[0]?.text ?? e?.message ?? e}`);
  process.exit(1);
}

const declared = await declarationOf(entryPath);

const entries = {
  "manifest.json": strToU8(
    JSON.stringify(
      {
        format: "potyro-app/1",
        source: sourceName,
        files: [...shipped].map(([path, data]) => ({ path, size: data.byteLength })),
        ...(modules.size ? { modules: [...modules].map(([path, data]) => ({ path, size: data.byteLength })) } : {}),
        ...(declared ? { app: declared } : {}),
      },
      null,
      2,
    ),
  ),
  [sourceName]: readFileSync(entryPath),
};
for (const [path, data] of shipped) entries[`files/${path}`] = new Uint8Array(data);
for (const [path, data] of modules) entries[`src/${path}`] = new Uint8Array(data);
if (seedPath) {
  const seed = readFileSync(at(seedPath), "utf8");
  JSON.parse(seed); // fail here, not on someone's device
  entries["seed.json"] = strToU8(seed);
}

const target = resolve(existsSync(resolve(here, sourcePath)) ? here : there, out ?? `${basename(sourcePath).replace(/\.app\.[jt]sx?$|\.[jt]sx?$/, "")}.potyro-app.zip`);
writeFileSync(target, zipSync(entries));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
console.log(`${relative(process.cwd(), target)}: the app, ${plural(modules.size, "module")} and ${plural(shipped.size, "file")}${seedPath ? ", with a seed" : ""}`);
