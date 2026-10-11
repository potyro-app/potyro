// Measure how a model behaves when asked to CHANGE an app rather than write one.
//
//   OPENROUTER_API_KEY=sk-or-… pnpm --filter @potyro/generator eval:modify:edits -- --backend openrouter
//   pnpm --filter @potyro/generator eval:modify:edits -- --backend openrouter --model deepseek/deepseek-v4-pro-0813
//   pnpm --filter @potyro/generator eval:modify:edits -- --backend scripted   # no key: proves the harness
//
// Sibling of `run-modify-eval.ts`, and deliberately a different measurement. That one runs a CHAIN —
// generate, seed records, modify three times, migrate — and asks what a change costs and what it
// breaks in a person's DATA. This one runs one change against a fixed corpus of apps and asks
// whether the model can express a change AS EDITS at all: the format, the retries, the rewrite rate.
//
// Flags: --backend openrouter|claude-cli|scripted|scripted-edits|scripted-repair  --model <id>
//        --reasoning <effort>  --only id1,id2  --concurrency N  --out <dir>  --repair
//        --loop  --run   (`--run`, with `--loop`: candidates are also RUN on sample records, as the
//                         Studio does since #262 — here the logic run only; pages are not mounted
//                         in Node)
//
// Every case runs through the SAME guard the Studio uses (`guardedModify`): the model's reply is
// read as edits or a whole file, and the guard may make up to three attempts (a no-match retry, a
// loss retry) before giving up. So the numbers here are the numbers a person sees, and the two rates
// that matter fall straight out:
//
//   rewrote (1st)   how often the model's first reply replaced the app  - the raw model behaviour
//   rewrote (final) how often it STILL had after the retry              - what reaches the editor
//
// plus LANDED (the change is present) and VALIDATES (the result is a well-formed app), so a model
// that keeps the app by ignoring the request does not score as a win.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ClaudeCliBackend } from "../src/cli-backend.js";
import { createOpenRouterBackend, createOpenRouterEngine, type ReasoningEffort } from "../src/openrouter-backend.js";
import { guardedModify, type GuardedModifyResult } from "../src/guarded-modify.js";
import { runModifyLoop } from "../src/agent/modify-loop.js";
import { buildDiscoveryTools } from "../src/agent/discovery-tools.js";
import { MODIFY_AGENT_SYSTEM_PROMPT } from "../src/agent/modify-system-prompt.js";
import { MODIFY_CASES, type DefinitionShape, type ModifyCase } from "../src/modify-corpus.js";
import { buildRepairInstruction } from "../src/prompt.js";
import { loadApp, scoreSource } from "../src/score.js";
import { smokeApp, smokeReport } from "../src/smoke.js";
import { regressionGate, type RunReport } from "../src/run-report.js";
import type { GenPrompt, ModelBackend } from "../src/backend.js";
import type { AppShape } from "@potyro/runtime";

