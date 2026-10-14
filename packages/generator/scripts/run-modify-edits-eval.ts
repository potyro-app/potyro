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
//        --reasoning off|low|medium|high (the Studio's levels, #280; or any OpenRouter effort)
//        --escalate   with --loop: think hard for the one turn after the loop got stuck (#280)
//        --only id1,id2  --concurrency N  --out <dir>  --repair  --runs N
//        --loop  --run   (`--run`, with `--loop`: candidates are also RUN on sample records, as the
//                         Studio does since #262 — here the logic run only; pages are not mounted
//                         in Node)
//        --loop --backend scripted-loop|scripted-loop-tools   the loop with no model: proves the
//                         loop half of the harness (give-up causes, calls, tokens, cost; loop-eval.ts)
//        --language pl|pt-BR  (#301) the person's language: every case's request is the hand-checked
//                          translation (translated-cases.ts), the turn carries the language line, and
//                          the report adds two checks — are the result's NEW labels in the app's
//                          language, and is the reply (explanation, Not done, refusal, question) in
//                          the person's? `en` is today's run, unchanged.
//        --app-language <tag>  the app's language as if it declared one (#302): new labels are then
//                          expected in it. Without it the corpus apps read as English, so a Polish
//                          request on them is expected to keep English labels and reply in Polish.
//        --backend scripted-loop-language --loop   proves the language columns with no model
//        --conversation both|recap|tool|none  (#279, with --loop) how a `conversation` case's earlier
//                          requests reach the model: the recap in the opening message and the
//                          `read_conversation` tool (both, the Studio's default), one of them, or
//                          neither (what the loop saw before #279)
//        --recap-rounds N  how many earlier requests the recap shows (default DEFAULT_RECAP_ROUNDS)
//        --backend scripted-loop-conversation --loop   proves the conversation columns with no model
//        --case-timeout S  a hard limit per case (default 900): the loop is told to stop and the case
//                          is recorded as crashed with the reason — three cases once hung ten hours
//
// With --loop the summary also says how each case ended (docs/19 F9): give-ups by cause, repeats and
// fresh starts, the candidate the result passed on, model calls, tokens and cost — and every
// headline rate with its 95% interval. A `wrong-gate` case (#276) is reported apart: its gate
// refuses every candidate.
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

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ClaudeCliBackend } from "../src/cli-backend.js";
import { createOpenRouterBackend, createOpenRouterEngine, REASONING_LEVELS, thinkingOptions, type ReasoningEffort, type ReasoningLevel, type ReasoningOptions } from "../src/openrouter-backend.js";
import { guardedModify, type GuardedModifyResult } from "../src/guarded-modify.js";
import { runModifyLoop } from "../src/agent/modify-loop.js";
import { buildDiscoveryTools } from "../src/agent/discovery-tools.js";
import { loadCorpus } from "../src/load-corpus.js";
import { MODIFY_AGENT_SYSTEM_PROMPT } from "../src/agent/modify-system-prompt.js";
import { MODIFY_CASES, type DefinitionShape, type ModifyCase } from "../src/modify-corpus.js";
import { buildRepairInstruction } from "../src/prompt.js";
import { loadApp, scoreSource } from "../src/score.js";
import { smokeApp, smokeReport } from "../src/smoke.js";
import { regressionGate, type RunReport } from "../src/run-report.js";
import { meteredEngine, newMeter, rate, refusingCheck, SCRIPTED_LOOP_KINDS, scriptedLoopEngine, stepTracer, summarizeLoop, type LoopRecord, type ScriptedLoopKind } from "../src/loop-eval.js";
import type { ChatEngine } from "../src/chat-backend.js";
import type { GenPrompt, ModelBackend } from "../src/backend.js";
import type { AppShape } from "@potyro/runtime";
import { LANGUAGE_NAMES, appLanguage, isLanguage, matchLanguage, type Language, type TurnLanguage } from "../src/language.js";
import { isEvalLanguage, localizeModifyCase, EVAL_LANGUAGES } from "../src/translated-cases.js";
import { DEFAULT_RECAP_ROUNDS, recapCoverage, requestsBack } from "../src/agent/conversation.js";
import { checkLabels, newLabels, replyLanguage, summarizeLanguage, type LabelCheck } from "../src/language-eval.js";

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
  /** Why the loop gave up, when via = failed: the thing to read before anything else in a failed case. */
  reason?: string;
  /** The case's class (conversation / platform / wrong-gate), when it has one. */
  class?: ModifyCase["class"];
  /** `--loop` only: how the loop ended, why it gave up, what it cost, and on which candidate it passed. */
  loop?: LoopRecord;
  /** `--language` only (#301): were the new labels in the app's language, and the reply in the person's? */
  language?: { labels: LabelCheck | null; reply: { expected: Language; read: Language | null; passed: boolean | null } };
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

