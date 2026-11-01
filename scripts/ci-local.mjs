#!/usr/bin/env node
// Local CI: the same checks as .github/workflows/ci.yml, run on this machine, and able to put the
// result on the commit as a GitHub status — which needs no Actions minutes.
//
//   node scripts/ci-local.mjs all              every step, in order (run it in a terminal); the
//                                              browser shards run side by side (see below)
//   node scripts/ci-local.mjs <step>           one step: install build unit typecheck lint e2e:1..N (or ff:1..M)
//   node scripts/ci-local.mjs e2e              every browser shard not yet passed, all at once
//   node scripts/ci-local.mjs e2e:firefox      the same specs in Firefox, its shards at once — NOT part
//                                              of the gate (see below)
//   node scripts/ci-local.mjs status           what has passed for HEAD, and what is left
//   node scripts/ci-local.mjs status --post    ...and, if everything passed, mark HEAD green on GitHub
//   node scripts/ci-local.mjs deploy           put HEAD on potyro.app — only if it IS origin/main and
//                                              every step passed for it (docs/16 §8)
//
// Why steps and not one command: the full run takes longer than one sitting of most tools, and a
// machine short on memory kills long processes. Each step records its result under
// `.ci-local/<sha>/`, so a run that is interrupted resumes where it stopped, and a result can never
// be attributed to a commit it was not run on.
//
// The browser suite (93% of the wall time) is split into shards that run AT ONCE, each a whole
// copy of the suite on its own block of ports (e2e/ports.ts): its own dev servers, its own sync
// relay, and — the port being part of the origin — its own OPFS, localStorage and IndexedDB. Inside
// a shard it is still one worker, because within one origin the specs DO share state
// (playwright.config.ts says what broke at two workers). A block is claimed with a lockfile under
// /tmp/potyro-e2e-ports and bind-tested before use, so two whole runs on one machine (the gate and
// someone's manual `ci:local`) take different blocks and never meet. Files are dealt to shards by
// their last measured duration (longest first, into the lightest shard), so the shards finish
// together; the deal is frozen per commit, so a resumed shard runs the files it ran before.
// `CI_LOCAL_E2E=sequential` runs the shards one after another instead, as before (for comparison).
//
// Two suites: `e2e:<n>` is Chromium (the trusted and sandbox projects), the gate's; `ff:<n>` is the
// same specs in Firefox (trusted-firefox, sandbox-firefox: POTYRO_FIREFOX=1), the browser the owner
// uses, run by `e2e:firefox`. Each has its own shards, plan and timings. Firefox is not in `all` and
// not in `status --post`: measured on vazio (2026-10-17), the sixteen shards at once took 11.5 min
// and the CPU they fought over made Chromium's flaky; one after the other it is ~6 + ~5 min. So it is
// a step of its own, run before a merge that touches what Firefox sees, and nightly (docs/16 §8).
//
// What differs from GitHub's run, on purpose:
//   - The browser suite runs as parallel shards of one worker each (above).
//   - The pixel baselines are skipped: they are GitHub's runner's pixels, and font hinting on any
//     other Linux box differs by a few hundred pixels. Regenerate them on GitHub when it is back.
//   - Flaky tests get one retry, as they do on GitHub.

import { spawn, spawnSync, execSync } from "node:child_process";
import { createWriteStream, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createConnection, createServer } from "node:net";

const ROOT = new URL("..", import.meta.url).pathname;
const SHARDS = Number(process.env.CI_LOCAL_SHARDS ?? 8);
/** Firefox's shards (`e2e:firefox`). */
const FF_SHARDS = Number(process.env.CI_LOCAL_FF_SHARDS ?? 8);
/**
 * The browser suites: which Playwright projects a shard runs, with what in its environment. Projects
 * are named, not left to the config's defaults, so a POTYRO_* variable in the caller's environment
 * cannot quietly add an engine to a shard.
 */
