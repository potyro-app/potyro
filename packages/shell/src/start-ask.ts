// The one place Ask's (#213) pieces meet: the person's request, the app's definition, and a model.
//
// Same engine rules as `startFix` (start-fix.ts), for the same reasons: the loop needs a chat engine
// that can call tools, and today the only client wired for that is OpenRouter's. Refusals come back
// as an outcome, never a throw, so the panel renders one shape for "this cannot run".
//
// Only the DEFINITION goes in. No store, no runtime, no records: the model sees how the app is
// organised and nothing that is in it (packages/generator/src/agent/ask.ts). Outside data comes
// through `fetchSource`, which holds the keys; the loop only ever sees what came back.

import type { AppDefinition } from "potyro";
import { runAskLoop, type AskContext, type AskOutcome, type AskSource, type AskStep, type SourceFetch } from "@potyro/generator/agent";
import type { ChatMessage } from "@potyro/generator/agent";
import { createOpenRouterEngine } from "@potyro/generator/backends";
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
  /** Outside data the model may read, and the host that fetches it (ask-sources.ts). */
  sources?: AskSource[];
  fetchSource?: SourceFetch;
  /** The date, language and map area the dialog shows the person before sending. */
  context?: AskContext;
  /** Let the model search the web when it needs to (OpenRouter's search; a few cents a request). */
  webSearch?: boolean;
  /** Carry on after a question: its transcript, with the person's reply appended. */
  resumeFrom?: ChatMessage[];
  /** A paste or a file the person brought, to turn into records (ask-material.tsx). */
  material?: { label: string; text: string };
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
      sources: opts.sources,
      fetchSource: opts.fetchSource,
      context: opts.context,
      webSearch: opts.webSearch,
      resumeFrom: opts.resumeFrom,
      material: opts.material,
      onStep: opts.onStep,
      signal: opts.signal,
    });
  } catch (e) {
    const spent = (e as { spent?: number } | null)?.spent;
    const cost = typeof spent === "number" ? { spent } : {};
    if (opts.signal?.aborted) return { kind: "stopped", ...cost };
    return { kind: "failed", reason: e instanceof Error ? e.message : String(e), ...cost };
  }
}