/** `--reasoning`: one of the Studio's levels (with its token budget), or a raw OpenRouter effort. */
function thinkingFrom(flag: string | undefined): { reasoning?: ReasoningOptions; maxTokens?: number } {
  if (!flag) return {};
  if ((REASONING_LEVELS as readonly string[]).includes(flag)) return thinkingOptions(flag as ReasoningLevel);
  return { reasoning: { effort: flag as ReasoningEffort, exclude: true } };
}

async function makeBackend(kind: string, model: string | undefined, reasoning: string | undefined): Promise<ModelBackend> {
  if (kind === "scripted" || kind === "scripted-edits") return scriptedBackend(kind);
  if (kind === "scripted-repair") return scriptedRepairBackend();
  if (kind === "scripted-decline") return scriptedDeclineBackend();
  if (kind === "claude-cli") return new ClaudeCliBackend({ ...(model ? { model } : {}) });
  if (kind === "openrouter") {
    return createOpenRouterBackend({
      ...(model ? { model } : {}),
      ...thinkingFrom(reasoning),
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
/** How the loop gets its model: OpenRouter, or a scripted engine that proves the harness (loop-eval.ts). */
interface LoopSetup {
  model: string | undefined;
  run: boolean;
  engine: () => ChatEngine;
  /** Think hard for the turn after the loop got stuck (#280). */
  escalate: boolean;
  /** How a conversation case's earlier requests reach the model (#279); null: they do not. */
  conversation: { recapRounds: number; tool: boolean } | null;
}

/** `--conversation` and `--recap-rounds`: the Studio's default is both, with DEFAULT_RECAP_ROUNDS. */
function conversationFrom(mode: string | undefined, rounds: string | undefined): LoopSetup["conversation"] {
  const recapRounds = rounds === undefined ? DEFAULT_RECAP_ROUNDS : Number(rounds);
  if (!Number.isInteger(recapRounds) || recapRounds < 0) throw new Error(`--recap-rounds ${rounds}: a whole number, 0 or more`);
  switch (mode ?? "both") {
    case "both":
      return { recapRounds, tool: true };
    case "recap":
      return { recapRounds, tool: false };
    case "tool":
      return { recapRounds: 0, tool: true };
    case "none":
      return null;
    default:
      throw new Error(`--conversation ${mode}: expected both, recap, tool or none`);
  }
}

/** What the turns are told about language (#301); null on an English run, which then is today's run. */
type RunLanguage = { person: Language; app: Language | null } | null;

async function loopModify(
  loop: LoopSetup,
  c: ModifyCase,
  source: string,
  before: AppShape,
  resolveDir: string,
  keep: (text: string) => string,
  outDir: string,
  signal: AbortSignal,
  record: (r: LoopRecord) => void,
  language: RunLanguage,
): Promise<GuardedModifyResult> {
  const { model, run: runCandidates } = loop;
  const run = regressionGate(async (src: string): Promise<RunReport> => smokeReport(await smokeApp((await loadApp(src, resolveDir)) as never)), source);
  const honest = async (src: string): Promise<string[]> => {
    const r = await scoreSource(src, resolveDir);
    if (!r.compiles) throw new Error(r.errors.join("; "));
    return r.validates ? [] : r.errors;
  };
  // A wrong-gate case (#276): the check refuses every candidate, the `check` tool's included.
  const check = c.gateRefuses ? refusingCheck(honest, c.gateRefuses) : honest;
  const meter = newMeter();
  const tracer = stepTracer();
  const out = await runModifyLoop({
    engine: meteredEngine(loop.engine(), meter, keep),
    model,
    escalate: loop.escalate,
    tools: buildDiscoveryTools({ check, source, ...(runCandidates ? { run } : {}) }),
    // What was said about earlier versions (#279), the way the Studio hands it over.
    ...(c.earlier?.length && loop.conversation ? { conversation: c.earlier, conversationAccess: loop.conversation } : {}),
    corpus: loadCorpus,
    system: MODIFY_AGENT_SYSTEM_PROMPT,
    instruction: c.instruction,
    source,
    ...(language ? { language: language.person, ...(language.app ? { appLanguage: language.app } : {}) } : {}),
    check,
    ...(runCandidates ? { run } : {}),
    shapeOf: (src) => shapeOf(src, resolveDir),
    before,
    signal,
    // Step trace, for diagnosing a case that gave up while still calling tools (no reply is kept then).
    onStep: (s) => {
      tracer.onStep(s);
      const line =
        s.kind === "tool" ? `tool ${s.name} ${s.ok ? "ok" : "FAIL"}: ${s.detail}` : s.kind === "candidate" ? `candidate ${s.passed ? "PASSED" : "REJECTED"}: ${s.detail}` : s.kind === "unusable" ? `unusable: ${s.detail}` : "thinking";
      appendFileSync(join(outDir, `${c.id}.steps.log`), `--- ${new Date().toISOString()} ${line}\n`);
    },
  });
  // A request to the Potyro team (#263) is written out beside the case, to be read.
  const platformRequest = out.kind === "platform" ? out.request : out.kind === "source" || out.kind === "failed" ? out.platformRequest : undefined;
  if (platformRequest) writeFileSync(join(outDir, `${c.id}.platform-request.md`), `# ${platformRequest.title}\n\n${platformRequest.body}\n`);
  record({
    ...tracer.read(),
    ended: out.kind,
    ...(platformRequest ? { platformRequest: true } : {}),
    cause: out.kind === "failed" ? out.cause : null,
    calls: meter.calls,
    promptTokens: meter.promptTokens,
    completionTokens: meter.completionTokens,
    cost: meter.cost,
    unpriced: meter.unpriced,
  });
  const trace = { attempts: 1, noMatchRetry: false, lossRetry: false };
  if (out.kind === "source") {
    return { kind: "source", source: out.source, via: out.via, applied: out.applied, loss: null, trace, ...(out.rationale ? { rationale: out.rationale } : {}), ...(out.notDone ? { notDone: out.notDone } : {}) };
  }
  if (out.kind === "diagnosis") return { kind: "diagnosis", text: out.text, trace };
  // Nothing done, only a request: for scoring, a refusal of the whole (a platform case wants the doable part too).
  if (out.kind === "platform") return { kind: "diagnosis", text: `${out.said}\n${out.request.title}: ${out.request.body}`, trace };
  return { kind: "failed", reason: out.kind === "question" ? `asked: ${out.text}` : out.kind === "stopped" ? "stopped: the case's time limit" : out.reason, trace };
}

/**
 * A case ends within `ms`, whatever it is waiting on. The loop is told to stop (its next step returns
 * `stopped`); if even that does not return — a body that never ends — the case is recorded as crashed
 * with the reason, and the run moves on instead of sitting on three stuck cases for ten hours.
 */
async function withTimeLimit(c: ModifyCase, ms: number, run: (signal: AbortSignal) => Promise<Outcome>): Promise<Outcome> {
  const controller = new AbortController();
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      // Grace for the loop to notice the signal; then the case is over whether it noticed or not.
      setTimeout(
        () =>
          resolve({
            id: c.id, app: c.app, via: "failed", applied: 0, noMatchRetry: false, rewroteFirst: false, rewroteFinal: false, loss: null, landed: null,
            validates: false, declined: false, repair: null, notDone: [], namedNotDone: null, refusedWhenFeasible: false, ms: Date.now() - started,
            crashed: `timed out after ${Math.round(ms / 1000)}s`,
          }),
        5_000,
      );
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), limit]);
  } finally {
    clearTimeout(timer);
  }
}