const SUITES = {
  e2e: { shards: SHARDS, projects: ["trusted", "sandbox"], env: {} },
  ff: { shards: FF_SHARDS, projects: ["trusted-firefox", "sandbox-firefox"], env: { POTYRO_FIREFOX: "1" } },
};
const shardSteps = (suite) => Array.from({ length: SUITES[suite].shards }, (_, i) => `${suite}:${i + 1}`);
/** `sequential`: the browser shards one after another, the way this ran before they were isolated. */
const E2E_MODE = process.env.CI_LOCAL_E2E === "sequential" ? "sequential" : "parallel";
/** Keep in step with PORT_BLOCK in e2e/ports.ts. */
const PORT_BLOCK = 10;
/**
 * Where blocks are claimed: below Linux's ephemeral range (32768+), so a port a spec asks the OS for
 * (`freePort()`) can never land inside a block, and well away from the suite's own defaults (4188…).
 */
const BLOCK_FIRST = 20_000;
const BLOCK_LAST = 32_000;
const CLAIMS = "/tmp/potyro-e2e-ports";
/** Each spec file's last duration in seconds, kept across commits (gitignored, like every result). */
const TIMINGS = join(ROOT, ".ci-local", "e2e-timings.json");
const SEED_TIMINGS = join(ROOT, "e2e", "timings.json");
const STEPS = ["install", "build", "unit", "typecheck", "lint", ...shardSteps("e2e")];
/** Firefox's steps: recorded like the gate's, reported beside them, never part of its verdict. */
const FF_STEPS = shardSteps("ff");

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
  process.stdout.write(`▶ ${label}: ${[cmd, ...args].join(" ")}\n`);
  const started = Date.now();
  const res = spawnSync(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 1 << 30 });
  // Synchronously: the script exits right after, and a stream would be cut off before it flushed.
  writeFileSync(log, `$ ${[cmd, ...args].join(" ")}\n${res.stdout ?? ""}${res.stderr ?? ""}`);
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

