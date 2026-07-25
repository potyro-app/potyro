// Browser-safe generator entrypoint: the model backends + prompt assembly only. Excludes the eval
// scorer (score.ts / run-eval.ts import Node-only esbuild + fs), so the shell can `import
// "@karta/generator/backends"` for the "Describe an app…" panel without pulling Node modules into
// the browser bundle. The full package barrel (with the harness) stays Node-only.

export type { GenPrompt, ModelBackend } from "./backend.js";
export { FixtureBackend } from "./backend.js";
export { SYSTEM_PROMPT, buildUserMessage, buildRepairMessage, extractSource } from "./prompt.js";
export { ClaudeBackend, createClaudeBackend, type MessagesClient } from "./claude-backend.js";
export { HybridBackend } from "./hybrid-backend.js";
// NOTE: the WebLLM (edge) backend is intentionally NOT re-exported here — it imports the browser-only
// `@mlc-ai/web-llm`, which isn't in every consumer's type graph. Import it from the full barrel where
// that package is present. Wiring edge generation into the shell is a follow-up.
export { PROMPTS } from "./prompts.js";