async function runCase(
  backend: ModelBackend,
  c: ModifyCase,
  examplesDir: string,
  outDir: string,
  withRepair: boolean,
  loop: LoopSetup | null,
  signal: AbortSignal,
  language: RunLanguage,
): Promise<Outcome> {
  const started = Date.now();
  let loopRecord: LoopRecord | undefined;
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
    // The turn's language: the person's, and the app's as declared (--app-language) or read off it.
    const turn: TurnLanguage | undefined = language ? { person: language.person, app: language.app ?? appLanguage(source) } : undefined;
    const ctx = turn ? { language: turn } : undefined;
    const result = loop
      ? await loopModify(loop, c, source, before, sourceDir, keep, outDir, signal, (r) => (loopRecord = r), language)
      : await guardedModify({
          attempt: async (instr) => keep(await backend.modify!(source, instr, p, ctx)),
          shapeOf: (src) => shapeOf(src, sourceDir),
          before,
          instruction: c.instruction,
          source,
        });
    const common = {
      id: c.id,
      app: c.app,
      noMatchRetry: result.trace.noMatchRetry,
      rewroteFirst: result.trace.lossRetry,
      ...(c.class ? { class: c.class } : {}),
      ...(loopRecord ? { loop: loopRecord } : {}),
    };
    // Feasibility (#135). A refusal of a case with a doable part is the ladder's failure; a reply
    // that did the doable part is also asked whether it NAMED the parts it could not do.
    const notDone = result.kind === "source" ? (result.notDone ?? []) : [];
    const namedNotDone = c.notDone ? c.notDone.every((re) => notDone.some((line) => new RegExp(re, "i").test(line))) : null;
    const feasibility = { notDone, namedNotDone, refusedWhenFeasible: result.kind === "diagnosis" && Boolean(c.landed) };
    // #301: what the model said to the person, and the app's new words, each in the language asked for.
    const said =
      result.kind === "source"
        ? [result.rationale ?? "", ...(result.notDone ?? [])].join("\n")
        : result.kind === "diagnosis"
          ? result.text
          : result.reason.startsWith("asked: ")
            ? result.reason.slice("asked: ".length)
            : "";
    const languageCheck = (after: string | null): Pick<Outcome, "language"> => {
      if (!turn) return {};
      const person = turn.person ?? "en";
      const read = said.trim() ? replyLanguage(said) : null;
      const labels = after === null ? null : checkLabels(newLabels(after, source), turn.app ?? person);
      return { language: { labels, reply: { expected: person, read, passed: read === null ? null : read === person } } };
    };
    if (result.kind === "diagnosis") {
      return { ...common, via: "declined", applied: 0, rewroteFinal: false, loss: null, landed: null, validates: false, declined: true, repair: null, ...feasibility, ...languageCheck(null), ms: Date.now() - started };
    }
    if (result.kind === "failed") {
      appendFileSync(join(outDir, `${c.id}.steps.log`), `--- gave up: ${result.reason}\n`);
      // A give-up on a case with a structural check did not land: it stays in the denominator. (It
      // used to leave it, so a loop that gave up more often scored a better landed rate.)
      return { ...common, via: "failed", applied: 0, rewroteFinal: false, loss: null, landed: c.landed ? false : null, validates: false, declined: false, repair: null, ...feasibility, ...languageCheck(null), ms: Date.now() - started, reason: result.reason };
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
        attempt: async (instr) => keep(await backend.modify!(result.source, instr, p, ctx)),
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
      ...languageCheck(result.source),
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
  // #301: the person's language. English (or no flag) is today's run, byte for byte.
  const languageArg = arg("language");
  const person = languageArg ? matchLanguage(languageArg) : null;
  if (languageArg && !person) throw new Error(`--language ${languageArg}: not a language Potyro speaks`);
  if (person && person !== "en" && !isEvalLanguage(person)) throw new Error(`--language ${person}: the corpus has hand-checked requests only in ${EVAL_LANGUAGES.join(", ")}`);
  const appLanguageArg = arg("app-language");
  const declaredApp = appLanguageArg ? matchLanguage(appLanguageArg) : null;
  if (appLanguageArg && !isLanguage(declaredApp)) throw new Error(`--app-language ${appLanguageArg}: not a language Potyro speaks`);
  const language: RunLanguage = person ? { person, app: declaredApp } : null;
  const corpus = person && isEvalLanguage(person) ? MODIFY_CASES.map((c) => localizeModifyCase(c, person)) : [...MODIFY_CASES];
  const selected = only ? corpus.filter((c) => only.includes(c.id)) : corpus;
  const cases = selected.flatMap((c) => Array.from({ length: runs }, (_, i) => (runs > 1 ? { ...c, id: `${c.id}#${i + 1}` } : c)));

  mkdirSync(outDir, { recursive: true });
  const backendKind = arg("backend", "openrouter") ?? "openrouter";
  const scriptedLoop = (SCRIPTED_LOOP_KINDS as readonly string[]).includes(backendKind);
  if (loopRequested && backendKind !== "openrouter" && !scriptedLoop) {
    throw new Error(`--loop needs a chat engine with tools: --backend openrouter, or ${SCRIPTED_LOOP_KINDS.join(" / ")} to prove the harness`);
  }
  if (scriptedLoop && !loopRequested) throw new Error(`--backend ${backendKind} drives the loop: add --loop`);
  const reasoning = arg("reasoning");
  const model = arg("model");
  const backend: ModelBackend = scriptedLoop
    ? { name: `scripted:${backendKind}`, generate: async () => { throw new Error("scripted loop engine only drives the loop"); } }
    : await makeBackend(backendKind, model, reasoning);
  const loop: LoopSetup | null = loopRequested
    ? {
        model,
        run: process.argv.includes("--run"),
        // One engine per case: a scripted one counts its own calls. The reasoning effort reaches the
        // loop too — it used to reach only the one-turn backend, so a `--loop --reasoning high` run
        // measured reasoning off.
        engine: scriptedLoop
          ? () => scriptedLoopEngine(backendKind as ScriptedLoopKind)
          : () => createOpenRouterEngine({ ...(model ? { model } : {}), ...thinkingFrom(reasoning) }),
        escalate: process.argv.includes("--escalate"),
        conversation: conversationFrom(arg("conversation"), arg("recap-rounds")),
      }
    : null;
  const caseTimeoutMs = Number(arg("case-timeout", "900")) * 1000;
  const conversationLabel = (c: LoopSetup["conversation"]): string =>
    !c ? ", no earlier conversation" : c.recapRounds && c.tool ? `, recap of ${c.recapRounds} + read_conversation` : c.tool ? ", read_conversation only" : `, recap of ${c.recapRounds} only`;
  console.log(`backend=${backend.name}${loop ? ` via the modify LOOP${loop.run ? ", running candidates" : ""}${loop.escalate ? ", thinking hard when stuck" : ""}${conversationLabel(loop.conversation)}` : ""} cases=${selected.length}${runs > 1 ? ` × ${runs} runs` : ""} concurrency=${concurrency}\nout=${outDir}\n`);

  let done = 0;
  const outcomes = await pool(cases, concurrency, async (c) => {
    const o = await withTimeLimit(c, caseTimeoutMs, (signal) => runCase(backend, c, examplesDir, outDir, repairRequested, loop, signal, language));
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
    const lang = o.language
      ? ` · labels ${o.language.labels?.passed === null || !o.language.labels ? "—" : o.language.labels.passed ? "ok" : `NOT ${LANGUAGE_NAMES[o.language.labels.expected]}: ${o.language.labels.offenders.join(", ")}`}` +
        ` · reply ${o.language.reply.passed === null ? "—" : o.language.reply.passed ? "ok" : `in ${o.language.reply.read}`}`
      : "";
    console.log(`${mark} [${++done}/${cases.length}] ${o.id} (${Math.round(o.ms / 1000)}s) via ${how}${o.landed === false ? " — did not land" : ""}${note}${lang}`);
    return o;
  });

  // A wrong-gate case cannot land or validate in loop mode by construction (its gate refuses every
  // candidate), so it is left out of the headline rates and reported on its own: how it ended.
  const deadEnds = loop ? outcomes.filter((o) => o.class === "wrong-gate") : [];
  const scored = outcomes.filter((o) => !deadEnds.includes(o));
  const n = scored.length;
  const count = (f: (o: Outcome) => boolean, of: readonly Outcome[] = scored) => of.filter(f).length;
  const pct = (k: number) => (n ? `${Math.round((k / n) * 100)}%` : "—");
  const loopRecords = outcomes.flatMap((o) => (o.loop ? [o.loop] : []));
  const classes = ["conversation", "platform", "wrong-gate"] as const;
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
    // docs/19 F9: per class, how the loop ended and what it cost. Every case, wrong-gate included.
    byClass: Object.fromEntries(
      classes.map((k) => {
        const of = outcomes.filter((o) => o.class === k);
        return [k, { n: of.length, validates: count((o) => o.validates, of), landed: count((o) => o.landed === true, of), namedNotDone: count((o) => o.namedNotDone === true, of) }];
      }),
    ),
    ...(language ? { language: { person: language.person, app: language.app, ...summarizeLanguage(scored.map((o) => o.language ?? {})) } } : {}),
    ...(loop ? { loop: summarizeLoop(loopRecords), deadEnds: deadEnds.map((o) => ({ id: o.id, ended: o.loop?.ended ?? "crashed", cause: o.loop?.cause ?? null, calls: o.loop?.calls ?? 0, cost: o.loop?.cost ?? 0 })) } : {}),
  };
  const ls = summary.loop;
  /** #279: for the conversation cases, whether the recap could show what decides them, and how often the model read further back. */
  function conversationLines(): string[] {
    const of = outcomes.filter((o) => o.class === "conversation");
    if (!loop || !of.length) return [];
    const setup = loop.conversation;
    const cases = selected.filter((c) => c.class === "conversation");
    const shows = setup ? cases.filter((c) => recapCoverage(Infinity, requestsBack(c.earlier ?? [], c.decidedBy ?? "") ?? Infinity, setup.recapRounds)).length : 0;
    const read = of.filter((o) => (o.loop?.conversationReads ?? 0) > 0).length;
    return [
      `  conversation (#279):      ${setup ? `the recap shows what decides ${shows}/${cases.length} cases` : "earlier requests not given"}${setup?.tool ? `; read older requests in ${read}/${of.length} runs` : ""}`,
    ];
  }
  const money = (x: number) => `$${x.toFixed(4)}`;
  const lines = [
    "",
    "=".repeat(60),
    `MODIFY — ${backend.name}${language ? ` in ${LANGUAGE_NAMES[language.person]}${language.app ? `, app declared ${LANGUAGE_NAMES[language.app]}` : ""}` : ""} (n=${n}${runs > 1 ? `, ${runs} runs a case` : ""}${deadEnds.length ? `; ${deadEnds.length} wrong-gate runs reported apart` : ""})`,
    `  replied with edits:       ${summary.viaEdits}/${n} (${pct(summary.viaEdits)})   ← the contract`,
    `  sent the whole file:      ${summary.viaWholeFile}/${n} (${pct(summary.viaWholeFile)})   ← accepted, but retyped`,
    summary.noMatchRetry ? `  SEARCH missed, retried:   ${summary.noMatchRetry}/${n}` : "",
    summary.failed ? `  nothing usable:           ${summary.failed}/${n}` : "",
    `  dropped entities/pages:   ${summary.rewroteFirst}/${n} (${pct(summary.rewroteFirst)})   ← a reply lost structure; the loss retry fired`,
    `  still rewrote after retry: ${summary.rewroteFinal}/${n} (${pct(summary.rewroteFinal)})   ← what reaches the editor`,
    `  change landed:            ${rate(summary.landed, summary.landable)}   ← of cases with a structural check`,
    `  result validates:         ${rate(summary.validates, n)}`,
    repairRequested ? `  validates after repair:   ${rate(summary.validatesAfterRepair, n)}` : "",
    summary.declined ? `  declined (NOT-IN-APP):    ${summary.declined}/${n}   ← judged not the app's to change; excluded from landed` : "",
    `  refused when feasible:    ${rate(summary.refusedWhenFeasible, summary.feasible)}   ← a refusal of a case with a doable part: the ladder's failure`,
    summary.partial ? `  named what it could not do: ${summary.namedNotDone}/${summary.partial}   ← of cases with a part the host cannot do` : "",
    summary.crashed ? `  crashed:                  ${summary.crashed}/${n}` : "",
    ...classes.flatMap((k) => {
      const b = summary.byClass[k]!;
      if (!b.n || k === "wrong-gate") return [];
      return [`  class ${k.padEnd(13)} landed ${b.landed}/${b.n}, validates ${b.validates}/${b.n}${k === "platform" ? `, named what Potyro lacks ${b.namedNotDone}/${b.n}` : ""}`];
    }),
    ...conversationLines(),
    ...(ls
      ? [
          `  gave up, by cause:        repeated ${ls.gaveUp.repeated} · candidates ${ls.gaveUp.candidates} · steps ${ls.gaveUp.steps} · engine ${ls.gaveUp.engine}${ls.asked ? ` · asked the person ${ls.asked}` : ""}`,
          `  repeats seen:             ${ls.repeatsSeen}   fresh starts: ${ls.restarts}`,
          `  asked the Potyro team:    ${ls.platformRequests}/${ls.cases}${summary.byClass.platform?.n ? ` (platform cases: ${outcomes.filter((o) => o.class === "platform" && o.loop?.platformRequest).length}/${summary.byClass.platform.n})` : ""}   ← NEEDS-PLATFORM (#263)`,
          `  passed on candidate:      1st ${ls.passedOn["1"]} · 2nd ${ls.passedOn["2"]} · 3rd ${ls.passedOn["3"]} · 4th+ ${ls.passedOn["4+"]}`,
          `  model calls:              ${ls.calls} (${(ls.calls / Math.max(1, ls.cases)).toFixed(1)} a case)`,
          `  tokens:                   ${ls.promptTokens} in + ${ls.completionTokens} out (${Math.round(ls.tokensPerCase)} a case)`,
          `  cost:                     ${money(ls.cost)} (${money(ls.costPerCase)} a case)${ls.unpriced ? `   ← ${ls.unpriced} calls carried no cost: a floor` : ""}`,
        ]
      : []),
    ...(summary.language
      ? [
          `  new labels in the app's language: ${rate(summary.language.labelsPassed, summary.language.labelsChecked)} of cases that added a label it could read` +
            ` (${summary.language.labels.inExpected} labels in it, ${summary.language.labels.inOther} in another, ${summary.language.labels.unknown} too short to tell)`,
          `  reply in ${LANGUAGE_NAMES[summary.language.person]}:${" ".repeat(Math.max(1, 14 - LANGUAGE_NAMES[summary.language.person].length))}${rate(summary.language.repliesPassed, summary.language.repliesChecked)} of cases with a reply it could read`,
        ]
      : []),
    ...(deadEnds.length
      ? [`  wrong gate (#276), how it ended: ${deadEnds.map((o) => `${o.id} ${o.loop ? (o.loop.cause ?? o.loop.ended) : "crashed"} after ${o.loop?.calls ?? 0} calls`).join("; ")}`]
      : []),
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
