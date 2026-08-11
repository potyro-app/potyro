// Browser-safe generator entrypoint: the model backends + prompt assembly only. Excludes the eval
// scorer (score.ts / run-eval.ts import Node-only esbuild + fs), so the shell can `import
// "@karta/generator/backends"` for the "Describe an app…" panel without pulling Node modules into
// the browser bundle. The full package barrel (with the harness) stays Node-only.

export type { GenPrompt, ModelBackend } from "./backend.js";
export { FixtureBackend } from "./backend.js";
export { SYSTEM_PROMPT, buildUserMessage, buildRepairMessage, buildModifyMessage, extractSource, looksLikeApp, parseModifyReply, NOT_IN_APP } from "./prompt.js";
export type { ModifyContext, ModifyReply } from "./prompt.js";
export { ClaudeBackend, createClaudeBackend, type MessagesClient } from "./claude-backend.js";
export { WebLLMBackend, createWebLLMBackend, WEBLLM_MODELS, type ChatEngine, type WebLLMModel } from "./webllm-backend.js";
export {
  GeminiNanoBackend,
  createGeminiNanoBackend,
  hasBuiltInAI,
  getPromptModel,
  type PromptModel,
  type PromptSession,
} from "./gemini-nano-backend.js";
export { HybridBackend } from "./hybrid-backend.js";
export { PROMPTS } from "./prompts.js";

// The concurrency gate, for the shell. `smokeApp`'s single-user checks stay out of the browser
// bundle — nothing there runs them — but the two-peer ones are a product feature: they are what
// tells someone their app is unsafe to share.
export {
  concurrencyChecks,
  concurrencySmoke,
  concurrencyPassed,
  type ConcurrencyDeps,
  type ConcurrencyResult,
  type Hazard,
} from "./concurrency-smoke.js";
export { seedRecords } from "./smoke.js";

