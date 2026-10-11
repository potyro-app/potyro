// The one place the modifying agent's pieces meet (#131) — the modify counterpart of start-fix.ts.
//
// The loop (`runModifyLoop`), the discovery tools (`buildDiscoveryTools`), the prompt that explains
// them (`MODIFY_AGENT_SYSTEM_PROMPT`), the check gate (`buildAndValidate`, the same validator the
// preview runs) and the loss gate (`loadDefinition`, the same shape `guardedModify` compares) are
// each built elsewhere; this constructs `ModifyLoopDeps` for real. Since #262 a candidate that passes
// those is also RUN (`runCandidate`): on sample records, every page mounted, in the isolate — and
// compared with the app as first shown, so only what the change breaks holds it back.

import {
  runModifyLoop,
  buildDiscoveryTools,
  MODIFY_AGENT_SYSTEM_PROMPT,
  type LoopStep,
  type ModifyLoopDeps,
  type ModifyLoopOutcome,
} from "@potyro/generator/agent";
import { createOpenRouterEngine, regressionGate } from "@potyro/generator/backends";
import type { AppShape } from "@potyro/runtime";
import { canInvestigate, isCloud, keyFor, type EngineConfig } from "./engines.js";
import { buildAndValidate, loadDefinition } from "./validate-app.js";
import { runCandidate } from "./run-candidate.js";

export interface StartModifyOpts {
  /** The app as the person has it. */
  source: string;
  /** The change, in their words. */
  instruction: string;
  /** The app's shape before the change — what a candidate must not lose. */
  before: AppShape;
  engine: EngineConfig;
  onStep?: (step: LoopStep) => void;
  signal?: AbortSignal;
  resumeFrom?: ModifyLoopDeps["resumeFrom"];
}

/** Whether this engine can drive the modify loop at all (a chat engine with a key); else why not. */
export function modifyLoopRefusal(cfg: EngineConfig): string | undefined {
  if (!canInvestigate(cfg.engine)) return `${cfg.engine} is a one-shot completion, not a chat engine; it cannot use tools.`;
  if (isCloud(cfg.engine) && !keyFor(cfg)) return `${cfg.engine} needs your own API key — add one in Engine Settings.`;
  if (cfg.engine !== "openrouter") return `no client is wired for ${cfg.engine} here; only OpenRouter drives the loop today.`;
  return undefined;
}

export async function startModify(opts: StartModifyOpts): Promise<ModifyLoopOutcome> {
  const refused = modifyLoopRefusal(opts.engine);
  if (refused) return { kind: "failed", reason: refused };
  const check = (source: string): Promise<string[]> => buildAndValidate(source);
  // A regression gate: the app as the person has it is run once, and a candidate is held back only
  // by what IT breaks — never by what was already failing (#262).
  const run = regressionGate((source) => runCandidate(source), opts.source);
  return runModifyLoop({
    engine: createOpenRouterEngine({ apiKey: opts.engine.openrouterKey, model: opts.engine.openrouterModel }),
    model: opts.engine.openrouterModel,
    tools: buildDiscoveryTools({ check, run }),
    system: MODIFY_AGENT_SYSTEM_PROMPT,
    instruction: opts.instruction,
    source: opts.source,
    check,
    run,
    shapeOf: loadDefinition,
    before: opts.before,
    onStep: opts.onStep,
    signal: opts.signal,
    resumeFrom: opts.resumeFrom,
  });
}
