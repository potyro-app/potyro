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
  createDraft,
  MODIFY_AGENT_SYSTEM_PROMPT,
  type LoopStep,
  type ModifyLoopDeps,
  type ModifyLoopOutcome,
  type ConversationEntry,
} from "@potyro/generator/agent";
import { createOpenRouterEngine, loadCorpus, regressionGate, type Language, type ModifyContext } from "@potyro/generator/backends";
import type { AppShape } from "@potyro/runtime";
import { canInvestigate, isCloud, keyFor, openRouterOptions, thinkingFor, type EngineConfig } from "./engines.js";
import { buildAndValidate, loadDefinition } from "./validate-app.js";
import { runCandidate } from "./run-candidate.js";
import { withLibrariesStoodIn, type ModuleSource } from "./package-modules.js";
import { unpackCandidate, unpackOrThrow, type JoinedApp } from "./joined-app.js";

export interface StartModifyOpts {
  /** The app as the person has it. */
  source: string;
  /** The change, in their words. */
  instruction: string;
  /** Where it was aimed: the part of the app they pointed at (#284). */
  context?: ModifyContext;
  /** The app's shape before the change — what a candidate must not lose. */
  before: AppShape;
  engine: EngineConfig;
  onStep?: (step: LoopStep) => void;
  signal?: AbortSignal;
  resumeFrom?: ModifyLoopDeps["resumeFrom"];
  /** The app's libraries and own modules (#266, #258): a candidate is checked with them. */
  modules?: ModuleSource;
  /**
   * The app as its files joined into one text (#448), when it has modules of its own: then `source` is
   * that text, and every gate splits a candidate back into its files before bundling it.
   */
  joined?: JoinedApp | null;
  /** The person's language (#301): the model's reply and questions come back in it. English when absent. */
  language?: Language;
  /** What was said about earlier versions (#279), oldest first: the loop's recap and `read_conversation`. */
  conversation?: readonly ConversationEntry[];
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
  if (refused) return { kind: "failed", reason: refused, cause: "engine" };
  // Every gate reads the app with its libraries standing in as inert values (#266): a library that
  // needs a full web page cannot start in the sealed box these checks run in, and with its real bytes
  // the app as the person has it failed the check too — so no change to it could ever pass. Its own
  // modules stay real; opening the app still runs, and checks, the real libraries.
  const modules = withLibrariesStoodIn(opts.modules);
  const joined = opts.joined ?? null;
  // A candidate of a joined app is split into its files first; marker lines it broke are its problem.
  const check = async (text: string): Promise<string[]> => {
    const u = await unpackCandidate(text, joined, modules);
    return u.ok ? buildAndValidate(u.source, u.modules) : [u.problem];
  };
  // A regression gate: the app as the person has it is run once, and a candidate is held back only
  // by what IT breaks — never by what was already failing (#262).
  const run = regressionGate(async (text) => {
    const u = await unpackOrThrow(text, joined, modules);
    return runCandidate(u.source, { modules: u.modules });
  }, opts.source);
  // What `translate` writes a language into, and what the loop's edits then apply to (#302).
  const draft = createDraft(opts.source);
  return runModifyLoop({
    // How hard the model thinks is the person's setting (#280); the escalation is its own switch.
    engine: createOpenRouterEngine(openRouterOptions(opts.engine)),
    model: opts.engine.openrouterModel,
    escalate: thinkingFor(opts.engine).escalate,
    tools: buildDiscoveryTools({ check, run, source: opts.source, draft }),
    // The passages from this release's examples and docs that speak to the request go in the first
    // message, so the model starts from how a real app does it (#262).
    corpus: loadCorpus,
    system: MODIFY_AGENT_SYSTEM_PROMPT,
    instruction: opts.instruction,
    context: opts.context,
    source: opts.source,
    ...(opts.language ? { language: opts.language } : {}),
    ...(opts.conversation?.length ? { conversation: opts.conversation } : {}),
    check,
    run,
    shapeOf: async (text) => {
      const u = await unpackOrThrow(text, joined, modules);
      return loadDefinition(u.source, u.modules);
    },
    before: opts.before,
    onStep: opts.onStep,
    signal: opts.signal,
    resumeFrom: opts.resumeFrom,
    draft,
  });
}
