#!/usr/bin/env node
// Merge a PR the gated way (docs/16 §8): run the ship gate (.github/workflows/ship.yml) on the PR's
// head — the checks, and the browser specs the change needs — and merge only when it is green. Main
// then runs the whole suite once more and deploys potyro.app (the same workflow, on push).
//
//   pnpm ship <pr-number>
//
// The PR must build on main as it is now, so what the gate tested is what main becomes: rebase and
// push first if it does not. A red run merges nothing; fix, push the branch, ship again.
import { execSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
const say = (s) => process.stdout.write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pr = process.argv[2];
if (!/^\d+$/.test(pr ?? "")) {
  console.error("usage: pnpm ship <pr-number>");
  process.exit(2);
}
const info = JSON.parse(sh(`gh pr view ${pr} --json headRefName,headRefOid,title,state,baseRefName`));
if (info.state !== "OPEN" || info.baseRefName !== "main") {
  console.error(`✘ PR #${pr} is ${info.state.toLowerCase()} against ${info.baseRefName} — only an open PR into main ships`);
  process.exit(2);
}
sh("git fetch -q origin main");
sh(`git fetch -q origin ${info.headRefName}`);
const head = sh(`git rev-parse origin/${info.headRefName}`);
if (head !== info.headRefOid) {
  console.error(`✘ origin/${info.headRefName} is not the PR's head — push the branch first`);
  process.exit(2);
}
if (sh(`git merge-base --is-ancestor origin/main ${head} && echo yes || echo no`) !== "yes") {
  console.error(`✘ ${head.slice(0, 7)} does not build on main (${sh("git rev-parse --short origin/main")}) — rebase onto origin/main, push, and ship again`);
  process.exit(2);
}

// Start the gate on the head, then find the run it started: the one on this branch made after now.
const since = new Date(Date.now() - 5_000).toISOString();
say(`▶ #${pr} ${head.slice(0, 7)}: the ship gate on ${info.headRefName}`);
sh(`gh workflow run ship.yml --ref ${info.headRefName}`);
let run = null;
for (let tries = 0; !run && tries < 30; tries++) {
  await sleep(4_000);
  const runs = JSON.parse(sh(`gh run list --workflow=ship.yml --branch=${info.headRefName} --event=workflow_dispatch --json databaseId,createdAt,headSha -L 5`));
  run = runs.find((r) => r.createdAt >= since && r.headSha === head) ?? null;
}
if (!run) {
  console.error("✘ the gate did not start (gh run list shows no new run) — is ship.yml on main?");
  process.exit(1);
}
say(`   run ${run.databaseId} — ${sh(`gh run view ${run.databaseId} --json url -q .url`)}`);
try {
  execSync(`gh run watch ${run.databaseId} --exit-status --interval 20`, { cwd: ROOT, stdio: "inherit" });
} catch {
  console.error(`✘ ${head.slice(0, 7)} red — not merged; main stays where it is`);
  process.exit(1);
}
say(`✓ ${head.slice(0, 7)} green — merging #${pr}`);
sh(`gh pr merge ${pr} --merge --match-head-commit ${head} --subject ${JSON.stringify(`Merge pull request #${pr} from fuzue/${info.headRefName}`)} --body ${JSON.stringify(info.title)}`);
say("   main runs the whole suite once more and deploys potyro.app: gh run list --workflow=ship.yml --branch=main");
