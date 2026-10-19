#!/usr/bin/env node
// Which browser specs a change needs (docs/16 §8): the full suite when it touches what every spec
// boots (the shell and the packages under it), a named few when it touches one app, one surface or
// one spec, and none when it touches only words, docs or servers the browser suite never reaches.
// Every spec still runs before anything is deployed: this decides the gate for a change, not for main.
//
//   node scripts/ci-select.mjs --base <ref> --head <ref>     # prints JSON; also $GITHUB_OUTPUT
//
// Unknown paths select the full suite: a wrong "none" would let a regression through, a wrong
// "full" only costs minutes.

import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = opt("--base", "origin/main");
const head = opt("--head", "HEAD");

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
const changed = git("diff", "--name-only", `${base}...${head}`).split("\n").filter(Boolean);

/** Every spec file, with its source, so a rule can ask what a spec drives. */
function specs(dir = "e2e") {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...specs(rel));
    else if (/\.spec\.ts$/.test(name)) out.push({ path: rel, source: readFileSync(join(ROOT, rel), "utf8") });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
const ALL = specs();
const byName = (re) => ALL.filter((s) => re.test(s.path)).map((s) => s.path);
const mentioning = (re) => ALL.filter((s) => re.test(s.source)).map((s) => s.path);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Everything the browser suite boots: a change here can break any spec. */
const EVERYWHERE = /^(packages\/(shell|views|runtime|host|store|schema|i18n|capabilities|identity|share-links)\/|playwright\.config\.ts|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|vitest\.workspace\.ts|tsconfig|e2e\/[^/]+\.ts$|e2e\/fixtures\/|scripts\/ci-local\.mjs)/;
/** Nothing the browser suite can see. */
const NOWHERE = /^(docs\/|.*\.md$|brand\/|deploy\/|LICENSE|\.gitignore|\.github\/|scripts\/(ship|ci-watch|ci-select|bench-ci|pack-app)\.|packages\/(native|ai-relay)\/|.*\.generated\.ts$|e2e\/timings\.json$|\.ci-local\/)/;

/** @returns {"full" | string[]} the specs a changed path needs */
function needs(path) {
  if (NOWHERE.test(path)) return [];
  if (EVERYWHERE.test(path)) return "full";
  let m;
  if (/\.spec\.ts$/.test(path)) return [path];
  if ((m = /^apps\/([^/]+)\//.exec(path))) {
    const id = m[1];
    return [...new Set([...byName(new RegExp(`^e2e/${esc(id)}-`)), ...mentioning(new RegExp(`packApp\\(\\s*"${esc(id)}"|apps/${esc(id)}/`))])];
  }
  if ((m = /^examples\/(?:files\/)?([^/.]+)/.exec(path))) {
    const id = m[1];
    // Its own specs, the ones that open it, and the surfaces every example is on (the launcher's
    // tiles, the languages sweep, the gallery's demo links).
    return [...new Set([...byName(new RegExp(`^e2e/${esc(id)}-`)), ...mentioning(new RegExp(`[?&](user|app|data)=${esc(id)}\\b|examples/${esc(id)}\\b`)), ...byName(/^e2e\/(examples-languages|gallery|launcher\/home)-/)])];
  }
  if (/^packages\/generator\//.test(path)) return byName(/^e2e\/(studio|ask|fix|generator|create-modify|suggest-wording)-/);
  if (/^packages\/rooms\//.test(path)) return mentioning(/startRoomsRelay|routeRooms/);
  if (/^packages\/platform-requests\//.test(path)) return byName(/^e2e\/studio-platform-request-/);
  if (/^gallery\//.test(path)) return byName(/^e2e\/gallery-/);
  return "full";
}

let mode = "none";
const files = new Set();
for (const path of changed) {
  const n = needs(path);
  if (n === "full") {
    mode = "full";
    break;
  }
  for (const f of n) files.add(f);
}
if (mode !== "full" && files.size) mode = "files";
const result = { base, head, changed: changed.length, mode, files: mode === "files" ? [...files].sort() : [] };
console.log(JSON.stringify(result, null, 1));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\nfiles=${result.files.join(" ")}\n`);
