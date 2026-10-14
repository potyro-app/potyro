// One create case through the create LOOP (#262 phase 3), as `eval:cli --loop` runs it: the
// product's loop (`runCreateLoop`) with the eval's own gates — `scoreSource` for compile + validate,
// the smoke run for "does its logic run" — and every call metered. Node-only (esbuild via score.ts),
// so it is reached from the eval scripts and tests, never from the agent barrel.
//
// What it returns is what the runner reports per case: the app the loop ended with (or the best
// candidate it gave up on — the eval scores that, as it scores a single-shot app that fails), how the
// loop ended, and what it cost.

import type { ChatEngine } from "./chat-backend.js";
import { runCreateLoop, type CreateLoopOutcome } from "./agent/create-loop.js";
import { buildCreateTools } from "./agent/discovery-tools.js";
import { CREATE_AGENT_SYSTEM_PROMPT } from "./agent/create-system-prompt.js";
import type { LoopStep } from "./agent/loop.js";
import { loadCorpus } from "./load-corpus.js";
import type { Corpus } from "./corpus.js";
import type { Language } from "./language.js";
import { loadApp, scoreSource } from "./score.js";
import { smokeApp, smokeReport } from "./smoke.js";
import type { RunReport } from "./run-report.js";
import { meteredEngine, newMeter, stepTracer, type LoopRecord } from "./loop-eval.js";

export interface CreateCaseOpts {
  engine: ChatEngine;
  model?: string;
  /** The request, in the person's words. */
  brief: string;
  language?: Language;
  /** Independent first drafts, at most (the loop's default, 2, when absent). */
  drafts?: number;
  escalate?: boolean;
  /** Without it, the release's corpus. */
  corpus?: () => Promise<Corpus>;
  /** Every step, for the case's steps log. */
  onStep?: (step: LoopStep) => void;
  signal?: AbortSignal;
}

export interface CreateCaseResult {
  /** The app the loop kept, or the best candidate it gave up on; "" when it sent none. */
  source: string;
  outcome: CreateLoopOutcome;
  record: LoopRecord;
}

/** The eval's gate: compile + validate, the way `scoreSource` judges them. Throws when it does not compile. */
export async function evalCheck(source: string): Promise<string[]> {
  const r = await scoreSource(source);
  if (!r.compiles) throw new Error(r.errors.join("; "));
  return r.validates ? [] : r.errors;
}

/** The eval's run: the smoke run on sample records, as a report. */
export async function evalRun(source: string): Promise<RunReport> {
  return smokeReport(await smokeApp((await loadApp(source)) as never));
}

export async function createCase(opts: CreateCaseOpts): Promise<CreateCaseResult> {
  const meter = newMeter();
  const tracer = stepTracer();
  const corpus = opts.corpus ?? loadCorpus;
  const outcome = await runCreateLoop({
    engine: meteredEngine(opts.engine, meter),
    ...(opts.model ? { model: opts.model } : {}),
    tools: buildCreateTools({ check: evalCheck, run: evalRun, corpus }),
    corpus,
    system: CREATE_AGENT_SYSTEM_PROMPT,
    brief: opts.brief,
    ...(opts.language ? { language: opts.language } : {}),
    ...(opts.drafts ? { drafts: opts.drafts } : {}),
    ...(opts.escalate ? { escalate: true } : {}),
    check: evalCheck,
    run: evalRun,
    ...(opts.signal ? { signal: opts.signal } : {}),
    onStep: (s) => {
      tracer.onStep(s);
      opts.onStep?.(s);
    },
  });
  const source = outcome.kind === "source" ? outcome.source : outcome.kind === "failed" ? (outcome.best ?? "") : "";
  const platformRequest = outcome.kind === "platform" || ((outcome.kind === "source" || outcome.kind === "failed") && outcome.platformRequest);
  return {
    source,
    outcome,
    record: {
      ...tracer.read(),
      ended: outcome.kind,
      ...(platformRequest ? { platformRequest: true } : {}),
      cause: outcome.kind === "failed" ? outcome.cause : null,
      calls: meter.calls,
      promptTokens: meter.promptTokens,
      completionTokens: meter.completionTokens,
      cost: meter.cost,
      unpriced: meter.unpriced,
    },
  };
}
