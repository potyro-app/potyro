// Which model answers, as ONE choice.
//
// This was four buttons and three dropdowns spread across the controls column, and the engine an
// edit would use was a side effect of whichever button you last pressed — so editing with the cloud
// meant pressing "Cloud" first, which replaced the app you were trying to edit. One engine, chosen
// deliberately in one place, is what removes that whole class of surprise.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { OPENROUTER_MODELS, WEBLLM_MODELS, thinkingOptions, type ReasoningLevel } from "@potyro/generator/backends";
import { i18n } from "@potyro/i18n";

export type Engine = "cli" | "edge" | "builtin" | "anthropic" | "openrouter";

/**
 * How hard the model thinks (#280), per engine: a level, and whether the modify loop thinks hard for
 * the one turn after it got stuck (docs/19 F6). Both are off by default: measured on the 66-run modify
 * eval (#293), high was within the noise for twice the cost, and the escalation showed no gain for 12%
 * more. A person who wants either turns it on.
 */
export interface ThinkingSetting {
  level: ReasoningLevel;
  escalate: boolean;
}
export const DEFAULT_THINKING: ThinkingSetting = { level: "off", escalate: false };

/** Everything the Studio needs to reach a model. Keys are held in memory only — never persisted. */
export interface EngineConfig {
  engine: Engine;
  anthropicKey: string;
  openrouterKey: string;
  openrouterModel: string;
  edgeModel: string;
  /** How hard each engine's model thinks; an engine with no entry uses DEFAULT_THINKING. */
  thinking?: Partial<Record<Engine, ThinkingSetting>>;
}

export type EngineGroup = "local" | "cloud";
/** The settings' two headings, in order. */
export const ENGINE_GROUPS: readonly { id: EngineGroup; label: MessageDescriptor }[] = [
  { id: "local", label: msg({ message: "On this machine", comment: "Model settings heading: engines that run on this computer" }) },
  { id: "cloud", label: msg({ message: "Cloud", comment: "Model settings heading: engines reached over the internet" }) },
];

export interface EngineChoice {
  id: Engine;
  /** A descriptor, read at use time, so the name follows a language switch. */
  label: MessageDescriptor;
  /** Which heading it sits under; `ENGINE_GROUPS` has the words. */
  group: EngineGroup;
  blurb: MessageDescriptor;
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
  /** Can the person choose how hard this engine's model thinks? Only where a client sends it (#280). */
  canThink?: boolean;
}

export const ENGINES: readonly EngineChoice[] = [
  {
    id: "cli",
    label: msg({ message: "claude -p", comment: "A command name; keep as is" }),
    group: "local",
    blurb: msg`Rides your Claude Code CLI login. No API key, but only while the dev server is running.`,
    // ClaudeCliBackend shells out to `claude -p` for one completion per call — a one-shot POST,
    // not a ChatEngine, so there is no transcript to hang a multi-step tool loop off of.
    canInvestigate: false,
  },
  {
    id: "edge",
    label: msg({ message: "On-device", comment: "Engine name: a model running in this browser" }),
    group: "local",
    blurb: msg`A small coder model in the browser via WebGPU. Fully offline once the weights are cached.`,
    // WebLLMBackend holds its ChatEngine as `private readonly` — never exposed for reuse — and
    // MLC's OpenAI shim mostly doesn't honor tool calls even if it were. A ~1.5B on-device model
    // is also a poor multi-step investigator regardless of plumbing.
    canInvestigate: false,
  },
  {
    id: "builtin",
    label: msg({ message: "Chrome built-in", comment: "Engine name: the model built into the Chrome browser" }),
    group: "local",
    blurb: msg`Chrome's built-in Gemini Nano. Runs locally, nothing to download.`,
    // GeminiNanoBackend has no chat shape at all — no ChatEngine, no tools, no tool_calls.
    canInvestigate: false,
  },
  {
    id: "anthropic",
    label: msg({ message: "Anthropic", comment: "Company name; keep as is" }),
    group: "cloud",
    blurb: msg`Claude, with your own API key.`,
    needsKey: true,
    // ClaudeBackend implements ModelBackend directly against the Messages API — it never extends
    // ChatBackend, so it has no ChatEngine surface, even though Claude itself supports tool calls.
    canInvestigate: false,
  },
  {
    id: "openrouter",
    label: msg({ message: "OpenRouter", comment: "Service name; keep as is" }),
    group: "cloud",
    blurb: msg`One key, any hosted model — DeepSeek, Qwen, Llama. Cheap models are the point of measuring.`,
    needsKey: true,
    // OpenRouterBackend extends ChatBackend and createOpenRouterEngine returns a real ChatEngine
    // over OpenRouter's OpenAI-compatible API, which carries `tools`/`tool_calls` end to end — the
    // only engine here that actually satisfies both halves of the requirement.
    canInvestigate: true,
    // `thinkingOptions` turns a level into OpenRouter's reasoning effort and a token budget.
    canThink: true,
  },
];

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  engine: "cli",
  anthropicKey: "",
  openrouterKey: "",
  openrouterModel: OPENROUTER_MODELS[0]!.id,
  edgeModel: WEBLLM_MODELS[1]!.id,
};

/** How hard the current engine's model thinks. */
export function thinkingFor(cfg: EngineConfig): ThinkingSetting {
  return { ...DEFAULT_THINKING, ...cfg.thinking?.[cfg.engine] };
}

/** The config with the current engine's thinking changed — a new object, the old one untouched. */
export function withThinking(cfg: EngineConfig, patch: Partial<ThinkingSetting>): EngineConfig {
  return { ...cfg, thinking: { ...cfg.thinking, [cfg.engine]: { ...thinkingFor(cfg), ...patch } } };
}

/** Everything an OpenRouter client needs from the config: the key, the model, and how hard it thinks. */
export function openRouterOptions(cfg: EngineConfig): { apiKey: string; model: string } & ReturnType<typeof thinkingOptions> {
  return { apiKey: cfg.openrouterKey, model: cfg.openrouterModel, ...thinkingOptions(thinkingFor({ ...cfg, engine: "openrouter" }).level) };
}

/** How a level reads on the engine's name. */
const THINKS: Record<ReasoningLevel, MessageDescriptor | null> = {
  off: null,
  low: msg({ message: "thinks a little", comment: "Shown after the model's name: its reasoning level is low" }),
  medium: msg({ message: "thinks more", comment: "Shown after the model's name: its reasoning level is medium" }),
  high: msg({ message: "thinks hard", comment: "Shown after the model's name: its reasoning level is high" }),
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
  const choice = ENGINES.find((e) => e.id === cfg.engine);
  const base = choice ? i18n._(choice.label) : cfg.engine;
  if (cfg.engine === "openrouter") {
    const m = OPENROUTER_MODELS.find((x) => x.id === cfg.openrouterModel);
    const level = THINKS[thinkingFor(cfg).level];
    const thinks = level ? i18n._(level) : "";
    return `${base} · ${m?.label ?? cfg.openrouterModel}${thinks ? ` · ${thinks}` : ""}`;
  }
  if (cfg.engine === "edge") {
    const m = WEBLLM_MODELS.find((x) => x.id === cfg.edgeModel);
    return `${base} · ${m?.label ?? cfg.edgeModel}`;
  }
  return base;
}