/** Whether this process could listen on `port` right now (on both loopbacks Vite and the relay use). */
function canBind(port, host) {
  return new Promise((resolve) => {
    const server = createServer();
    // No such loopback on this machine (no IPv6): nothing there to collide with.
    server.once("error", (e) => resolve(e.code === "EADDRNOTAVAIL" || e.code === "EAFNOSUPPORT"));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

async function blockFree(base) {
  for (let port = base; port < base + PORT_BLOCK; port++) {
    if (await portInUse(port)) return false;
    if (!(await canBind(port, "127.0.0.1")) || !(await canBind(port, "::1"))) return false;
  }
  return true;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

const claimed = new Set();
process.on("exit", () => {
  for (const f of claimed) rmSync(f, { force: true });
});
/**
 * Running shards' process groups, and the mark every process a shard starts carries in its
 * environment (`POTYRO_E2E_SHARD`). Playwright starts its dev servers and relay detached, in process
 * groups of their own, and does not always take them down when it is stopped — measured: they
 * outlived it, listening on ports nobody held a claim to any more. So when a shard ends, for any
 * reason, whatever still carries its mark is killed (`sweep`, by /proc, so Linux only — the CI
 * machine). Stopping this script sends the shards SIGINT, waits for them, then sweeps.
 */
const shardGroups = new Map(); // pid → mark
const SHUTDOWN_GRACE_MS = 20_000;
let stopping = false;
function stopShards() {
  if (stopping) return;
  stopping = true;
  if (!shardGroups.size) process.exit(130);
  for (const pid of shardGroups.keys()) signalGroup(pid, "SIGINT");
  setTimeout(() => {
    for (const [pid, mark] of shardGroups) (signalGroup(pid, "SIGKILL"), sweep(mark));
    process.exit(130);
  }, SHUTDOWN_GRACE_MS).unref();
}
function signalGroup(pid, sig) {
  try {
    process.kill(-pid, sig);
  } catch {
    /* already gone */
  }
}
/** Kill every process whose environment carries `POTYRO_E2E_SHARD=<mark>`. */
function sweep(mark) {
  const needle = `POTYRO_E2E_SHARD=${mark}\0`;
  let pids;
  try {
    pids = readdirSync("/proc").filter((d) => /^\d+$/.test(d) && Number(d) !== process.pid);
  } catch {
    return; // no /proc: not Linux
  }
  for (const pid of pids) {
    try {
      if (`${readFileSync(`/proc/${pid}/environ`, "latin1")}\0`.includes(needle)) process.kill(Number(pid), "SIGKILL");
    } catch {
      /* gone, or not ours to read */
    }
  }
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, stopShards);
process.on("exit", () => {
  for (const [pid, mark] of shardGroups) (signalGroup(pid, "SIGKILL"), sweep(mark));
});

/**
 * Claim a block of PORT_BLOCK ports for one shard: a lockfile naming this process (`wx`, so two
 * claimers can never both win), then every port bind-tested. A claim whose process is gone is stale
 * and taken over. Released when the shard ends, or when this process exits short of SIGKILL — and
 * a SIGKILLed one's claims are stale by the next claim.
 */
async function claimBlock() {
  mkdirSync(CLAIMS, { recursive: true });
  const mine = `${process.pid} ${ROOT}\n`;
  for (let base = BLOCK_FIRST; base + PORT_BLOCK <= BLOCK_LAST; base += PORT_BLOCK) {
    const lock = join(CLAIMS, `${base}.lock`);
    try {
      writeFileSync(lock, mine, { flag: "wx" });
    } catch {
      let pid = 0;
      try {
        pid = Number(readFileSync(lock, "utf8").split(" ")[0]);
      } catch {
        continue; // released while we looked: the next pass may have it, the next block will do
      }
      if (pid && alive(pid)) continue;
      // Stale: its owner is gone. Moved aside rather than deleted, and only if what was moved is
      // still the dead owner's — between our read and now another claimer may have done the same and
      // claimed it, and deleting by name would delete THEIR claim.
      const aside = `${lock}.${process.pid}.stale`;
      try {
        renameSync(lock, aside);
      } catch {
        continue;
      }
      if (Number(readFileSync(aside, "utf8").split(" ")[0]) !== pid) {
        try {
          linkSync(aside, lock); // put theirs back (never over a newer one)
        } catch {
          /* a newer claim is there: it stands */
        }
        rmSync(aside, { force: true });
        continue;
      }
      rmSync(aside, { force: true });
      try {
        writeFileSync(lock, mine, { flag: "wx" });
      } catch {
        continue; // someone else took it over first
      }
    }
    if (await blockFree(base)) {
      claimed.add(lock);
      return { base, release: () => (rmSync(lock, { force: true }), claimed.delete(lock)) };
    }
    rmSync(lock, { force: true }); // something not ours is listening in it: try the next
  }
  console.error(`✘ no free block of ${PORT_BLOCK} ports in ${BLOCK_FIRST}..${BLOCK_LAST} — see ${CLAIMS}`);
  process.exit(2);
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

const readJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return {};
  }
};

/**
 * Each file's last duration: this checkout's own measurements over the committed seed
 * (`e2e/timings.json`, measured on vazio), so even a fresh clone's first run is balanced. A suite
 * other than Chromium's keys its files with its own prefix (`ff:e2e/…`): Firefox's durations differ.
 */
function readTimings(suite) {
  const all = { ...readJson(SEED_TIMINGS), ...readJson(TIMINGS) };
  const key = timingKey(suite);
  return Object.fromEntries(specFiles().map((f) => [f, all[key(f)]]).filter(([, t]) => typeof t === "number"));
}
const timingKey = (suite) => (suite === "e2e" ? (f) => f : (f) => `${suite}:${f}`);

/**
 * Which files each shard runs, decided once per commit and kept in `e2e-plan.json` — a shard that
 * is re-run (resumed, or retried by hand) must run the files it ran the first time, or some files
 * would run twice and others never. Longest first into the lightest shard, by each file's last
 * duration; a file never timed counts as the median. With no timings at all, by index.
 */
function shardPlan(suite) {
  const SHARDS = SUITES[suite].shards;
  const planFile = join(dir, `${suite}-plan.json`);
  const files = specFiles();
  try {
    const plan = JSON.parse(readFileSync(planFile, "utf8"));
    if (plan.length === SHARDS && plan.flat().sort().join("\n") === files.join("\n")) return plan;
  } catch {
    /* none yet */
  }
  // A new deal: any shard result already here was for other files (CI_LOCAL_SHARDS changed, or a
  // result from before plans were kept), so it describes nothing any more.
  for (const f of readdirSync(dir)) if (new RegExp(`^${suite}-\\d+\\.(ok|fail)$`).test(f)) rmSync(join(dir, f), { force: true });
  const timings = readTimings(suite);
  const known = files.map((f) => timings[f]).filter((t) => typeof t === "number").sort((a, b) => a - b);
  let plan;
  if (!known.length) {
    plan = Array.from({ length: SHARDS }, (_, i) => files.filter((_, n) => n % SHARDS === i));
  } else {
    const median = known[Math.floor(known.length / 2)];
    const cost = (f) => (typeof timings[f] === "number" ? timings[f] : median);
    const shards = Array.from({ length: SHARDS }, () => ({ files: [], total: 0 }));
    for (const f of [...files].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b))) {
      const lightest = shards.reduce((min, sh) => (sh.total < min.total ? sh : min));
      lightest.files.push(f);
      lightest.total += cost(f);
    }
    plan = shards.map((sh) => sh.files.sort());
    process.stdout.write(`· ${suite} shards by measured duration: ${shards.map((sh) => `${Math.round(sh.total)}s`).join(" ")}\n`);
  }
  writeFileSync(planFile, `${JSON.stringify(plan, null, 1)}\n`);
  return plan;
}

/** Fold a shard's Playwright JSON report into the timings: each file's total, retries included. */
function learnTimings(report, suite) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(report, "utf8"));
  } catch {
    return;
  }
  const perFile = {};
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const file = join("e2e", spec.file ?? suite.file);
      for (const t of spec.tests ?? []) for (const r of t.results ?? []) perFile[file] = (perFile[file] ?? 0) + (r.duration ?? 0) / 1000;
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of parsed.suites ?? []) walk(suite);
  if (!Object.keys(perFile).length) return;
  const timings = readJson(TIMINGS);
  const key = timingKey(suite);
  for (const [f, secs] of Object.entries(perFile)) timings[key(f)] = Math.round(secs * 10) / 10;
  writeFileSync(TIMINGS, `${JSON.stringify(Object.fromEntries(Object.entries(timings).sort()), null, 1)}\n`);
}

