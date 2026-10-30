// The one place the creating agent's pieces meet (#262 phase 3) — the create counterpart of
// start-modify.ts.
//
// The loop (`runCreateLoop`), its tools (`buildCreateTools`: lookup, the corpus, and a `check` that
// takes a whole app), the prompt that explains them, the check gate (`buildAndValidate`, the same
// validator the preview runs) and the run (`runCandidate`: sample records, every page mounted, in the
// isolate) are each built elsewhere; this constructs `CreateLoopDeps` for real. A new app has no
// original, so the run is judged on its own — the loop holds an app back for what threw, never for a
// page that showed nothing on sample data.

import { runCreateLoop, buildCreateTools, CREATE_AGENT_SYSTEM_PROMPT, type CreateLoopOutcome, type LoopStep } from "@potyro/generator/agent";
import { createOpenRouterEngine, loadCorpus, type Language } from "@potyro/generator/backends";
import { thinkingFor, type EngineConfig } from "./engines.js";
import { buildAndValidate } from "./validate-app.js";
import { runCandidate } from "./run-candidate.js";
import { loopEngineOptions, modifyLoopRefusal } from "./start-modify.js";

export interface StartCreateOpts {
  /** What the person asked for: everything said since the app last changed, questions and answers included. */
  brief: string;
  engine: EngineConfig;
  /** The person's language (#301): the app's words and any question are written in it. */
  language?: Language;
  /** Independent first drafts, at most. The loop's default (2) when absent. */
  drafts?: number;
  onStep?: (step: LoopStep) => void;
  signal?: AbortSignal;
}

/** Whether this engine can drive the create loop — the same engines that drive the modify loop. */
export const createLoopRefusal = modifyLoopRefusal;

export async function startCreate(opts: StartCreateOpts): Promise<CreateLoopOutcome> {
  const refused = createLoopRefusal(opts.engine);
  if (refused) return { kind: "failed", reason: refused, cause: "engine" };
  const check = (source: string): Promise<string[]> => buildAndValidate(source);
  const run = (source: string) => runCandidate(source);
  const chat = loopEngineOptions(opts.engine);
  return runCreateLoop({
    // How hard the model thinks is the person's setting (#280); the escalation is its own switch.
    engine: createOpenRouterEngine(chat),
    model: chat.model,
    escalate: thinkingFor(opts.engine).escalate,
    tools: buildCreateTools({ check, run, corpus: loadCorpus }),
    // The passages from this release's examples and docs that speak to the request go in the first message.
    corpus: loadCorpus,
    system: CREATE_AGENT_SYSTEM_PROMPT,
    brief: opts.brief,
    ...(opts.language ? { language: opts.language } : {}),
    ...(opts.drafts ? { drafts: opts.drafts } : {}),
    check,
    run,
    onStep: opts.onStep,
    signal: opts.signal,
  });
}
