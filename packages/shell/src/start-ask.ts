// The one place Ask's (#213) pieces meet: the person's request, the app's definition, and a model.
//
// Same engine rules as `startFix` (start-fix.ts), for the same reasons: the loop needs a chat engine
// that can call tools, and today the only client wired for that is OpenRouter's. Refusals come back
// as an outcome, never a throw, so the panel renders one shape for "this cannot run".
//
// Only the DEFINITION goes in. No store, no runtime, no records: the model sees how the app is
// organised and nothing that is in it (packages/generator/src/agent/ask.ts).

import type { AppDefinition } from "karta";
import { runAskLoop, type AskOutcome, type AskStep } from "@karta/generator/agent";
import { createOpenRouterEngine } from "@karta/generator/backends";
import type { EngineConfig } from "./engines.js";

export type StartAskOutcome = AskOutcome | { kind: "refused"; text: string };

/** Why Ask cannot run on this engine, in words for the person — or null when it can. */
export function askRefusal(cfg: EngineConfig): string | null {
  if (cfg.engine !== "openrouter") return "Ask needs a cloud model. Choose OpenRouter in the Studio’s Model settings.";
  if (!cfg.openrouterKey) return "Ask needs your OpenRouter key. Add it in the Studio’s Model settings.";
  return null;
}

export async function startAsk(opts: {
  definition: AppDefinition;
  request: string;
  engine: EngineConfig;
  onStep?: (step: AskStep) => void;
  signal?: AbortSignal;
}): Promise<StartAskOutcome> {
  const refused = askRefusal(opts.engine);
  if (refused) return { kind: "refused", text: refused };
  try {
    return await runAskLoop({
      engine: createOpenRouterEngine({ apiKey: opts.engine.openrouterKey, model: opts.engine.openrouterModel }),
      model: opts.engine.openrouterModel,
      definition: opts.definition,
      request: opts.request,
      onStep: opts.onStep,
      signal: opts.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) return { kind: "stopped" };
    return { kind: "failed", reason: e instanceof Error ? e.message : String(e) };
  }
}
