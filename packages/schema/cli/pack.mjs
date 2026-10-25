// `potyro pack` — make an app package (#253): the app's source, the files it ships with, and an
// optional seed, as one zip that Add an app installs.
//
//   potyro pack [app.ts] [file …] [--seed seed.json] [--files <dir>] [-o out.zip]
//
// Without a source it packs the one `*.app.ts` / `*.app.tsx` in the current folder. Every `file`
// ships at the top of the app's folder under its own name; `--files <dir>` ships a whole folder,
// keeping its sub-folders. Those are DATA, read at run time with `ctx.files`. The app's translations,
// `locales/*.po` beside the source, always ship (docs/30).
//
// The modules the source imports (`./plan.ts`, and what they import in turn) are CODE (#258): they go
// in the package's `src/`, by their path from the source's folder, and the shell's bundler resolves
// `./plan.ts` from there. Only what the app really runs is packed — esbuild walks the imports, so a
// type-only import adds nothing — and an import that leaves the source's folder is refused. The format
// is `potyro-app/1` (packages/store/src/app-package.ts); packages/store/test/app-package.test.ts packs
// with this and reads the zip back with the real reader, so the two cannot drift apart.
//
// This file runs on the author's machine, in this repo (scripts/pack-app.mjs) and from npm alike: it
// needs nothing but the `potyro` package it ships in and its own dependencies.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { zipSync, strToU8 } from "fflate";

const USAGE = "usage: potyro pack [app.ts] [file …] [--seed seed.json] [--files <dir>] [-o out.zip]";

/** What the shell provides, and libraries by URL (#266): never part of the package's own modules. */
const PROVIDED = ["potyro", "karta", "react", "react/*", "https://*", "http://*"];

/** This package's own entry: what `import … from "potyro"` means while the app's top level is read. */
const potyroEntry = () => createRequire(import.meta.url).resolve("potyro");

class PackError extends Error {}

/**
 * Pack an app. `argv` is the command's arguments; `cwd` is where its paths are relative to, with
 * `fallbackCwd` tried when a path is not there (`pnpm pack:app` runs from the repo root and names the
 * caller's folder in INIT_CWD). Returns the zip's path; throws a PackError with the reason.
 */
export async function pack(argv, { cwd = process.cwd(), fallbackCwd = cwd, log = console.log, warn = console.warn } = {}) {
  const at = (p) => (existsSync(resolve(cwd, p)) ? resolve(cwd, p) : resolve(fallbackCwd, p));
  const args = [...argv];
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (v === undefined || v.startsWith("-")) throw new PackError(`${flag} needs a value\n${USAGE}`);
    args.splice(i, 2);
    return v;
  };
  const seedPath = take("--seed");
  const filesDir = take("--files");
  const out = take("-o") ?? take("--out");
  const unknown = args.find((a) => a.startsWith("-"));
  if (unknown) throw new PackError(`unknown option ${unknown}\n${USAGE}`);
  let [sourcePath, ...loose] = args;
  if (!sourcePath || !/\.[jt]sx?$/i.test(sourcePath)) {
    if (sourcePath) loose.unshift(sourcePath);
    sourcePath = findSource(cwd);
  }

  const entryPath = at(sourcePath);
  if (!existsSync(entryPath)) throw new PackError(`${sourcePath} does not exist`);
  const sourceName = /x$/i.test(sourcePath) ? "app.tsx" : "app.ts";

  const shipped = new Map();
  for (const f of loose) {
    if (!existsSync(at(f))) throw new PackError(`${f} does not exist`);
    shipped.set(basename(f), readFileSync(at(f)));
  }
  if (filesDir) {
    const root = at(filesDir);
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new PackError(`--files ${filesDir} is not a folder`);
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else shipped.set(relative(root, full).split(sep).join("/"), readFileSync(full));
      }
    };
    walk(root);
  }

  // The app's translations (docs/30): every `locales/<lang>.po` beside the source travels with it, as
  // `locales/<lang>.po` in its folder, where the shell reads them when the app opens. No flag to forget.
  const locales = join(dirname(entryPath), "locales");
  if (existsSync(locales)) for (const name of readdirSync(locales)) if (name.endsWith(".po")) shipped.set(`locales/${name}`, readFileSync(join(locales, name)));

  let modules;
  try {
    modules = await modulesOf(entryPath);
  } catch (e) {
    throw new PackError(e?.errors?.[0]?.text ?? e?.message ?? String(e));
  }

  const declared = await declarationOf(entryPath, warn);

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
    if (!existsSync(at(seedPath))) throw new PackError(`--seed ${seedPath} does not exist`);
    const seed = readFileSync(at(seedPath), "utf8");
    try {
      JSON.parse(seed); // fail here, not on someone's device
    } catch (e) {
      throw new PackError(`--seed ${seedPath} is not JSON: ${e.message}`);
    }
    entries["seed.json"] = strToU8(seed);
  }

  const target = resolve(existsSync(resolve(cwd, sourcePath)) ? cwd : fallbackCwd, out ?? `${basename(sourcePath).replace(/\.app\.[jt]sx?$|\.[jt]sx?$/, "")}.potyro-app.zip`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, zipSync(entries));
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  log(`${relative(cwd, target)}: the app, ${plural(modules.size, "module")} and ${plural(shipped.size, "file")}${seedPath ? ", with a seed" : ""}`);
  return target;
}

