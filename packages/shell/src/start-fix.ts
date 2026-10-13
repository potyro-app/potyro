// The one place the fixing agent's pieces meet.
//
// The loop (`runAgentLoop`), the tools it calls (`buildAppTools`), the prompt that explains them
// (`AGENT_SYSTEM_PROMPT`), the verification gate (`verifyCandidate`), the case someone recorded,
// and a model backend (`createOpenRouterEngine`) are each built and tested in isolation. Nothing
// before this file ever constructed a `LoopDeps` for real — this is where that finally happens.

import type { Store } from "@potyro/store";
import { replayCase, replayPassed, type Case, type ReplayTarget } from "@potyro/runtime";
import type { PotyroRuntime } from "@potyro/runtime";
import {
  runAgentLoop,
  buildAppTools,
  AGENT_SYSTEM_PROMPT,
  type LoopDeps,
  type LoopOutcome,
  type LoopStep,
} from "@potyro/generator/agent";
import { createOpenRouterEngine, type Language } from "@potyro/generator/backends";
import { canInvestigate, isCloud, keyFor, type EngineConfig } from "./engines.js";
import { verifyCandidate } from "./verify-candidate.js";
import type { ModuleSource } from "./package-modules.js";

export interface StartFixOpts {
  /** The current app's source — what the agent starts from and, if it gives up, the last thing tried. */
  source: string;
  /** What the person recorded: what they did, and what they expected. */
  theCase: Case;
  /** The CURRENT app's runtime — used to compute the baseline and to answer `query_data`/`replay_case`. */
  runtime: PotyroRuntime;
  /** The app's real store. Read-only inside verification (see `verifyCandidate`); never written here. */
  store: Store;
  engine: EngineConfig;
  onStep?: (step: LoopStep) => void;
  signal?: AbortSignal;
  resumeFrom?: LoopDeps["resumeFrom"];
  /** The app's libraries and own modules (#266, #258), when it has any. */
  modules?: ModuleSource;
  /** The person's language (#301): the explanation and any question come back in it. English when absent. */
  language?: Language;
}

/**
 * Refuse an engine that cannot drive the investigate loop, or a cloud engine with no key — as an
 * outcome, not a throw. The caller already knows how to render a `LoopOutcome`; a thrown error
 * would be a second shape for the same situation ("this cannot run") and every caller would need
 * to handle both. Checked before anything else runs (before the baseline replay, before building
 * tools) so refusing costs nothing.
 */
function refusal(cfg: EngineConfig): LoopOutcome | undefined {
  if (!canInvestigate(cfg.engine)) {
    return {
      kind: "refused",
      text:
        `${cfg.engine} cannot investigate this — it has no transcript to hang a multi-step tool ` +
        `loop off of (claude -p is a one-shot completion, not a chat engine). Pick a cloud engine, ` +
        `like OpenRouter, to drive the loop.`,
    };
  }
  if (isCloud(cfg.engine) && !keyFor(cfg)) {
    return {
      kind: "refused",
      text: `${cfg.engine} needs your own API key to investigate — add one in Engine Settings.`,
    };
  }
  return undefined;
}

/** The app source a transcript's opening user turn showed the model, or null when it shows none. */
export function sourceShownIn(transcript: NonNullable<LoopDeps["resumeFrom"]>): string | null {
  const opening = transcript.find((m) => m.role === "user");
  const text = typeof opening?.content === "string" ? opening.content : null;
  const match = text ? /The app as it is:\n```ts\n([\s\S]*)\n```\s*$/.exec(text) : null;
  return match ? match[1]! : null;
}

/** Build the `ReplayTarget` the same way `App.tsx` and `verify-candidate.ts` do: `definition` plus a
 *  `query` that unwraps `queryPage`'s `{ rows }`. `runAction` is deliberately never supplied — an
 *  action step would mutate the very records the bug report is about (see the SAFETY CRITICAL note
 *  on `ReplayTarget.runAction` in `packages/runtime/src/replay.ts`). */
function targetFor(runtime: PotyroRuntime): ReplayTarget {
  return {
    definition: runtime.definition,
    query: async (_entity, pageId) => (await runtime.queryPage(pageId)).rows,
  };
}

/**
 * Investigate a reported bug and, if the recording proves it, produce a fix. This is the only
 * place that constructs a `LoopDeps` for real.
 */
