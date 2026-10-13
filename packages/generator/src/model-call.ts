// One model call, and what it cost — the unit the modification harness is accounted in.
//
// `ModelBackend` answers "what source came back" and nothing else. That is enough to score an app
// and not enough to run a paid corpus: a run you cannot attribute to a model, a duration and a
// number of tokens is a bill you can only reconcile afterwards, and a ceiling you cannot enforce is
// not a ceiling. So every call the harness makes goes through `callModel`, which times it, asks the
// backend what it knows, and records the rest as UNKNOWN.
//
// ## `null` means unknown, and never anything else
//
// The one rule this file exists to hold: a number that was not reported is `null`. Not zero, not an
// average of the other calls, not tokens × a price list. A run that quietly estimated its own cost
// would be worse than one that admits it cannot measure it — the whole point of the budget is that
// somebody is deciding whether to spend more money on the strength of it.
//
// ## A reply is not a source, and a modify reply least of all
//
// A backend hands back what the model SAID. For `generate` and `repair` that is a source in prose,
// and `extractSource` picks it out. For `modify` it is one of three things — SEARCH/REPLACE edits, a
// whole file, or a `NOT-IN-APP:` verdict — and only the middle one is a source. So `callModel` reads
// a modify reply through `readModifyReply`, the same reader the product uses, and returns the source
// the edits produced. Treating the raw reply as a source here would have scored edit blocks as an
// app: it compiles nothing, validates nothing, and the report would have been confidently wrong.
//
// The product applies edits through that reader inside `guardedModify`, which gets up to two more
// turns: one when a SEARCH block matches nothing, one when the result drops an entity or a page.
// This harness deliberately makes ONE call per step, because a step whose cost is the sum of an
// unknown number of retries cannot be attributed. So it is slightly MORE pessimistic than the
// product on a SEARCH miss: what the product would recover from with a second turn is recorded here
// as a step that produced nothing. That is the intended trade — do not add the retries back.

import type { GenPrompt, ModelBackend } from "./backend.js";
import { readModifyReply } from "./guarded-modify.js";
import { describeEditFailures } from "./edits.js";
import { extractSource, type ModifyContext } from "./prompt.js";

export type CallKind = "generate" | "modify" | "repair";

