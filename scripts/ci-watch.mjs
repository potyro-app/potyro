#!/usr/bin/env node
// Keeps apps.vaz.io on main, on the CI machine (vazio), from cron — GitHub Actions is unavailable,
// so nothing else would. Each tick:
//
//   1. fetch origin/main and check it out (this checkout is the watcher's own — never a working one)
//   2. run the full local CI on it and post `local-ci` on the commit
//   3. green → `ci-local.mjs deploy`; red → leave the site on the last green commit
//
// A run that is cut short (the machine slept, another checkout's suite held the test ports) resumes
// on the next tick: ci-local records every step per commit. A commit that finished — green or red —
// is not run again; a green one is still re-checked for being live, which is one rsync of a
// small file. See docs/16 §8 for the cron line, the key, and the ssh alias.

import { spawnSync, execSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
const say = (msg) => process.stdout.write(`${new Date().toISOString()} ${msg}\n`);
/** Run a ci-local command from the checked-out commit (a fresh process reads the new code). */
const ciLocal = (...args) => spawnSync("node", ["scripts/ci-local.mjs", ...args], { cwd: ROOT, stdio: "inherit" }).status;

if (sh("git status --porcelain --untracked-files=no") !== "") {
  say("✘ this checkout has tracked changes — it is the watcher's own; reset it by hand");
  process.exit(2);
}
sh("git fetch -q origin main");
const main = sh("git rev-parse origin/main");
if (sh("git rev-parse HEAD") !== main) sh(`git checkout -q --detach ${main}`);
const short = main.slice(0, 7);
const dir = join(ROOT, ".ci-local", main);
const finished = join(dir, "watch.done");

const green = () => ciLocal("status") === 0;
const red = () => existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".fail") && !f.startsWith("deploy"));

if (existsSync(finished)) {
  // Already judged. Green: make sure it is what is live (a deploy may have failed on the network).
  if (green()) process.exit(ciLocal("deploy"));
  process.exit(0);
}

say(`▶ ${short}: local CI`);
ciLocal("all", "--post");
if (green()) {
  writeFileSync(finished, "green\n");
  say(`✓ ${short} green — deploying`);
  process.exit(ciLocal("deploy"));
}
if (red()) {
  writeFileSync(finished, "red\n");
  say(`✘ ${short} red — apps.vaz.io stays on the last green commit`);
  process.exit(1);
}
say(`· ${short} incomplete — resumes on the next tick`);
