#!/usr/bin/env node
// Local CI: the same checks as .github/workflows/ci.yml, run on this machine, and able to put the
// result on the commit as a GitHub status — which needs no Actions minutes.
//
//   node scripts/ci-local.mjs all              every step, in order (run it in a terminal)
//   node scripts/ci-local.mjs <step>           one step: install build unit typecheck lint e2e:1..N
//   node scripts/ci-local.mjs status           what has passed for HEAD, and what is left
//   node scripts/ci-local.mjs status --post    ...and, if everything passed, mark HEAD green on GitHub
//
// Why steps and not one command: the full run takes longer than one sitting of most tools, and a
// machine short on memory kills long processes. Each step records its result under
// `.ci-local/<sha>/`, so a run that is interrupted resumes where it stopped, and a result can never
// be attributed to a commit it was not run on.
//
// What differs from GitHub's run, on purpose:
//   - The browser suite is split into shards run one after another, one worker each — the suite
//     shares a relay and browser storage, and this machine cannot hold it all at once.
//   - The pixel baselines are skipped: they are GitHub's runner's pixels, and font hinting on any
//     other Linux box differs by a few hundred pixels. Regenerate them on GitHub when it is back.
//   - Flaky tests get one retry, as they do on GitHub.

import { spawnSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, createWriteStream } from "node:fs";
import { join, relative } from "node:path";
import { createConnection } from "node:net";

const ROOT = new URL("..", import.meta.url).pathname;
const SHARDS = Number(process.env.CI_LOCAL_SHARDS ?? 5);
const STEPS = ["install", "build", "unit", "typecheck", "lint", ...Array.from({ length: SHARDS }, (_, i) => `e2e:${i + 1}`)];

const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
const sha = sh("git rev-parse HEAD");
const short = sha.slice(0, 7);
const dir = join(ROOT, ".ci-local", sha);
mkdirSync(dir, { recursive: true });

/** Tracked files changed or staged: a result must describe the commit, not an edit on top of it. */
function dirty() {
  return sh("git status --porcelain --untracked-files=no") !== "";
}

function run(label, cmd, args, env = {}) {
  const log = join(dir, `${label.replace(":", "-")}.log`);
  const out = createWriteStream(log);
  process.stdout.write(`▶ ${label}: ${[cmd, ...args].join(" ")}\n`);
  const started = Date.now();
  const res = spawnSync(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 1 << 30 });
  out.write(res.stdout ?? "");
  out.write(res.stderr ?? "");
  out.end();
  const secs = Math.round((Date.now() - started) / 1000);
  return { ok: res.status === 0, secs, log, tail: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim().split("\n").slice(-25).join("\n") };
}

function record(step, result) {
  for (const s of ["ok", "fail"]) rmSync(join(dir, `${step.replace(":", "-")}.${s}`), { force: true });
  writeFileSync(join(dir, `${step.replace(":", "-")}.${result.ok ? "ok" : "fail"}`), `${new Date().toISOString()} ${result.secs}s\n`);
  process.stdout.write(`${result.ok ? "✓" : "✘"} ${step} (${result.secs}s)  log: ${relative(ROOT, result.log)}\n`);
  if (!result.ok) process.stdout.write(`${result.tail}\n`);
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });
}

/** Every browser spec file the trusted and sandbox projects run, minus the GitHub-only baselines. */
function specFiles() {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/(trusted|sandbox)\.spec\.ts$/.test(e.name) && !e.name.startsWith("_") && !e.name.startsWith("baselines")) out.push(p);
    }
  };
  walk("e2e");
  return out.sort();
}

async function step(name) {
  if (dirty()) {
    console.error(`✘ refusing to run: tracked files are modified, so a result would not describe ${short}. Commit or stash them first.`);
    process.exit(2);
  }
  switch (name) {
    case "install":
      return record(name, run(name, "pnpm", ["install", "--frozen-lockfile"]));
    case "build":
      return record(name, run(name, "pnpm", ["-r", "build"]));
    case "unit":
      return record(name, run(name, "pnpm", ["-r", "test"]));
    case "typecheck":
      return record(name, run(name, "pnpm", ["typecheck"]));
    case "lint": {
      const a = run("lint-boundaries", "pnpm", ["lint:boundaries"]);
      const b = run("lint-tokens", "pnpm", ["lint:tokens"]);
      return record(name, { ok: a.ok && b.ok, secs: a.secs + b.secs, log: a.ok ? b.log : a.log, tail: a.ok ? b.tail : a.tail });
    }
    default: {
      const m = /^e2e:(\d+)$/.exec(name);
      if (!m) throw new Error(`unknown step "${name}" — one of: ${STEPS.join(" ")}`);
      // Playwright reuses a server already listening on a test port. One started from ANOTHER
      // checkout would be tested in place of this one, and pass or fail for the wrong code.
      for (const port of [4188, 4189, 4201]) {
        if (await portInUse(port)) {
          console.error(`✘ port ${port} is already in use — stop whatever is listening (lsof -i :${port}) so the suite starts its own servers from this checkout.`);
          process.exit(2);
        }
      }
      const i = Number(m[1]);
      const files = specFiles().filter((_, n) => n % SHARDS === i - 1);
      return record(name, run(name, "pnpm", ["exec", "playwright", "test", ...files, "--workers=1", "--retries=1", "--reporter=line"]));
    }
  }
}

function status(post) {
  const done = STEPS.map((s) => {
    const f = s.replace(":", "-");
    return { s, state: existsSync(join(dir, `${f}.ok`)) ? "ok" : existsSync(join(dir, `${f}.fail`)) ? "fail" : "todo" };
  });
  for (const d of done) process.stdout.write(`${d.state === "ok" ? "✓" : d.state === "fail" ? "✘" : "·"} ${d.s}\n`);
  const failed = done.filter((d) => d.state === "fail").map((d) => d.s);
  const todo = done.filter((d) => d.state === "todo").map((d) => d.s);
  const green = !failed.length && !todo.length;
  process.stdout.write(`\n${short}: ${green ? "GREEN" : failed.length ? `RED (${failed.join(", ")})` : `incomplete (left: ${todo.join(" ")})`}\n`);
  if (post) {
    if (dirty()) {
      console.error("✘ not posting: tracked files are modified.");
      process.exit(2);
    }
    if (!green && !failed.length) {
      console.error("✘ not posting: the run is incomplete.");
      process.exit(2);
    }
    const state = green ? "success" : "failure";
    const description = green ? `all ${STEPS.length} steps passed locally` : `failed: ${failed.join(", ")}`;
    const remote = sh("gh repo view --json nameWithOwner --jq .nameWithOwner");
    execSync(`gh api -X POST repos/${remote}/statuses/${sha} -f state=${state} -f context=local-ci -f description=${JSON.stringify(description)}`, { cwd: ROOT, stdio: "inherit" });
    process.stdout.write(`posted local-ci: ${state} on ${short}\n`);
  }
  return green;
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "status") {
  process.exit(status(rest.includes("--post")) ? 0 : 1);
} else if (cmd === "all") {
  for (const s of STEPS) {
    const f = s.replace(":", "-");
    if (existsSync(join(dir, `${f}.ok`)) && !rest.includes("--fresh")) {
      process.stdout.write(`✓ ${s} (already passed for ${short})\n`);
      continue;
    }
    await step(s);
    if (existsSync(join(dir, `${f}.fail`))) break;
  }
  process.exit(status(rest.includes("--post")) ? 0 : 1);
} else {
  await step(cmd);
  process.exit(existsSync(join(dir, `${cmd.replace(":", "-")}.ok`)) ? 0 : 1);
}