export async function startFix(opts: StartFixOpts): Promise<LoopOutcome> {
  const refused = refusal(opts.engine);
  if (refused) return refused;

  // Resuming after a question (#73): the agent reasons about the file it was SHOWN, but its edits
  // land on `opts.source`, read fresh now. If the app was saved in between, those are two files, and
  // the edits would be applied to one the model has never seen. Today both save paths reload the
  // page and destroy the question, but nothing enforced it — this does.
  if (opts.resumeFrom) {
    const shown = sourceShownIn(opts.resumeFrom);
    if (shown !== opts.source) {
      return {
        kind: "refused",
        text: "This app changed after the question was asked, so the answer would be applied to a version the agent never saw. Start the fix again.",
      };
    }
  }

  const target = targetFor(opts.runtime);

  // The baseline: the user's own case, replayed against the app AS IT IS, before any candidate
  // exists. This is what lets the loop answer "I cannot reproduce this" instead of verifying a
  // candidate against a check that was already green (see `LoopDeps.baseline` in loop.ts).
  const baselineReport = await replayCase(target, opts.theCase);
  const baseline = {
    passed: replayPassed(baselineReport),
    detail: baselineReport.outcomes.map((o) => `${o.ok ? "ok" : "FAILED"}: ${o.detail}`).join("\n"),
  };

  // The person's own words, verbatim: the case title, plus what they said they expected (lifted
  // out of the baseline report, which already found it). No paraphrasing, no instructions prepended
  // — the loop's system prompt already carries those.
  const task = [baselineReport.title, baselineReport.expectation]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join("\n\n");

  // Refuse — as an outcome, same as `refusal()` above — rather than spend a real model call on
  // zero signal. This is not hypothetical: `App.tsx` calls `recorder.start(appId, "")`, so a case's
  // title is ALWAYS "", and the "What did you expect?" note is optional (`hasRecordedActivity` only
  // requires an open/action step to save a recording). A recording with activity and no note yields
  // exactly this: `task === ""`, which would otherwise become `{ role: "user", content: "" }`. Runs
  // AFTER the baseline replay (local, free, and where `expectation` comes from) but BEFORE
  // `runAgentLoop` (the paid part). Never synthesize filler text here — declining to run IS the
  // point; inventing a problem statement would violate "the person's own words, unedited" above.
  if (!task.trim()) {
    return {
      kind: "refused",
      text:
        "There's nothing to investigate: this recording has no title and no note about what you " +
        'expected. Add a note when you record the case — "What did you expect?" — or give the case ' +
        "a title, and try again.",
    };
  }

  const tools = buildAppTools({
    source: opts.source,
    target,
    theCase: opts.theCase,
    // Shapes and counts only — never the user's raw records. `access: { locality: "cloud" }` is the
    // only variant this function may construct: the only engine that can drive this loop IS a cloud
    // one (that's what `canInvestigate` encodes above), so raw access is never justifiable here.
    records: (entity) => opts.runtime.ctx.query(entity),
    access: { locality: "cloud" },
  });

  // `refusal()` above checks THAT the engine can investigate and THAT a cloud key exists — never
  // WHICH cloud engine. Below this line the ONLY client this function knows how to build is
  // OpenRouter's. `canInvestigate` and "there is a client for this engine" are two separate facts
  // today (see engines.ts): if a future engine (say, "anthropic") flips `canInvestigate: true`,
  // `refusal()` would wave it through — `isCloud` is still true and `keyFor` still returns a real
  // key — straight into `createOpenRouterEngine({ apiKey: opts.engine.openrouterKey, ... })` with an
  // EMPTY `openrouterKey`. That function's own fallback is `apiKey ?? readEnv(...) ?? ""`, and `??`
  // does not catch an empty string, so it would send `Authorization: Bearer ` to OpenRouter — an
  // unhandled rejection escaping `runAgentLoop`, and therefore this function's never-throw contract.
  // (Or, with a stale `openrouterKey` lying around, it would succeed SILENTLY against a provider and
  // model the person never chose.) This guard is the one line that keeps those two facts from
  // silently disagreeing.
  if (opts.engine.engine !== "openrouter") {
    return {
      kind: "refused",
      text:
        `${opts.engine.engine} claims it can investigate this, but startFix has no client wired for ` +
        `it — only OpenRouter does today. This is a configuration bug, not a problem with your app.`,
    };
  }

  return runAgentLoop({
    engine: createOpenRouterEngine({ apiKey: opts.engine.openrouterKey, model: opts.engine.openrouterModel }),
    model: opts.engine.openrouterModel,
    tools,
    system: AGENT_SYSTEM_PROMPT,
    task,
    source: opts.source,
    ...(opts.language ? { language: opts.language } : {}),
    // Closed over the case and the real store — never the candidate's own claim about itself.
    verify: (source) =>
      verifyCandidate({
        source,
        theCase: opts.theCase,
        appStore: opts.store,
        modules: opts.modules,
        // The app AS IT IS, so a candidate cannot pass by deleting the feature it was meant to fix.
        original: opts.runtime.definition,
      }),
    baseline,
    onStep: opts.onStep,
    signal: opts.signal,
    resumeFrom: opts.resumeFrom,
  });
}
