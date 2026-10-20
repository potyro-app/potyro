#!/usr/bin/env node
// Refresh e2e/timings.json — the durations the shard plan deals files by — from a ship-gate run's
// own measurements (docs/16 §8): every shard uploads what its files took on the runner, and this
// folds them in. Run it after a full run on main, commit the file.
//
//   node scripts/ci-timings.mjs <run-id>      (`gh run list --workflow=ship.yml --branch main`)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SEED = join(ROOT, "e2e", "timings.json");
const run = process.argv[2];
if (!/^\d+$/.test(run ?? "")) {
  console.error("usage: node scripts/ci-timings.mjs <run-id>");
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), "potyro-timings-"));
try {
  execFileSync("gh", ["run", "download", run, "--pattern", "timings-*", "-D", dir], { stdio: ["ignore", "ignore", "inherit"] });
  const before = JSON.parse(readFileSync(SEED, "utf8"));
  const after = { ...before };
  let files = 0;
  for (const shard of readdirSync(dir)) {
    const got = JSON.parse(readFileSync(join(dir, shard, "e2e-timings.json"), "utf8"));
    for (const [file, secs] of Object.entries(got)) {
      if (!file.startsWith("e2e/")) continue; // Chromium's only; Firefox keeps its own (`ff:`)
      after[file] = secs;
      files++;
    }
  }
  if (!files) throw new Error("no timings in that run's artifacts (did its shards upload them?)");
  writeFileSync(SEED, `${JSON.stringify(Object.fromEntries(Object.entries(after).sort()), null, 1)}\n`);
  const sum = (t) => Object.entries(t).filter(([k]) => k.startsWith("e2e/")).reduce((a, [, v]) => a + v, 0);
  console.log(`${files} files from ${readdirSync(dir).length} shards: Chromium total ${Math.round(sum(before))}s → ${Math.round(sum(after))}s, written to e2e/timings.json`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
