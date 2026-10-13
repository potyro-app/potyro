// Browser-safe generator entrypoint: the model backends + prompt assembly only. Excludes the eval
// scorer (score.ts / run-eval.ts import Node-only esbuild + fs), so the shell can `import
// "@potyro/generator/backends"` for the "Describe an app…" panel without pulling Node modules into
// the browser bundle. The full package barrel (with the harness) stays Node-only.

export type { GenPrompt, ModelBackend } from "./backend.js";
export { FixtureBackend } from "./backend.js";
export { SYSTEM_PROMPT, SYSTEM_PROMPT_COMPACT, buildUserMessage, buildRepairMessage, buildRepairInstruction, buildModifyMessage, extractSource, looksLikeApp, questionIn, parseModifyReply, NOT_IN_APP } from "./prompt.js";
export type { ModifyContext, ModifyReply } from "./prompt.js";
export { ClaudeBackend, createClaudeBackend, type MessagesClient } from "./claude-backend.js";
export { WebLLMBackend, createWebLLMBackend, WEBLLM_MODELS, type ChatEngine, type WebLLMModel } from "./webllm-backend.js";
export {
  OpenRouterBackend,
  createOpenRouterBackend,
  createOpenRouterEngine,
  OPENROUTER_MODELS,
  type OpenRouterModel,
  type OpenRouterOptions,
  type ProviderOptions,
  type ReasoningEffort,
  type ReasoningOptions,
} from "./openrouter-backend.js";
export {
  GeminiNanoBackend,
  createGeminiNanoBackend,
  hasBuiltInAI,
  getPromptModel,
  type PromptModel,
  type PromptSession,
} from "./gemini-nano-backend.js";
export { HybridBackend } from "./hybrid-backend.js";
// The person's language (#301): which language a turn replies in, and which an app is written in.
export {
  LANGUAGES,
  LANGUAGE_NAMES,
  isLanguage,
  matchLanguage,
  bestLanguage,
  appLanguage,
  classifyText,
  userFacingStrings,
  createLanguageInstruction,
  changeLanguageInstruction,
  type Language,
  type TurnLanguage,
} from "./language.js";
export { PROMPTS } from "./prompts.js";

// The concurrency gate, for the shell — the two-peer checks are a product feature: they are what
// tells someone their app is unsafe to share. The single-user smoke reaches the browser too since
// #262, as `smokeRuntime` against a runtime the shell composes: it is what the modify loop runs.
export {
  concurrencyChecks,
  concurrencySmoke,
  concurrencyPassed,
  type ConcurrencyDeps,
  type ConcurrencyResult,
  type Hazard,
} from "./concurrency-smoke.js";
export { seedRecords, smokeRuntime, smokeReport, paramsForPage, type SmokeResult, type SmokeOptions } from "./smoke.js";
// Running a candidate for the model (#262): the shell composes the runtime, these run and describe it.
export { describeRun, mergeRuns, runSafely, regressionGate, type RunReport, type RunGate, type GatedRun } from "./run-report.js";
// The release's corpus, for the loop's first message (#262).
export { loadCorpus } from "./load-corpus.js";


export {
  guardedModify,
  readModifyReply,
  readEditsOrFile,
  retryInstruction,
  noMatchInstruction,
  type GuardedModifyDeps,
  type GuardedModifyResult,
  type ModifyTrace,
  type ReadReply,
} from "./guarded-modify.js";
export {
  parseEdits,
  applyEdits,
  describeEditFailures,
  EDIT_FORMAT,
  EDIT_PLACEHOLDER_SEARCH,
  EDIT_PLACEHOLDER_REPLACE,
  type SearchReplace,
  type EditFailure,
  type ApplyResult,
} from "./edits.js";
