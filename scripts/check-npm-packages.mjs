#!/usr/bin/env node
// What npm would receive for `potyro` and `create-potyro`, checked before anyone publishes.
//
//   node scripts/check-npm-packages.mjs [--out <dir>]     pack both, check the manifests and the file lists
//   node scripts/check-npm-packages.mjs --install         … then prove the flow from the tarballs alone:
//                                                         create a project, install, typecheck, test, pack
//   node scripts/check-npm-packages.mjs --guard           (a package's prepublishOnly) refuse plain `npm publish`
//
// The tarballs are made by `pnpm pack`, never `npm pack`: only pnpm applies `publishConfig.exports`
// (dist/ in place of src/) and writes a version where the workspace says `workspace:*`. A tarball
// made by npm in the package's folder installs and then fails on the first import.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY = "https://github.com/potyro-app/potyro";
const PACKAGES = [
  {
    dir: "packages/schema",
    name: "potyro",
    license: "Apache-2.0",
    needs: ["LICENSE", "README.md", "package.json", "bin/potyro.mjs", "cli/pack.mjs", "dist/index.js", "dist/index.d.ts"],
  },
  {
    dir: "packages/create-potyro",
    name: "create-potyro",
    license: "Apache-2.0 AND MIT-0",
    needs: ["LICENSE", "README.md", "package.json", "bin/create-potyro.mjs", "index.mjs", "template/package.json", "template/_gitignore", "template/__NAME__.app.ts"],
  },
];
/** Nothing of these belongs in a tarball: tests of ours, sources, maps, a device's own files. */
const UNWANTED = [/^src\//, /^test\//, /\.test\.[cm]?[jt]sx?$/, /\.map$/, /(^|\/)\.env/, /(^|\/)node_modules\//, /\.tsbuildinfo$/, /(^|\/)\.scaffold-/];
/** The template's own test is the one test that ships: it is the new project's. */
const WANTED_ANYWAY = new Set(["template/test/app.test.ts"]);

const args = process.argv.slice(2);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const sh = (cmd, argv, cwd) => execFileSync(cmd, argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });

if (args.includes("--guard")) {
  if (!(process.env.npm_config_user_agent ?? "").startsWith("pnpm")) {
    console.error("Do not `npm publish` in this folder: npm would publish src/ as the entry and `workspace:*` as a version.\nPublish the tarball `pnpm check:npm` makes, or use `pnpm publish` (CONTRIBUTING.md, Publishing the npm packages).");
    process.exit(1);
  }
  process.exit(0);
}

const o = args.indexOf("--out");
const out = o >= 0 ? resolve(args[o + 1]) : mkdtempSync(join(tmpdir(), "potyro-npm-"));
mkdirSync(out, { recursive: true });

const problems = [];
const tarballs = {};
for (const pkg of PACKAGES) {
  sh(pnpm, ["pack", "--pack-destination", out], join(ROOT, pkg.dir));
  const version = JSON.parse(readFileSync(join(ROOT, pkg.dir, "package.json"), "utf8")).version;
  const tgz = join(out, `${pkg.name}-${version}.tgz`);
  tarballs[pkg.name] = tgz;
  const files = sh("tar", ["tzf", tgz]).split("\n").filter(Boolean).map((f) => f.replace(/^package\//, ""));
  const text = sh("tar", ["xzOf", tgz, "package/package.json"]);
  const manifest = JSON.parse(text);
  const bad = (what) => problems.push(`${pkg.name}: ${what}`);

  if (manifest.name !== pkg.name) bad(`is named ${manifest.name}`);
  if (manifest.private) bad("is private");
  if (text.includes("workspace:")) bad("the packed manifest has a workspace: version");
  if (manifest.license !== pkg.license) bad(`license is ${JSON.stringify(manifest.license)}, expected ${JSON.stringify(pkg.license)}`);
  if (manifest.repository?.url !== `git+${REPOSITORY}.git`) bad(`repository.url is ${JSON.stringify(manifest.repository?.url)}`);
  if (manifest.repository?.directory !== pkg.dir) bad(`repository.directory is ${JSON.stringify(manifest.repository?.directory)}`);
  if (!manifest.homepage) bad("no homepage");
  if (!manifest.bugs?.url) bad("no bugs.url");
  if (!manifest.engines?.node) bad("no engines.node");
  for (const target of Object.values(manifest.bin ?? {})) {
    if (!files.includes(target.replace(/^\.\//, ""))) bad(`bin ${target} is not in the tarball`);
  }
  const entries = JSON.stringify([manifest.exports ?? {}, manifest.types ?? "", manifest.main ?? ""]);
  if (entries.includes("src/")) bad("an entry point still names src/ (packed by npm, not pnpm?)");
  for (const entry of entries.match(/\.\/[\w./-]+/g) ?? []) {
    if (!files.includes(entry.slice(2))) bad(`entry ${entry} is not in the tarball`);
  }
  for (const need of pkg.needs) if (!files.includes(need)) bad(`${need} is missing`);
  for (const file of files) {
    if (!WANTED_ANYWAY.has(file) && UNWANTED.some((re) => re.test(file))) bad(`${file} should not ship`);
  }
  console.log(`[npm] ${pkg.name}@${version}: ${files.length} files → ${tgz}`);
}

// The two are released together: the project `create-potyro` writes asks for `potyro@^<its own version>`.
const versions = PACKAGES.map((p) => JSON.parse(readFileSync(join(ROOT, p.dir, "package.json"), "utf8")).version);
if (new Set(versions).size > 1) problems.push(`the two versions differ (${versions.join(", ")}): they are released together`);

if (problems.length) {
  console.error(problems.map((p) => `[npm] ✗ ${p}`).join("\n"));
  process.exit(1);
}

if (args.includes("--install")) {
  // No registry for our two packages: the project is created by the packed create-potyro and depends
  // on the packed potyro. (Their own dependencies still come from the registry.)
  const work = mkdtempSync(join(out, "project-"));
  const step = (label, cmd, argv, cwd) => {
    console.log(`[npm] $ ${label}`);
    try {
      const said = sh(cmd, argv, cwd).trim();
      if (said) console.log(said.split("\n").slice(-6).map((l) => `      ${l}`).join("\n"));
    } catch (e) {
      console.error(`${e.stdout ?? ""}${e.stderr ?? ""}`);
      console.error(`[npm] ✗ ${label}`);
      process.exit(1);
    }
  };
  step("npm exec --package=<create-potyro tgz> -- create-potyro my-app", npm, ["exec", "--yes", `--package=${tarballs["create-potyro"]}`, "--", "create-potyro", "my-app"], work);
  const app = join(work, "my-app");
  const manifestPath = join(app, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, devDependencies: { ...manifest.devDependencies, potyro: `file:${tarballs.potyro}` } }, null, 2));
  step("npm install   (potyro from its tarball)", npm, ["install", "--no-audit", "--no-fund"], app);
  step("npm run typecheck", npm, ["run", "typecheck"], app);
  step("npm test", npm, ["test"], app);
  step("npx potyro pack", npm, ["exec", "--", "potyro", "pack"], app);
  step("npm run build", npm, ["run", "build"], app);
  step("node -e 'import(\"potyro\")'", process.execPath, ["-e", "const m = await import('potyro'); if (typeof m.defineApp !== 'function') throw new Error('no defineApp'); console.log('defineApp is a function')", "--input-type=module"], app);
}
console.log("[npm] OK — both tarballs are what npm should get");
