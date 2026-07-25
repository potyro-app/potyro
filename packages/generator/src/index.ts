// @karta/generator — AI generator eval harness (KA-06).
export type { GenPrompt, ModelBackend } from "./backend.js";
export { FixtureBackend } from "./backend.js";
export { scoreSource, type ScoreResult } from "./score.js";
export { runEval, formatReport, type EvalReport, type PromptOutcome } from "./run-eval.js";
export { PROMPTS } from "./prompts.js";
export { SYSTEM_PROMPT, buildUserMessage, buildRepairMessage, extractSource } from "./prompt.js";
export {
  ClaudeBackend,
  createClaudeBackend,
  type MessagesClient,
  type CreateParams,
  type MessageResponse,
} from "./claude-backend.js";
