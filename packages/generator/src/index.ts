// @karta/generator — AI generator eval harness (KA-06).
export type { GenPrompt, ModelBackend } from "./backend.js";
export { FixtureBackend } from "./backend.js";
export { scoreSource, type ScoreResult } from "./score.js";
export { runEval, formatReport, type EvalReport, type PromptOutcome } from "./run-eval.js";
export { PROMPTS } from "./prompts.js";
export { SYSTEM_PROMPT, buildUserMessage, buildRepairMessage, buildModifyMessage, extractSource, parseModifyReply, NOT_IN_APP } from "./prompt.js";
export type { ModifyContext, ModifyReply } from "./prompt.js";
export {
  ClaudeBackend,
  createClaudeBackend,
  type MessagesClient,
  type CreateParams,
  type MessageResponse,
} from "./claude-backend.js";
export {
  WebLLMBackend,
  createWebLLMBackend,
  WEBLLM_MODELS,
  type ChatEngine,
  type ChatRequest,
  type ChatResponse,
  type WebLLMModel,
} from "./webllm-backend.js";
export {
  GeminiNanoBackend,
  createGeminiNanoBackend,
  hasBuiltInAI,
  getPromptModel,
  type PromptModel,
  type PromptSession,
} from "./gemini-nano-backend.js";
export { HybridBackend } from "./hybrid-backend.js";
