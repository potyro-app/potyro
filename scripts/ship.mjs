#!/usr/bin/env node
// Merge a PR the gated way: build its merge commit on GitHub's main and push it to vazio, which runs
// the full local CI and only then moves GitHub's main and deploys potyro.app (docs/16 §8).
//
//   pnpm ship <pr-number>
//
// The merge commit is made in a throwaway worktree, so this touches no checkout you work in. GitHub
// marks the PR merged by itself once main contains its head. A red run moves nothing; fix, push the
// branch, ship again.

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const VAZIO = process.env.POTYRO_GATE_REMOTE ?? "vazio:appinator.git";
const sh = (cmd, cwd = ROOT) => execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

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
if (sh(`git rev-parse origin/${info.headRefName}`) !== info.headRefOid) {
  console.error(`✘ origin/${info.headRefName} is not the PR's head — push the branch first`);
  process.exit(2);
}

// vazio sleeps; the laptop can wake it (docs: fast CI machine).
try {
  sh("ssh -o ConnectTimeout=6 -o BatchMode=yes vazio true");
} catch {
  process.stdout.write("vazio is asleep — waking it\n");
  sh(`${process.env.HOME}/bin/wake-vazio`);
}

const dir = mkdtempSync(join(tmpdir(), `potyro-ship-${pr}-`));
try {
  sh(`git worktree add -q --detach ${dir} origin/main`);
  // Two -m's: a subject and a body. One string with "\n" in it reaches git as a backslash and an n.
  const subject = `Merge pull request #${pr} from fuzue/${info.headRefName}`;
  sh(`git merge -q --no-ff origin/${info.headRefName} -m ${JSON.stringify(subject)} -m ${JSON.stringify(info.title)}`, dir);
  const merge = sh("git rev-parse HEAD", dir);
  process.stdout.write(`▶ #${pr} as ${merge.slice(0, 7)} → vazio\n`);
  execSync(`git push ${VAZIO} HEAD:refs/heads/main`, { cwd: dir, stdio: "inherit" });
} finally {
  execSync(`git worktree remove --force ${dir}`, { cwd: ROOT, stdio: "ignore" });
  rmSync(dir, { recursive: true, force: true });
}
