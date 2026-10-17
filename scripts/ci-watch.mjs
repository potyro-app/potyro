#!/usr/bin/env node
// Keeps main green and potyro.app on it, on the CI machine (vazio) — GitHub Actions is
// unavailable, so nothing else would. Two ways in (docs/16 §8):
//
//   node scripts/ci-watch.mjs gate <sha>   a push to vazio's bare repo (its post-receive hook).
//                                          CI runs BEFORE main moves: green → pushed to GitHub's
//                                          main and deployed; red → GitHub's main never sees it.
//   node scripts/ci-watch.mjs              cron, every 5 minutes: the backstop for anything merged
//                                          on GitHub. Main already moved; this runs CI on it and
//                                          deploys it when green.
//
// Both run in this checkout, which is the watcher's own and is checked out detached at whatever is
// being judged — never a working copy. A run cut short (the machine slept, no port block could be
// claimed) resumes: ci-local records every step per commit. Each browser shard claims its own block
// of ports (docs/16 §8), so another checkout's suite no longer holds this one's; the gate still
// retries for a while if no block is free, and cron simply picks it up on the next tick.

import { spawnSync, execSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BARE = process.env.POTYRO_BARE_REPO ?? join(homedir(), "appinator.git");
/** How long a gate waits for a free port block (ci-local exits 2 without one) before it gives up. */
const PORT_WAIT_MINUTES = 90;

const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
const say = (msg) => process.stdout.write(`${new Date().toISOString()} ${msg}\n`);
/** Run a ci-local command from the checked-out commit (a fresh process reads that commit's code). */
const ciLocal = (...args) => spawnSync("node", ["scripts/ci-local.mjs", ...args], { cwd: ROOT, stdio: "inherit" }).status;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const resultsOf = (sha) => join(ROOT, ".ci-local", sha);
const green = () => ciLocal("status") === 0;
const red = (sha) => existsSync(resultsOf(sha)) && readdirSync(resultsOf(sha)).some((f) => f.endsWith(".fail") && !f.startsWith("deploy"));

function checkout(sha) {
  if (sh("git status --porcelain --untracked-files=no") !== "") {
    say("✘ this checkout has tracked changes — it is the watcher's own; reset it by hand");
    process.exit(2);
  }
  if (sh("git rev-parse HEAD") !== sha) sh(`git checkout -q --detach ${sha}`);
}

/** Put vazio's bare repo back on GitHub's main, so the next push is judged against what is real. */
function resetBare(to) {
  execSync(`git update-ref refs/heads/main ${to}`, { cwd: BARE });
}

async function gate(sha) {
  const short = sha.slice(0, 7);
  sh("git fetch -q origin main");
  sh(`git fetch -q ${BARE} ${sha}`);
  const main = sh("git rev-parse origin/main");
  // pre-receive already refused this, but GitHub's main may have moved since (a merge on GitHub).
  if (sh(`git merge-base --is-ancestor ${main} ${sha} && echo yes || echo no`) !== "yes") {
    say(`✘ ${short} does not build on GitHub's main (${main.slice(0, 7)}) any more — rebase and push again`);
    resetBare(main);
    return 1;
  }
  checkout(sha);
  say(`▶ ${short}: local CI, before it reaches main`);
  for (let waited = 0; ; waited += 1) {
    ciLocal("all", "--post");
    if (green() || red(sha)) break;
    if (waited >= PORT_WAIT_MINUTES) {
      say(`✘ ${short} never got the test ports — push again when the other suite is done`);
      resetBare(main);
      return 1;
    }
    await sleep(60_000); // another checkout's suite holds the ports; try again in a minute
  }
  if (!green()) {
    say(`✘ ${short} red — not pushed to GitHub; main stays at ${main.slice(0, 7)}`);
    resetBare(main);
    return 1;
  }
  say(`✓ ${short} green — pushing to GitHub's main`);
  sh(`git push -q origin ${sha}:refs/heads/main`);
  writeFileSync(join(resultsOf(sha), "watch.done"), "green\n");
  return ciLocal("deploy");
}

/** The cron backstop: judge whatever GitHub's main is now, and deploy it when green. */
function poll() {
  sh("git fetch -q origin main");
  const main = sh("git rev-parse origin/main");
  const short = main.slice(0, 7);
  checkout(main);
  // Keep the bare repo in step with a merge made on GitHub, so pushes to vazio build on it.
  try {
    execSync(`git fetch -q ${ROOT} ${main} && git update-ref refs/heads/main ${main}`, { cwd: BARE, stdio: "ignore" });
  } catch {
    /* no bare repo on this machine: only cron is in use */
  }
  const finished = join(resultsOf(main), "watch.done");
  if (existsSync(finished)) {
    // Already judged. Green: make sure it is what is live (a deploy may have failed on the network).
    return green() ? ciLocal("deploy") : 0;
  }
  say(`▶ ${short}: local CI`);
  ciLocal("all", "--post");
  if (green()) {
    writeFileSync(finished, "green\n");
    say(`✓ ${short} green — deploying`);
    return ciLocal("deploy");
  }
  if (red(main)) {
    writeFileSync(finished, "red\n");
    say(`✘ ${short} red — potyro.app stays on the last green commit`);
    return 1;
  }
  say(`· ${short} incomplete — resumes on the next tick`);
  return 0;
}

const [mode, sha] = process.argv.slice(2);
process.exit(mode === "gate" ? await gate(sha) : poll());