/** What a backend was able to observe about one call. Every field is nullable: see the header. */
export interface CallUsage {
  /** The model that actually answered, when the backend names one. */
  model: string | null;
  /** Input tokens, INCLUDING cache reads/writes when the backend reports them separately. */
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export const UNKNOWN_USAGE: CallUsage = { model: null, inputTokens: null, outputTokens: null, costUsd: null };

/** One completed model call: what it was for, what it cost, and whether it worked. */
export interface ModelCall extends CallUsage {
  kind: CallKind;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  /** A call that threw. It still took time and may still have been billed, so it is still recorded. */
  failed: boolean;
  error?: string;
}

export type MeteredRequest =
  | { kind: "generate"; prompt: GenPrompt }
  | { kind: "modify"; source: string; instruction: string; prompt: GenPrompt; ctx?: ModifyContext }
  | { kind: "repair"; source: string; errors: string[]; prompt: GenPrompt };

export interface MeteredResult {
  /**
   * What the model SAID, verbatim — not a source.
   *
   * Named `text` because for a `modify` it is usually not source at all but edit blocks, and a field
   * called `source` invited every caller to score it as one. `callModel` is what turns a reply into
   * a source, per kind.
   */
  text: string;
  usage: CallUsage;
}

/**
 * A backend that can say what a call cost.
 *
 * One method taking a discriminated request rather than three parallel `*Metered` methods, so a
 * backend cannot implement metering for `generate` and forget it for `modify` — which is exactly
 * the shape of under-reporting that would make a chain look cheaper than it was.
 */
export interface MeteredBackend extends ModelBackend {
  meteredCall(req: MeteredRequest): Promise<MeteredResult>;
}

export function isMetered(backend: ModelBackend): backend is MeteredBackend {
  return typeof (backend as Partial<MeteredBackend>).meteredCall === "function";
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Squash a model's prose onto one line, so a `ModelCall.error` stays a line and not a page. */
function oneLine(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Turn one reply into the source the caller wanted, or say why there is none.
 *
 * `generate` and `repair` answer with a source in prose. `modify` answers with edits, a whole file,
 * or a refusal — so it goes through `readModifyReply`, and the source is what the edits PRODUCED.
 * See this file's header for why the harness stops at the first reply where the product retries.
 */
function readReply(req: MeteredRequest, text: string): { source: string; error?: undefined } | { source?: undefined; error: string } {
  if (req.kind !== "modify") return { source: extractSource(text) };

  const reply = readModifyReply(req.source, text);
  switch (reply.kind) {
    case "edits":
    case "whole-file":
      return { source: reply.source };
    case "diagnosis":
      return { error: `the model declined: ${oneLine(reply.text)}` };
    case "no-match":
      return { error: `edits did not apply: ${oneLine(describeEditFailures(reply.failures))}` };
    case "unusable":
      return { error: `no change in the reply: ${oneLine(reply.text)}` };
  }
}

/** Run `req` against an unmetered backend, returning the model's reply verbatim. */
async function plainCall(backend: ModelBackend, req: MeteredRequest): Promise<string> {
  switch (req.kind) {
    case "generate":
      return backend.generate(req.prompt);
    case "modify":
      if (!backend.modify) throw new Error(`backend "${backend.name}" cannot modify`);
      return backend.modify(req.source, req.instruction, req.prompt);
    case "repair":
      if (!backend.repair) throw new Error(`backend "${backend.name}" cannot repair`);
      return backend.repair(req.source, req.errors, req.prompt);
  }
}

/**
 * Make one model call and account for it.
 *
 * Never throws. A failed call is returned as a `ModelCall` with `failed: true` and no source,
 * because a call that errored after two minutes still spent two minutes and probably still spent
 * money — dropping it on the floor would understate every total in the report.
 */
export async function callModel(
  backend: ModelBackend,
  req: MeteredRequest,
): Promise<{ source: string | null; call: ModelCall }> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const finish = (usage: CallUsage, failed: boolean, error?: string): ModelCall => {
    const ended = Date.now();
    return {
      kind: req.kind,
      startedAt,
      endedAt: new Date(ended).toISOString(),
      durationMs: ended - started,
      ...usage,
      failed,
      ...(error ? { error } : {}),
    };
  };

  try {
    const { text, usage } = isMetered(backend)
      ? await backend.meteredCall(req)
      : { text: await plainCall(backend, req), usage: UNKNOWN_USAGE };
    const read = readReply(req, text);
    // A reply that could not be read is NOT a failed call: it happened, it took time, and it was
    // billed. `failed` is reserved for a call that threw, so the two stay tellable apart in the
    // report — "the model answered something unusable" and "the model never answered" are different
    // problems with different fixes.
    if (read.error !== undefined) return { source: null, call: finish(usage, false, read.error) };
    return { source: read.source, call: finish(usage, false) };
  } catch (e) {
    return { source: null, call: finish(UNKNOWN_USAGE, true, message(e)) };
  }
}

// ---- budget ------------------------------------------------------------------------------------

export interface BudgetLimits {
  /** Hard stop on the number of model calls, failures included. */
  maxCalls?: number;
  /** Hard stop on reported spend. Only enforceable when the backend reports cost — see `stopReason`. */
  maxCostUsd?: number;
  /**
   * Keep going when `maxCostUsd` is set and the backend turns out not to report cost.
   *
   * Off by default on purpose. A monetary ceiling over a backend that cannot report spend is a
   * number in a config file, and running a paid corpus behind one would be the single most
   * expensive way to discover that. Opting in is a person saying "I know it is unmetered".
   */
  allowUnmetered?: boolean;
}

/**
 * The spend gate for a run.
 *
 * Checked BEFORE each call (there is no way to un-spend one) and updated after. `stopReason`
 * becoming non-null is a graceful stop: the runner finishes accounting and writes the partial
 * report, rather than throwing away everything the run already learned.
 */
export class CallBudget {
  calls = 0;
  costUsd = 0;
  /** Calls whose cost the backend did not report. While this is non-zero, `costUsd` is a FLOOR. */
  unmeteredCalls = 0;
  totalDurationMs = 0;
  /**
   * Calls started and not yet accounted for.
   *
   * Counted so `--max-calls 15` means fifteen calls at `--concurrency 3` and not seventeen: without
   * it, three chains can each pass the check against the same total before any of them records.
   */
  private inFlight = 0;
  private reason: string | null = null;

  constructor(private readonly limits: BudgetLimits = {}) {}

  /** Why the run must stop, or null. */
  get stopReason(): string | null {
    return this.reason;
  }

  /** True when every call so far reported a cost, i.e. `costUsd` is the actual spend. */
  get costEnforceable(): boolean {
    return this.unmeteredCalls === 0;
  }

  /**
   * Room for one more call? Ask before spending.
   *
   * Reserves the slot when it answers yes, so a caller MUST follow a `true` with exactly one
   * `record`. Every path in the harness does; a caller that did not would slowly starve the budget.
   */
  canSpend(): boolean {
    if (this.reason) return false;
    const max = this.limits.maxCalls;
    if (max !== undefined && this.calls + this.inFlight >= max) {
      this.reason = `--max-calls ${max} reached`;
      return false;
    }
    this.inFlight += 1;
    return true;
  }

  record(call: ModelCall): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.calls += 1;
    this.totalDurationMs += call.durationMs;
    if (call.costUsd === null) this.unmeteredCalls += 1;
    else this.costUsd += call.costUsd;

    const { maxCalls, maxCostUsd, allowUnmetered } = this.limits;
    if (maxCalls !== undefined && this.calls >= maxCalls) {
      this.reason ??= `--max-calls ${maxCalls} reached`;
    }
    if (maxCostUsd === undefined) return;
    if (call.costUsd === null && !allowUnmetered) {
      // Fail closed. The alternative is spending a whole corpus under a ceiling that was never
      // going to fire, and only finding out from the invoice.
      this.reason ??=
        `--max-cost was set but the backend did not report the cost of a ${call.kind} call; ` +
        `re-run with --allow-unmetered to accept an unenforceable ceiling`;
      return;
    }
    if (this.costUsd >= maxCostUsd) {
      this.reason ??= `--max-cost ${maxCostUsd} reached (spent ${this.costUsd.toFixed(4)})`;
    }
  }
}
