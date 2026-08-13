// Run the modify chains through `claude -p` and report what survived, what it cost, and what a
// person still has to look at.
//
// This spends real money. Every default here is the cautious one — one attempt, one chain at a
// time, one repair — because the run exists to make a decision about safety, and a run you cannot
// attribute a charge or a failure to does not help you make it.
//
//   # the three-scenario pilot: 12 base calls, hard-stopped at 15
//   pnpm --filter @karta/generator eval:modify -- --only todo-groups,recipes-shopping,expenses-split --max-calls 15 --max-cost 16
//
//   # Windows (PowerShell blocks pnpm.ps1 under the default execution policy)
//   pnpm.cmd --filter @karta/generator eval:modify -- --only todo-groups --max-calls 5 --max-cost 6
//
// Flags
//   --only a,b        run only these scenarios (default: the whole corpus)
//   --attempts N      how many times to run the corpus (default 1; model output varies, and one run
//                     of a stochastic system is an anecdote — but each attempt costs again)
//   --concurrency N   chains in flight at once (default 1, so a failure and a charge are both
//                     attributable to one chain)
//   --max-calls N     hard stop on model calls, failures included
//   --max-cost N      hard stop on reported spend, in USD. Refuses to run unmetered — see below
//   --allow-unmetered continue under --max-cost even when the backend reports no cost
//   --no-metering     ask the CLI for plain text instead of the JSON envelope (no usage, no cost)
//   --model alias     passed to `claude --model`
//   --out dir         artifact directory (default eval-out/modify)
//
// ## On --max-cost
//
// A ceiling over a backend that cannot report spend is a number in a config file. `claude -p` only
// reports cost under `--output-format json`, so that is what this asks for; if a call comes back
// without a cost anyway, the run STOPS rather than continuing under a limit that was never going to
// fire. `--allow-unmetered` is how a person says "I know it is unmetered, keep going" — and the
// report then says so in as many words, and reports call count and duration instead. Call count is
// not cost and is never presented as it.
//
// Every source is written to disk. A failure rate is unreadable without the failures.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ClaudeCliBackend, claudeCliAvailable } from "../src/cli-backend.js";
import { MODIFY_SCENARIOS } from "../src/modify-scenarios.js";
import { runModifyScenario, summarize, type ScenarioRun } from "../src/modify-eval.js";
import { artifactPath, formatModifyReport, rejectedPath, reviewSheet } from "../src/modify-report.js";
import { CallBudget } from "../src/model-call.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const next = i >= 0 ? process.argv[i + 1] : undefined;
  return next && !next.startsWith("--") ? next : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function numberArg(name: string): number | undefined {
  const raw = arg(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number, got "${raw}"`);
  return n;
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

function write(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

async function main(): Promise<void> {
  if (!claudeCliAvailable()) {
    throw new Error("`claude` is not on PATH. This run needs the CLI authenticated; nothing was spent.");
  }

  const attempts = numberArg("attempts") ?? 1;
  const concurrency = numberArg("concurrency") ?? 1;
  const maxCalls = numberArg("max-calls");
  const maxCostUsd = numberArg("max-cost");
  const only = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const outDir = resolve(process.cwd(), arg("out") ?? "eval-out/modify");

  const scenarios = only ? MODIFY_SCENARIOS.filter((s) => only.includes(s.id)) : MODIFY_SCENARIOS;
  if (!scenarios.length) throw new Error(`no scenarios matched ${only?.join(",")}`);
  const missing = (only ?? []).filter((id) => !MODIFY_SCENARIOS.some((s) => s.id === id));
  if (missing.length) throw new Error(`unknown scenario(s): ${missing.join(", ")}`);

  const backend = new ClaudeCliBackend({
    timeoutMs: 300_000,
    metered: !flag("no-metering"),
    ...(arg("model") ? { model: arg("model")! } : {}),
  });
  const budget = new CallBudget({
    ...(maxCalls === undefined ? {} : { maxCalls }),
    ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
    allowUnmetered: flag("allow-unmetered"),
  });

  const jobs = Array.from({ length: attempts }, (_, a) => scenarios.map((s) => ({ s, attempt: a + 1 }))).flat();
  // 1 generate + 3 modify per chain, before any repair. Said out loud because the number of calls
  // IS the cost when the backend will not name one.
  const baseCalls = jobs.length * 4;

  console.log(`${jobs.length} chains (${scenarios.length} scenarios × ${attempts}), ${concurrency} at a time.`);
  console.log(`${baseCalls} base model calls before repairs${maxCalls ? `, hard stop at ${maxCalls}` : ", NO --max-calls set"}.`);
  console.log(maxCostUsd ? `Spend ceiling $${maxCostUsd}.` : "No --max-cost set.");
  console.log(`Artifacts: ${outDir}\n`);

  const started = Date.now();
  const runs: ScenarioRun[] = await pool(jobs, concurrency, async ({ s, attempt }) => {
    const run = await runModifyScenario(backend, s, attempt, budget);
    // Written per chain rather than at the end, so a run killed by a budget stop — or by somebody
    // pressing ctrl-C at the sight of the bill — still leaves everything it learned on disk.
    if (run.generation.source) write(join(outDir, artifactPath(run, "generated")), run.generation.source);
    if (run.generation.rejectedSource) write(join(outDir, rejectedPath(run, "generated")), run.generation.rejectedSource);
    for (const step of run.steps) {
      if (step.sourceAfter) write(join(outDir, artifactPath(run, step.index)), step.sourceAfter);
      if (step.rejectedSource) write(join(outDir, rejectedPath(run, step.index)), step.rejectedSource);
    }
    const marks = run.generated
      ? run.steps.map((st) => `${st.index}:${st.verdict}`).join(" ") || "no steps ran"
      : "GENERATE FAILED";
    console.log(`  ${run.scenario} #${attempt}  ${marks}${run.stoppedBecause ? `  — ${run.stoppedBecause}` : ""}`);
    return run;
  });

  const report = summarize(backend.name, runs, budget, started);
  write(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  const text = formatModifyReport(report);
  write(join(outDir, "report.txt"), text);
  write(join(outDir, "review.md"), reviewSheet(report));

  console.log(`\n${text}`);
  console.log(`\n${Math.round(report.durationMs / 1000)}s · review sheet: ${join(outDir, "review.md")}`);
  // A partial run is not a passing run. Exit non-zero so a wrapper cannot mistake one for the other.
  if (report.partial) process.exitCode = 2;
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
