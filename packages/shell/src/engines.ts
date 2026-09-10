// Which model answers, as ONE choice.
//
// This was four buttons and three dropdowns spread across the controls column, and the engine an
// edit would use was a side effect of whichever button you last pressed — so editing with the cloud
// meant pressing "Cloud" first, which replaced the app you were trying to edit. One engine, chosen
// deliberately in one place, is what removes that whole class of surprise.

import { OPENROUTER_MODELS, WEBLLM_MODELS } from "@karta/generator/backends";

export type Engine = "cli" | "edge" | "builtin" | "anthropic" | "openrouter";

/** Everything the Studio needs to reach a model. Keys are held in memory only — never persisted. */
export interface EngineConfig {
  engine: Engine;
  anthropicKey: string;
  openrouterKey: string;
  openrouterModel: string;
  edgeModel: string;
}

export interface EngineChoice {
  id: Engine;
  label: string;
  group: "On this machine" | "Cloud";
  blurb: string;
  /** Cloud engines cannot run without the user's own key. */
  needsKey?: boolean;
  /**
   * Can this engine drive the investigate loop — an agent that looks into a reported bug by
   * calling TOOLS (replay the recording, inspect the app, size up the data) across several turns,
   * instead of guessing in one shot? That needs a backend that both exposes a `ChatEngine`
   * (generator/src/chat-backend.ts) AND can carry `tools`/`tool_calls` through that engine. It is
   * NOT about whether the engine can write or edit an app — every engine here does that today.
   */
  canInvestigate: boolean;
}

export const ENGINES: readonly EngineChoice[] = [
  {
    id: "cli",
    label: "claude -p",
    group: "On this machine",
    blurb: "Rides your Claude Code CLI login. No API key, but only while the dev server is running.",
    // ClaudeCliBackend shells out to `claude -p` for one completion per call — a one-shot POST,
    // not a ChatEngine, so there is no transcript to hang a multi-step tool loop off of.
    canInvestigate: false,
  },
  {
    id: "edge",
    label: "On-device",
    group: "On this machine",
    blurb: "A small coder model in the browser via WebGPU. Fully offline once the weights are cached.",
    // WebLLMBackend holds its ChatEngine as `private readonly` — never exposed for reuse — and
    // MLC's OpenAI shim mostly doesn't honor tool calls even if it were. A ~1.5B on-device model
    // is also a poor multi-step investigator regardless of plumbing.
    canInvestigate: false,
  },
  {
    id: "builtin",
    label: "Chrome built-in",
    group: "On this machine",
    blurb: "Chrome's built-in Gemini Nano. Runs locally, nothing to download.",
    // GeminiNanoBackend has no chat shape at all — no ChatEngine, no tools, no tool_calls.
    canInvestigate: false,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    group: "Cloud",
    blurb: "Claude, with your own API key.",
    needsKey: true,
    // ClaudeBackend implements ModelBackend directly against the Messages API — it never extends
    // ChatBackend, so it has no ChatEngine surface, even though Claude itself supports tool calls.
    canInvestigate: false,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    group: "Cloud",
    blurb: "One key, any hosted model — DeepSeek, Qwen, Llama. Cheap models are the point of measuring.",
    needsKey: true,
    // OpenRouterBackend extends ChatBackend and createOpenRouterEngine returns a real ChatEngine
    // over OpenRouter's OpenAI-compatible API, which carries `tools`/`tool_calls` end to end — the
    // only engine here that actually satisfies both halves of the requirement.
    canInvestigate: true,
  },
];

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  engine: "cli",
  anthropicKey: "",
  openrouterKey: "",
  openrouterModel: OPENROUTER_MODELS[0]!.id,
  edgeModel: WEBLLM_MODELS[1]!.id,
};

export function isCloud(engine: Engine): boolean {
  return engine === "anthropic" || engine === "openrouter";
}

/**
 * Can this engine drive the investigate loop? Ask the data (`EngineChoice.canInvestigate`) rather
 * than hardcoding an id list here — a future engine only needs to answer honestly in `ENGINES`.
 */
export function canInvestigate(engine: Engine): boolean {
  return ENGINES.find((e) => e.id === engine)?.canInvestigate ?? false;
}

/** The key the CURRENT engine needs, or "" when it needs none. */
export function keyFor(cfg: EngineConfig): string {
  if (cfg.engine === "anthropic") return cfg.anthropicKey;
  if (cfg.engine === "openrouter") return cfg.openrouterKey;
  return "";
}

/** Can this engine run right now? Used to gate the one button that drives everything. */
export function engineReady(cfg: EngineConfig): boolean {
  return !isCloud(cfg.engine) || keyFor(cfg).length > 0;
}

/** How the engine names itself in the UI — on the settings button and in every progress line. */
export function engineLabel(cfg: EngineConfig): string {
  const base = ENGINES.find((e) => e.id === cfg.engine)?.label ?? cfg.engine;
  if (cfg.engine === "openrouter") {
    const m = OPENROUTER_MODELS.find((x) => x.id === cfg.openrouterModel);
    return `${base} · ${m?.label ?? cfg.openrouterModel}`;
  }
  if (cfg.engine === "edge") {
    const m = WEBLLM_MODELS.find((x) => x.id === cfg.edgeModel);
    return `${base} · ${m?.label ?? cfg.edgeModel}`;
  }
  return base;
}
