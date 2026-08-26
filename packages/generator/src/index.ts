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
export { claudeCliAvailable } from "./cli-available.js";
export {
  CallBudget,
  callModel,
  isMetered,
  UNKNOWN_USAGE,
  type BudgetLimits,
  type CallKind,
  type CallUsage,
  type MeteredBackend,
  type MeteredRequest,
  type MeteredResult,
  type ModelCall,
} from "./model-call.js";
export {
  compareData,
  entitiesToRead,
  snapshotData,
  type DataSafetyReport,
  type DataSnapshot,
  type FieldChange,
} from "./data-safety.js";
export {
  runModifyEval,
  runModifyScenario,
  summarize,
  type ModifyReport,
  type ScenarioRun,
  type StepResult,
  type StepVerdict,
  type HumanReview,
} from "./modify-eval.js";
export { formatModifyReport, reviewSheet, artifactPath, rejectedPath } from "./modify-report.js";
export { MODIFY_SCENARIOS, type ModifyScenario, type Modification, type AssertContext } from "./modify-scenarios.js";
