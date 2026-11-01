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
import { sampleSeed, type AppSeed, type Entities } from "./app-seed.js";
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

/**
 * What the loop ended with; an app it made carries its sample records (#486) — the app's demo records,
 * what a link anyone can try opens on: the ones the loop asked the model for once the app passed its
 * run, each row checked as a use of the seed checks it (`sampleSeed`). None when its run threw, the
 * reply was not rows, or fewer than two fit — the app then opens on an empty copy.
 */
export type StudioCreateOutcome = Exclude<CreateLoopOutcome, { kind: "source" }> | (Extract<CreateLoopOutcome, { kind: "source" }> & { seed?: AppSeed });

export async function startCreate(opts: StartCreateOpts): Promise<StudioCreateOutcome> {
  const refused = createLoopRefusal(opts.engine);
  if (refused) return { kind: "failed", reason: refused, cause: "engine" };
  const check = (source: string): Promise<string[]> => buildAndValidate(source);
  /** The entities of each candidate that passed its run, by its source: what its sample records are asked for in, and checked against. */
  const passed = new Map<string, Entities>();
  const run = async (source: string) => {
    const { entities, ...report } = await runCandidate(source);
    if (!report.errors.length && entities) passed.set(source, entities);
    return report;
  };
  const chat = loopEngineOptions(opts.engine);
  const outcome = await runCreateLoop({
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
    samples: (source) => passed.get(source),
    onStep: opts.onStep,
    signal: opts.signal,
  });
  if (outcome.kind !== "source") return outcome;
  const { samples, ...made } = outcome;
  const seed = sampleSeed(samples, passed.get(made.source));
  return seed ? { ...made, seed } : made;
}
