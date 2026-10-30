// Which OpenAI-compatible endpoints have shown, in this session, that their model takes no tools (#121).
//
// Ollama answers a request with tools for llama3 with a 400, "does not support tools". The Studio then
// makes or changes the app in one plain turn instead of the loop; remembering it here means the next
// request goes straight there, rather than paying for the same refusal first. Per address and model:
// another model on the same server may take tools. Held in memory only, so a server that gains tool
// support is tried again after a reload.

import type { EngineConfig } from "./engines.js";

const NO_TOOLS = new Set<string>();

const which = (cfg: EngineConfig): string => `${cfg.endpoint.baseUrl.trim().replace(/\/+$/, "")}\n${cfg.endpoint.model.trim()}`;

/** Remember that this endpoint's model takes no tools. Other engines are not endpoints: nothing to remember. */
export function rememberNoTools(cfg: EngineConfig): void {
  if (cfg.engine === "endpoint") NO_TOOLS.add(which(cfg));
}

/** Has this endpoint's model already said, this session, that it takes no tools? */
export function knownNoTools(cfg: EngineConfig): boolean {
  return cfg.engine === "endpoint" && NO_TOOLS.has(which(cfg));
}

/** For tests: forget every endpoint. */
export function forgetNoTools(): void {
  NO_TOOLS.clear();
}