interface Outcome {
  id: string;
  app: string;
  /** How the change arrived: edits (the contract), the whole file (accepted fallback), a NOT-IN-APP
   *  verdict, or nothing usable. The first number to read: it says whether the model follows the
   *  format at all. */
  via: "edits" | "whole-file" | "declined" | "failed";
  /** Edit blocks applied (0 unless via=edits). */
  applied: number;
  /** The first reply's SEARCH did not match and the model was asked again. Format reliability. */
  noMatchRetry: boolean;
  /** The first usable reply dropped an entity or a page - the raw behaviour the loss gate counts. */
  rewroteFirst: boolean;
  /** What reached the editor still drops something, even after the retry. */
  rewroteFinal: boolean;
  loss: string | null;
  /** null = the case has no structural predicate (keep-only), or nothing landed to check. */
  landed: boolean | null;
  validates: boolean;
  /** Kept for report readers: same as via === "declined". */
  declined: boolean;
  /** Only set when --repair is given and the first result did not validate: the repair round's
   *  outcome. null when repair was not requested, not needed (validates already true), or the
   *  case never reached a `kind: "source"` result to repair. */
  repair: { via: "edits" | "whole-file" | "declined" | "failed"; validates: boolean } | null;
  /** The `Not done:` lines the reply carried (#135). */
  notDone: string[];
  /** For a case that names parts the host cannot do: did the reply name every one? null otherwise. */
  namedNotDone: boolean | null;
  /** The reply refused (NOT-IN-APP) a case that has a doable part — the failure the ladder exists to end. */
  refusedWhenFeasible: boolean;
  ms: number;
  crashed?: string;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Bounded-concurrency map that preserves input order (same shape as run-cli-eval). */
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

/**
 * Backends with no model behind them, so the harness can be proven end to end without a key.
 *
 * `scripted`: the first reply REPLACES the app with a smaller one (as a whole-file reply), the retry
 * hands the original back. Must report via=whole-file, rewroteFirst=true, rewroteFinal=false,
 * landed=false for every case.
 *
 * `scripted-edits`: the first reply is an edit whose SEARCH is not in any file; the retry edits the
 * one line every corpus app has. Must report via=edits, noMatchRetry=true, applied=1, rewroteFirst=
 * false, validates=true for every case. If either proof fails, the harness is broken, not the model.
 */
const editBlock = (search: string, replace: string) =>
  "```ts\n<<<<<<< SEARCH\n" + search + "\n=======\n" + replace + "\n>>>>>>> REPLACE\n```\n";

function scriptedBackend(kind: "scripted" | "scripted-edits"): ModelBackend {
  const calls = new Map<string, number>();
  return {
    name: kind === "scripted" ? "scripted:rewrite-then-restore" : "scripted:nomatch-then-edit",
    async generate() {
      throw new Error("scripted backend only modifies");
    },
    async modify(source: string, _instruction: string, prompt: GenPrompt) {
      // Key on the case id the runner passes as `prompt.id` - with `--runs`, that id carries a
      // per-sample suffix, so each sample fails once and recovers on its retry.
      const n = (calls.get(prompt.id) ?? 0) + 1;
      calls.set(prompt.id, n);
      if (kind === "scripted-edits") {
        if (n === 1) return editBlock("THIS LINE IS IN NO APP", "// never applied");
        return editBlock("export default defineApp({", "// edited by the eval\nexport default defineApp({");
      }
      if (n > 1) return "```ts\n" + source + "\n```";
      // A different, smaller app: one entity, one page. Exactly what a rewrite looks like.
      return `\`\`\`ts
import { defineApp } from "potyro";
export default defineApp({
  id: "rewritten", name: "Rewritten", version: "1.0.0", schemaVersion: 1,
  entities: { thing: { label: "Thing", displayField: "name", fields: { name: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Things", view: { type: "list", entity: "thing", display: { primary: "name" } } }],
});
\`\`\``;
    },
  };
}

/** First modify reply breaks `schemaVersion` (compiles, fails validation); the repair reply restores it.
 *  Must report validates 0/12 before repair and 12/12 after. */
function scriptedRepairBackend(): ModelBackend {
  const calls = new Map<string, number>();
  return {
    name: "scripted:break-then-repair",
    async generate() {
      throw new Error("scripted backend only modifies");
    },
    async modify(_source: string, _instruction: string, prompt: GenPrompt) {
      const n = (calls.get(prompt.id) ?? 0) + 1;
      calls.set(prompt.id, n);
      if (n === 1) return editBlock("  schemaVersion: 1,", '  schemaVersion: "one",');
      return editBlock('  schemaVersion: "one",', "  schemaVersion: 1,");
    },
  };
}

/** Every reply is a refusal. Must report refusedWhenFeasible = every case with a `landed` predicate. */
function scriptedDeclineBackend(): ModelBackend {
  return {
    name: "scripted:decline-everything",
    async generate() {
      throw new Error("scripted backend only modifies");
    },
    async modify() {
      return "NOT-IN-APP: the scripted backend declines everything.";
    },
  };
}

async function makeBackend(kind: string, model: string | undefined, reasoning: string | undefined): Promise<ModelBackend> {
  if (kind === "scripted" || kind === "scripted-edits") return scriptedBackend(kind);
  if (kind === "scripted-repair") return scriptedRepairBackend();
  if (kind === "scripted-decline") return scriptedDeclineBackend();
  if (kind === "claude-cli") return new ClaudeCliBackend({ ...(model ? { model } : {}) });
  if (kind === "openrouter") {
    return createOpenRouterBackend({
      ...(model ? { model } : {}),
      ...(reasoning ? { reasoning: { effort: reasoning as ReasoningEffort, exclude: true } } : {}),
    });
  }
  throw new Error(`unknown --backend "${kind}" (expected openrouter, claude-cli, scripted, scripted-edits, scripted-repair or scripted-decline)`);
}

/** The shape the guard compares, from a loaded app. Throws when the source does not load, which
 *  `guardedModify` treats as "cannot judge" rather than a loss. */
async function shapeOf(source: string, resolveDir: string): Promise<AppShape & DefinitionShape> {
  const app = (await loadApp(source, resolveDir)) as unknown as DefinitionShape;
  return {
    entities: app.entities,
    pages: app.pages as AppShape["pages"] & DefinitionShape["pages"],
    ...(app.scope ? { scope: app.scope } : {}),
    ...(app.reminders ? { reminders: app.reminders } : {}),
  };
}

/**
 * The product's modify LOOP (#131) in place of the one-turn guard: the model gets `lookup`/`check`/
 * `example`, every candidate must compile, validate and keep the shape, and a refusal without a
 * lookup is sent back once. Mapped onto the guard's result type so the scoring below is shared.
 */
async function loopModify(
  model: string | undefined,
  c: ModifyCase,
  source: string,
  before: AppShape,
  resolveDir: string,
  keep: (text: string) => string,
  runCandidates: boolean,
): Promise<GuardedModifyResult> {
  const run = regressionGate(async (src: string): Promise<RunReport> => smokeReport(await smokeApp((await loadApp(src, resolveDir)) as never)), source);
  const check = async (src: string): Promise<string[]> => {
    const r = await scoreSource(src, resolveDir);
    if (!r.compiles) throw new Error(r.errors.join("; "));
    return r.validates ? [] : r.errors;
  };
  const engine = createOpenRouterEngine({ ...(model ? { model } : {}) });
  const out = await runModifyLoop({
    engine: {
      chat: {
        completions: {
          create: async (req) => {
            const res = await engine.chat.completions.create(req);
            const m = res.choices[0]?.message;
            if (m && !m.tool_calls?.length) keep(m.content);
            return res;
          },
        },
      },
    },
    model,
    tools: buildDiscoveryTools({ check, ...(runCandidates ? { run } : {}) }),
    system: MODIFY_AGENT_SYSTEM_PROMPT,
    instruction: c.instruction,
    source,
    check,
    ...(runCandidates ? { run } : {}),
    shapeOf: (src) => shapeOf(src, resolveDir),
    before,
  });
  const trace = { attempts: 1, noMatchRetry: false, lossRetry: false };
  if (out.kind === "source") {
    return { kind: "source", source: out.source, via: out.via, applied: out.applied, loss: null, trace, ...(out.rationale ? { rationale: out.rationale } : {}), ...(out.notDone ? { notDone: out.notDone } : {}) };
  }
  if (out.kind === "diagnosis") return { kind: "diagnosis", text: out.text, trace };
  return { kind: "failed", reason: out.kind === "question" ? `asked: ${out.text}` : out.kind === "stopped" ? "stopped" : out.reason, trace };
}

async function runCase(
  backend: ModelBackend,
  c: ModifyCase,
  examplesDir: string,
  outDir: string,
  withRepair: boolean,
  loop: { model: string | undefined; run: boolean } | null,
): Promise<Outcome> {
  const started = Date.now();
  // Curated examples live in examples/; an eval-only fixture (a real app that was rewritten in
  // use) lives beside this harness, so the product's fixtures stay the product's.
  const fixturesDir = resolve(process.cwd(), "fixtures");
  // `.app.tsx` too: an example with a custom view is a .tsx file (recipes, workout).
  const candidates = [examplesDir, fixturesDir].flatMap((dir) => [join(dir, `${c.app}.app.ts`), join(dir, `${c.app}.app.tsx`)]);
  const file = candidates.find((f) => existsSync(f));
  if (!file) throw new Error(`no app "${c.app}" in examples/ or fixtures/`);
  const source = readFileSync(file, "utf8");
  const sourceDir = dirname(file);
  let turn = 0;
  // Every reply is written out as the model sent it (edits or a file), or a failed case cannot be
  // diagnosed. The applied result is written separately, so it can be diffed against the original.
  const keep = (text: string): string => {
    turn += 1;
    writeFileSync(join(outDir, `${c.id}.attempt-${turn}.reply.md`), text);
    return text;
  };
  const p: GenPrompt = { id: c.id, description: c.instruction };
  const crashed = (msg: string): Outcome => ({
    id: c.id, app: c.app, via: "failed", applied: 0, noMatchRetry: false, rewroteFirst: false, rewroteFinal: false,
    // A crash is not a case that failed to land; it is a case that did not run - so it leaves the
    // `landable` denominator rather than counting against it.
    loss: null, landed: null, validates: false, declined: false, repair: null, notDone: [], namedNotDone: null, refusedWhenFeasible: false, ms: Date.now() - started, crashed: msg,
  });
  try {
    if (!backend.modify && !loop) throw new Error(`${backend.name} has no modify()`);
    const before = await shapeOf(source, sourceDir);
    if (c.landed && c.landed(before, before)) {
      throw new Error(`corpus bug: "${c.id}" says landed on the ORIGINAL app - its predicate (${c.expects}) is vacuous`);
    }
    const result = loop
      ? await loopModify(loop.model, c, source, before, sourceDir, keep, loop.run)
      : await guardedModify({
          attempt: async (instr) => keep(await backend.modify!(source, instr, p)),
          shapeOf: (src) => shapeOf(src, sourceDir),
          before,
          instruction: c.instruction,
          source,
        });
    const common = { id: c.id, app: c.app, noMatchRetry: result.trace.noMatchRetry, rewroteFirst: result.trace.lossRetry };
    // Feasibility (#135). A refusal of a case with a doable part is the ladder's failure; a reply
    // that did the doable part is also asked whether it NAMED the parts it could not do.
    const notDone = result.kind === "source" ? (result.notDone ?? []) : [];
    const namedNotDone = c.notDone ? c.notDone.every((re) => notDone.some((line) => new RegExp(re, "i").test(line))) : null;
    const feasibility = { notDone, namedNotDone, refusedWhenFeasible: result.kind === "diagnosis" && Boolean(c.landed) };
    if (result.kind === "diagnosis") {
      return { ...common, via: "declined", applied: 0, rewroteFinal: false, loss: null, landed: null, validates: false, declined: true, repair: null, ...feasibility, ms: Date.now() - started };
    }
    if (result.kind === "failed") {
      return { ...common, via: "failed", applied: 0, rewroteFinal: false, loss: null, landed: null, validates: false, declined: false, repair: null, ...feasibility, ms: Date.now() - started };
    }
    writeFileSync(join(outDir, `${c.id}.final.app.ts`), result.source);
    // Scored ONCE per case. It used to run twice — once for `validates`, again for the repair
    // prompt's `errors` — so a case paid for two bundle+validate passes and the two could in
    // principle disagree about the same source. `scoreSource` reports failures as `errors` rather
    // than throwing, so it sits outside the try that guards `shapeOf`.
    const score = await scoreSource(result.source, sourceDir);
    const validates = score.validates;
    let landed: boolean | null = c.landed ? false : null;
    try {
      const final = await shapeOf(result.source, sourceDir);
      if (c.landed) landed = c.landed(final, before);
    } catch {
      // Does not load: nothing landed, and `loss` is whatever the guard could tell.
    }
    let repair: Outcome["repair"] = null;
    if (withRepair && !validates) {
      const repaired = await guardedModify({
        attempt: async (instr) => keep(await backend.modify!(result.source, instr, p)),
        shapeOf: (src) => shapeOf(src, examplesDir),
        before,
        instruction: buildRepairInstruction(score.errors),
        source: result.source,
      });
      if (repaired.kind === "source") {
        writeFileSync(join(outDir, `${c.id}.repaired.app.ts`), repaired.source);
        repair = { via: repaired.via, validates: (await scoreSource(repaired.source, sourceDir)).validates };
      } else {
        // A repair that declined (NOT-IN-APP) or produced nothing usable is not an edit round that
        // failed to validate — recording both as `via: "edits"` made three different endings
        // indistinguishable in the report. Named with `Outcome.via`'s own vocabulary, so a reader
        // does not have to learn a second one: a `diagnosis` is `declined` there too.
        repair = { via: repaired.kind === "diagnosis" ? "declined" : "failed", validates: false };
      }
    }
    return {
      ...common,
      via: result.via,
      applied: result.applied,
      rewroteFinal: result.loss !== null,
      loss: result.loss,
      landed,
      validates,
      declined: false,
      repair,
      ...feasibility,
      ms: Date.now() - started,
    };
  } catch (e) {
    return crashed(e instanceof Error ? e.message : String(e));
  }
}

async function main(): Promise<void> {
  const only = arg("only")?.split(",").map((s) => s.trim());
  const concurrency = Number(arg("concurrency", "3"));
  // One sample per case at temperature 0.1 is noise: two cases flipped between consecutive runs
  // with nothing changed, and a 0/12 cannot rule out a rewrite rate of 20%. N samples per case
  // turn "it did not happen this time" into a rate with a denominator worth reading.
  const runs = Math.max(1, Number(arg("runs", "1")));
  // Read once, here, and passed down. `runCase` used to re-read `process.argv` per case, which put
  // the flag's meaning in two places and made the runner impossible to drive from anything but a
  // command line.
  const repairRequested = process.argv.includes("--repair");
  // `--loop`: the product's modify loop (#131) instead of the one-turn guard. OpenRouter only —
  // it needs a chat engine with tools, which the scripted and CLI backends are not.
  const loopRequested = process.argv.includes("--loop");
  const outDir = resolve(arg("out", join(process.cwd(), "eval-out", `modify-${Date.now()}`))!);
  const examplesDir = resolve(process.cwd(), "..", "..", "examples");
  const selected = only ? MODIFY_CASES.filter((c) => only.includes(c.id)) : [...MODIFY_CASES];
  const cases = selected.flatMap((c) => Array.from({ length: runs }, (_, i) => (runs > 1 ? { ...c, id: `${c.id}#${i + 1}` } : c)));

  mkdirSync(outDir, { recursive: true });
  const backendKind = arg("backend", "openrouter") ?? "openrouter";
  if (loopRequested && backendKind !== "openrouter") throw new Error("--loop needs --backend openrouter (a chat engine with tools)");
  const backend = await makeBackend(backendKind, arg("model"), arg("reasoning"));
  const loop = loopRequested ? { model: arg("model"), run: process.argv.includes("--run") } : null;
  console.log(`backend=${backend.name}${loop ? ` via the modify LOOP${loop.run ? ", running candidates" : ""}` : ""} cases=${selected.length}${runs > 1 ? ` × ${runs} runs` : ""} concurrency=${concurrency}\nout=${outDir}\n`);

  let done = 0;
  const outcomes = await pool(cases, concurrency, async (c) => {
    const o = await runCase(backend, c, examplesDir, outDir, repairRequested, loop);
    // mark: ✓ landed   ✗ still rewrote after retry   ∅ declined (NOT-IN-APP)
    //       ~ ran but landed nothing to check   ! failed, or crashed before it could run
    const mark = o.crashed ? "!" : o.via === "failed" ? "!" : o.rewroteFinal ? "✗" : o.via === "declined" ? "∅" : o.landed ? "✓" : "~";
    const how = o.via === "edits" ? `${o.applied} edit${o.applied === 1 ? "" : "s"}` : o.via === "whole-file" ? "WHOLE FILE" : o.via;
    const note = o.crashed
      ? ` CRASHED: ${o.crashed.slice(0, 80)}`
      : [
          o.noMatchRetry ? " SEARCH missed once" : "",
          o.rewroteFirst ? (o.rewroteFinal ? ` rewrote, retry did not help: ${o.loss}` : " rewrote, retry kept the app") : "",
          o.refusedWhenFeasible ? " — REFUSED A FEASIBLE CHANGE" : "",
          o.namedNotDone === false ? " — did not name what it could not do" : o.namedNotDone === true ? ` — named what it could not do (${o.notDone.length})` : "",
        ].join("");
    console.log(`${mark} [${++done}/${cases.length}] ${o.id} (${Math.round(o.ms / 1000)}s) via ${how}${o.landed === false ? " — did not land" : ""}${note}`);
    return o;
  });

  const n = outcomes.length;
  const count = (f: (o: Outcome) => boolean) => outcomes.filter(f).length;
  const pct = (k: number) => (n ? `${Math.round((k / n) * 100)}%` : "—");
  const summary = {
    backend: backend.name,
    n,
    viaEdits: count((o) => o.via === "edits"),
    viaWholeFile: count((o) => o.via === "whole-file"),
    noMatchRetry: count((o) => o.noMatchRetry),
    failed: count((o) => o.via === "failed" && !o.crashed),
    rewroteFirst: count((o) => o.rewroteFirst),
    rewroteFinal: count((o) => o.rewroteFinal),
    landed: count((o) => o.landed === true),
    landable: count((o) => o.landed !== null),
    validates: count((o) => o.validates),
    validatesAfterRepair: count((o) => o.validates || o.repair?.validates === true),
    declined: count((o) => o.declined),
    // #135: the two numbers the ladder is judged by.
    refusedWhenFeasible: count((o) => o.refusedWhenFeasible),
    feasible: count((o) => o.landed !== null || o.refusedWhenFeasible),
    namedNotDone: count((o) => o.namedNotDone === true),
    partial: count((o) => o.namedNotDone !== null),
    crashed: count((o) => Boolean(o.crashed)),
  };
  const lines = [
    "",
    "=".repeat(60),
    `MODIFY — ${backend.name} (n=${n}${runs > 1 ? ` = ${selected.length} cases × ${runs} runs` : ""})`,
    `  replied with edits:       ${summary.viaEdits}/${n} (${pct(summary.viaEdits)})   ← the contract`,
    `  sent the whole file:      ${summary.viaWholeFile}/${n} (${pct(summary.viaWholeFile)})   ← accepted, but retyped`,
    summary.noMatchRetry ? `  SEARCH missed, retried:   ${summary.noMatchRetry}/${n}` : "",
    summary.failed ? `  nothing usable:           ${summary.failed}/${n}` : "",
    `  dropped entities/pages:   ${summary.rewroteFirst}/${n} (${pct(summary.rewroteFirst)})   ← a reply lost structure; the loss retry fired`,
    `  still rewrote after retry: ${summary.rewroteFinal}/${n} (${pct(summary.rewroteFinal)})   ← what reaches the editor`,
    `  change landed:            ${summary.landed}/${summary.landable} (${summary.landable ? Math.round((summary.landed / summary.landable) * 100) : 0}%)   ← of cases with a structural check`,
    `  result validates:         ${summary.validates}/${n} (${pct(summary.validates)})`,
    repairRequested ? `  validates after repair:   ${summary.validatesAfterRepair}/${n} (${pct(summary.validatesAfterRepair)})` : "",
    summary.declined ? `  declined (NOT-IN-APP):    ${summary.declined}/${n}   ← judged not the app's to change; excluded from landed` : "",
    `  refused when feasible:    ${summary.refusedWhenFeasible}/${summary.feasible}   ← a refusal of a case with a doable part: the ladder's failure`,
    summary.partial ? `  named what it could not do: ${summary.namedNotDone}/${summary.partial}   ← of cases with a part the host cannot do` : "",
    summary.crashed ? `  crashed:                  ${summary.crashed}/${n}` : "",
    "=".repeat(60),
  ].filter((l) => l !== "");
  console.log(lines.join("\n"));

  writeFileSync(join(outDir, "report.json"), JSON.stringify({ summary, outcomes }, null, 2));
  console.log(`\nreport: ${join(outDir, "report.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