/** The one app source in `dir`, when the command names none. */
function findSource(dir) {
  const found = readdirSync(dir).filter((n) => /\.app\.[jt]sx?$/i.test(n));
  if (found.length === 1) return found[0];
  if (!found.length) throw new PackError(`no app here: name the app's source, or run this beside a *.app.ts file\n${USAGE}`);
  throw new PackError(`more than one app here (${found.join(", ")}): name the one to pack\n${USAGE}`);
}

/** The source's own modules, by path from its folder: every local file the bundle would pull in. */
async function modulesOf(entry) {
  const root = dirname(entry);
  const { metafile } = await build({
    entryPoints: [entry],
    absWorkingDir: root,
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    jsx: "automatic",
    logLevel: "silent",
    external: PROVIDED,
  });
  const modules = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const full = resolve(root, input);
    if (full === entry) continue;
    const rel = relative(root, full);
    if (rel.startsWith("..") || rel.startsWith(sep)) throw new PackError(`${input} is outside the app's folder: a module must sit beside ${basename(entry)} or below it`);
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
 * sealed box lacks) reads fine. Libraries by URL are inert stand-ins — nothing is fetched — and so is
 * React when the app's folder does not have it. An app that cannot be read here is still packed,
 * without a declaration: the card then reads it itself.
 */
async function declarationOf(entry, warn) {
  const potyro = potyroEntry();
  const fromApp = createRequire(entry);
  const STAND_IN =
    "var h = new Proxy(function () {}, { get: function (_t, k) { if (k === Symbol.toPrimitive) return function () { return ''; }; if (k === 'then' || k === '__esModule') return undefined; return h; }, apply: function () { return h; }, construct: function () { return h; } }); module.exports = h;";
  const dir = mkdtempSync(join(tmpdir(), "potyro-pack-"));
  try {
    await build({
      stdin: {
        contents: `import app from ${JSON.stringify(entry)};\nimport { describeApp } from "potyro";\nexport default describeApp(app);\n`,
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
          name: "potyro-pack-declare",
          setup(b) {
            b.onResolve({ filter: /^(potyro|karta)$/ }, () => ({ path: potyro }));
            b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => {
              try {
                return { path: fromApp.resolve(args.path) };
              } catch {
                return { path: args.path, namespace: "stand-in" };
              }
            });
            b.onResolve({ filter: /^https?:\/\// }, (args) => ({ path: args.path, namespace: "stand-in" }));
            b.onLoad({ filter: /.*/, namespace: "stand-in" }, () => ({ contents: STAND_IN, loader: "js" }));
          },
        },
      ],
    });
    const mod = await import(pathToFileURL(join(dir, "declared.mjs")).href);
    // The real reason when it is not a declaration: "it does not export an app" only when it does not.
    const { declared, problem } = mod.default ?? {};
    if (!declared) throw new Error(problem ?? "it does not export an app (`export default defineApp({ … })`)");
    return declared;
  } catch (e) {
    const why = e?.errors?.[0]?.text ?? e?.message ?? String(e);
    // A validation error's first line is only its heading ("Invalid app definition:"): the reason is under it.
    const said = why.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" ");
    warn(`potyro pack: packed without a description of the app, so Add an app will read it from its code (${said})`);
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export { PackError, USAGE };