/** One shard, as a child process with its own port block, log and Playwright output directory. */
async function runShard(suite, i, files) {
  const label = `${suite}:${i}`;
  const f = `${suite}-${i}`;
  const { projects, env: suiteEnv } = SUITES[suite];
  const log = join(dir, `${f}.log`);
  const report = join(dir, `${f}.json`);
  rmSync(report, { force: true });
  const block = await claimBlock();
  const mark = `${process.pid}-${i}-${block.base}`;
  const out = suite === "e2e" ? `shard-${i}` : `${suite}-shard-${i}`;
  const args = ["exec", "playwright", "test", ...files, ...projects.map((p) => `--project=${p}`), "--workers=1", "--retries=1", "--reporter=line,json", `--output=test-results/${out}`];
  const env = {
    ...process.env,
    ...suiteEnv,
    POTYRO_E2E_PORT_BASE: String(block.base),
    POTYRO_E2E_SHARD: mark,
    // Its own Vite dependency cache, by shard number so it stays warm from one run to the next.
    POTYRO_VITE_CACHE_DIR: join(ROOT, "node_modules", ".vite-e2e", out),
    PLAYWRIGHT_JSON_OUTPUT_NAME: report,
  };
  process.stdout.write(`▶ ${label}: ${files.length} files on ports ${block.base}..${block.base + PORT_BLOCK - 1}\n`);
  const started = Date.now();
  const logFile = createWriteStream(log);
  logFile.write(`$ ${Object.entries(suiteEnv).map(([k, v]) => `${k}=${v} `).join("")}POTYRO_E2E_PORT_BASE=${block.base} pnpm ${args.join(" ")}\n`);
  let tail = "";
  const status = await new Promise((resolve) => {
    // Its own process group, so stopping a shard reaches pnpm and Playwright at once (stopShards).
    const child = spawn("pnpm", args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const onData = (d) => {
      logFile.write(d);
      tail = (tail + d.toString()).slice(-20_000);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    shardGroups.set(child.pid, mark);
    child.once("close", (code) => {
      shardGroups.delete(child.pid);
      sweep(mark);
      if (stopping && !shardGroups.size) process.exit(130);
      resolve(code);
    });
    child.once("error", (e) => (onData(String(e)), resolve(1)));
  });
  await new Promise((r) => logFile.end(r));
  block.release();
  learnTimings(report, suite);
  const secs = Math.round((Date.now() - started) / 1000);
  return { ok: status === 0, secs, log, tail: tail.trim().split("\n").slice(-25).join("\n") };
}

function refuseDirty() {
  if (dirty()) {
    console.error(`✘ refusing to run: tracked files are modified, so a result would not describe ${short}. Commit or stash them first.`);
    process.exit(2);
  }
}

/** Every shard not yet passed (all of them with `fresh`), at once, each recorded as its own step. */
async function e2eParallel(fresh, suites = ["e2e"]) {
  refuseDirty();
  const shards = suites.flatMap((suite) => (SUITES[suite].shards ? shardPlan(suite).map((files, n) => ({ suite, i: n + 1, files })) : []));
  const todo = shards.filter(({ suite, i }) => fresh || !existsSync(join(dir, `${suite}-${i}.ok`)));
  for (const { suite, i } of shards.filter((sh) => !todo.includes(sh))) process.stdout.write(`✓ ${suite}:${i} (already passed for ${short})\n`);
  const started = Date.now();
  await Promise.all(todo.map(async ({ suite, i, files }) => record(`${suite}:${i}`, await runShard(suite, i, files))));
  if (todo.length) process.stdout.write(`· browser suites: ${todo.length} shards at once in ${Math.round((Date.now() - started) / 1000)}s\n`);
}

async function step(name) {
  refuseDirty();
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
      const results = [run("lint-boundaries", "pnpm", ["lint:boundaries"]), run("lint-tokens", "pnpm", ["lint:tokens"]), run("lint-i18n", "pnpm", ["lint:i18n"]), run("lint-docs", "pnpm", ["lint:docs"])];
      const bad = results.find((r) => !r.ok) ?? results[results.length - 1];
      return record(name, { ok: results.every((r) => r.ok), secs: results.reduce((n, r) => n + r.secs, 0), log: bad.log, tail: bad.tail });
    }
    default: {
      const m = /^(e2e|ff):(\d+)$/.exec(name);
      if (!m || Number(m[2]) < 1 || Number(m[2]) > SUITES[m[1]].shards) throw new Error(`unknown step "${name}" — one of: ${[...STEPS, ...FF_STEPS].join(" ")} e2e e2e:firefox`);
      // On its own claimed block of ports (claimBlock), so a server another checkout left listening
      // on the suite's default ports can never be tested in place of this one.
      const [suite, i] = [m[1], Number(m[2])];
      return record(name, await runShard(suite, i, shardPlan(suite)[i - 1]));
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
  firefoxStatus();
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

/** Firefox's shards, when they have run for this commit: said, never counted in the gate's verdict. */
function firefoxStatus() {
  const states = FF_STEPS.map((s) => {
    const f = s.replace(":", "-");
    return existsSync(join(dir, `${f}.ok`)) ? "ok" : existsSync(join(dir, `${f}.fail`)) ? "fail" : "todo";
  });
  if (states.every((st) => st === "todo")) return null;
  const failed = FF_STEPS.filter((_, n) => states[n] === "fail");
  const left = FF_STEPS.filter((_, n) => states[n] === "todo");
  process.stdout.write(`${short} in Firefox (not part of the gate): ${!failed.length && !left.length ? "GREEN" : failed.length ? `RED (${failed.join(", ")})` : `incomplete (left: ${left.join(" ")})`}\n`);
  return !failed.length && !left.length;
}

/**
 * Build the shell and put it live. Refuses anything but a green origin/main, so what is live is
 * always something that passed the gate — never a branch, never an edit on top of a commit.
 *
 * Where it goes is `POTYRO_DEPLOY_TARGET`: one rsync destination, or several separated by commas or
 * spaces — every site that serves the shell. The build is the same for all of them: the shell
 * finds its relay and services from its own origin. Only potyro.app is deployed (apps.vaz.io was
 * dropped 2026-10-17); the default is its ssh alias, whose key is locked to the web root by `rrsync`,
 * so the target is relative to that root (docs/16 §8). The old name, `KARTA_DEPLOY_TARGET`, is no
 * longer read: vazio's crontab sets `POTYRO_DEPLOY_TARGET`, and its value is this default anyway.
 * `version.json` in each web root names the commit it serves, and a target already serving this
 * commit is left alone.
 */
function deploy() {
  const targets = (process.env.POTYRO_DEPLOY_TARGET ?? "potyro-deploy:")
    .split(/[\s,]+/)
    .filter(Boolean);
  for (const s of ["ok", "fail"]) rmSync(join(dir, `deploy.${s}`), { force: true });
  if (dirty()) {
    console.error("✘ not deploying: tracked files are modified.");
    process.exit(2);
  }
  sh("git fetch -q origin main");
  if (sha !== sh("git rev-parse origin/main")) {
    console.error(`✘ not deploying: ${short} is not origin/main. Only main goes live.`);
    process.exit(2);
  }
  if (!status(false)) {
    console.error(`✘ not deploying: ${short} has not passed every step.`);
    process.exit(2);
  }
  const behind = targets.map((target) => ({ target, live: liveCommit(target) })).filter((t) => t.live !== sha);
  if (!behind.length) {
    process.stdout.write(`✓ ${short} is already live\n`);
    return;
  }
  const built = run("deploy-build", "pnpm", ["--filter", "@potyro/shell", "exec", "vite", "build"]);
  if (!built.ok) return record("deploy", built);
  const dist = join(ROOT, "packages/shell/dist");
  writeFileSync(join(dist, "version.json"), `${JSON.stringify({ commit: sha, deployedAt: new Date().toISOString() })}\n`);
  let failed = false;
  let last = null;
  for (const { target, live } of behind) {
    // `--delete`, or old hashed assets pile up on the server forever.
    const up = run("deploy-upload", "rsync", ["-az", "--delete", `${dist}/`, target]);
    last = up;
    if (!up.ok) {
      record("deploy", up);
      failed = true;
      continue;
    }
    if (liveCommit(target) !== sha) {
      console.error(`✘ uploaded, but ${target}version.json does not name ${short}`);
      failed = true;
      continue;
    }
    process.stdout.write(`✓ ${short} is live on ${target} (was ${live ? live.slice(0, 7) : "unknown"})\n`);
  }
  if (failed) process.exit(1);
  record("deploy", last);
  process.stdout.write(`✓ ${short} is live (was ${behind[0].live ? behind[0].live.slice(0, 7) : "unknown"})\n`);
}

/** The commit the target is serving, from its `version.json`, or null when it doesn't say. */
function liveCommit(target) {
  const tmp = join(dir, "live-version.json");
  rmSync(tmp, { force: true });
  const res = spawnSync("rsync", ["-q", `${target}version.json`, tmp], { encoding: "utf8" });
  if (res.status !== 0 || !existsSync(tmp)) return null;
  try {
    return JSON.parse(readFileSync(tmp, "utf8")).commit ?? null;
  } catch {
    return null;
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "status") {
  process.exit(status(rest.includes("--post")) ? 0 : 1);
} else if (cmd === "deploy") {
  deploy();
  process.exit(existsSync(join(dir, "deploy.fail")) ? 1 : 0);
} else if (cmd === "all") {
  const fresh = rest.includes("--fresh");
  for (const s of STEPS) {
    const f = s.replace(":", "-");
    if (existsSync(join(dir, `${f}.ok`)) && !fresh) {
      process.stdout.write(`✓ ${s} (already passed for ${short})\n`);
      continue;
    }
    if (s.startsWith("e2e:") && E2E_MODE === "parallel") {
      await e2eParallel(fresh); // every shard left, at once; status below says what passed
      break;
    }
    await step(s);
    if (existsSync(join(dir, `${f}.fail`))) break;
  }
  process.exit(status(rest.includes("--post")) ? 0 : 1);
} else if (cmd === "e2e") {
  await e2eParallel(rest.includes("--fresh"));
  process.exit(status(false) ? 0 : 1);
} else if (cmd === "e2e:firefox") {
  await e2eParallel(rest.includes("--fresh"), ["ff"]);
  process.exit(firefoxStatus() ? 0 : 1);
} else {
  await step(cmd);
  process.exit(existsSync(join(dir, `${cmd.replace(":", "-")}.ok`)) ? 0 : 1);
}
