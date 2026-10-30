// One model turn for whichever engine is chosen — shared by the Studio and Edit mode.
//
// Edit mode used to call the dev server's `claude -p` route and nothing else, so on a deployed build
// (no dev server) the agent was simply absent: someone whose app broke could not ask it to fix
// anything, even with their own key pasted in the Studio. The engine is one choice (engines.ts, held
// in engine-store.ts); this is the one place that turns that choice into a model call, so every
// surface that asks a model reaches the same one.

import { t } from "@lingui/core/macro";
import {
  SYSTEM_PROMPT,
  buildModifyMessage,
  createClaudeBackend,
  createGeminiNanoBackend,
  createOpenRouterBackend,
  createWebLLMBackend,
  type ModelBackend,
  type ModifyContext,
} from "@potyro/generator/backends";
import { chatEngineOptions, engineReady, type EngineConfig } from "./engines.js";
import { canGenerate, generateViaCli } from "./generate-client.js";

/** The backend for an in-browser engine. `claude -p` has none: it is the dev server's route. */
export async function backendFor(cfg: EngineConfig, onProgress?: (text: string) => void): Promise<ModelBackend & Required<Pick<ModelBackend, "modify">>> {
  switch (cfg.engine) {
    case "edge":
      return (await createWebLLMBackend({
        model: cfg.edgeModel,
        initProgressCallback: (p) => onProgress?.((p as { text?: string })?.text ?? t`Loading model`),
      })) as never;
    case "builtin":
      return (await createGeminiNanoBackend()) as never;
    case "openrouter":
    case "endpoint":
      return (await createOpenRouterBackend(chatEngineOptions(cfg)!)) as never;
    case "anthropic":
      return (await createClaudeBackend({ apiKey: cfg.anthropicKey, dangerouslyAllowBrowser: true })) as never;
    default:
      throw new Error("claude -p runs through the dev server, not in the browser");
  }
}

/** Can this engine be asked right now? `claude -p` only with the dev server; a cloud engine only with its key. */
export function canUseEngine(cfg: EngineConfig): boolean {
  return cfg.engine === "cli" ? canGenerate() : engineReady(cfg);
}

/**
 * One edit turn: the model's REPLY (SEARCH/REPLACE edits, a whole file, or a NOT-IN-APP verdict),
 * which `guardedModify` reads. `ctx` says which view the person pointed at, when they did.
 */
export async function modifyTurn(opts: {
  engine: EngineConfig;
  source: string;
  instruction: string;
  ctx?: ModifyContext;
  onProgress?: (text: string, seconds?: number) => void;
}): Promise<string> {
  const { engine, source, instruction, ctx, onProgress } = opts;
  if (engine.engine === "cli") {
    const prompt = ["The current app:", "```ts", source, "```", "", buildModifyMessage(instruction, ctx, { source })].join("\n");
    return generateViaCli({ system: SYSTEM_PROMPT, prompt, onProgress: (s) => onProgress?.("Working", s) });
  }
  if (!engineReady(engine)) throw new Error(t`this engine needs its API key — add it in the Studio's Model settings.`);
  const backend = await backendFor(engine, (text) => onProgress?.(text));
  const started = Date.now();
  const timer = setInterval(() => onProgress?.("Working", Math.round((Date.now() - started) / 1000)), 1000);
  try {
    return await backend.modify(source, instruction, { id: "edit", description: instruction }, ctx);
  } finally {
    clearInterval(timer);
  }
}
