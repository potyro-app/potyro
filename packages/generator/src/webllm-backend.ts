// On-device / edge generator backend (KA-07): runs a small coder model in the browser via WebLLM
// (MLC) + WebGPU, fully offline once the weights are cached. It's the same ModelBackend contract as
// the cloud backend, so the eval harness reports comparable numbers. The class depends only on a
// minimal `ChatEngine` shape (mockable → unit-testable without a GPU); `createWebLLMBackend` wires
// the real runtime. Potyro is an unusually good target for a weak model: the output is small,
// validator-gated, and safe-when-wrong (untrusted → isolate).

import { ChatBackend, firstContent, type ChatEngine, type ChatMessage } from "./chat-backend.js";
import { SYSTEM_PROMPT_COMPACT } from "./prompt.js";

// The chat shape lives in chat-backend.ts, shared with the cloud backends that speak it. Re-exported
// here so existing importers (and the eval tests) keep working.
export type { ChatEngine, ChatMessage, ChatRequest, ChatResponse } from "./chat-backend.js";

/**
 * Curated on-device models for the picker. All coder-tuned (the output is a structured `.app.ts`,
 * so a code model beats a bigger general one). Trade-off is size↔quality: a weaker device wants the
 * 0.5B; a strong GPU can afford the 3B. `download` is the approximate first-use cache cost.
 */
export interface WebLLMModel {
  id: string;
  label: string;
  download: string;
  note?: string;
}

export const WEBLLM_MODELS: readonly WebLLMModel[] = [
  { id: "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5-Coder 0.5B", download: "~0.5 GB", note: "Fastest, weakest — for low-end devices" },
  { id: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5-Coder 1.5B", download: "~1 GB", note: "Recommended balance" },
  { id: "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC", label: "Qwen2.5-Coder 3B", download: "~2 GB", note: "Best quality; larger download · non-commercial license" },
];

// Apache-2.0, small enough for on-device; commercial-safe (avoids the non-commercial 3B).
const DEFAULT_MODEL = "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC";
const MAX_TOKENS = 2048;

export class WebLLMBackend extends ChatBackend {
  readonly name: string;

  constructor(private readonly engine: ChatEngine, model: string = DEFAULT_MODEL) {
    super();
    this.name = `webllm:${model}`;
  }

  // The MLC Qwen builds run with a 4k context; the full schema reference alone is ~7.5k tokens, so
  // the compact, validator-derived variant is what fits (#130).
  protected override get systemPrompt(): string {
    return SYSTEM_PROMPT_COMPACT;
  }

  // No `model` on the request: the MLC engine is loaded for one model and is already bound to it.
  protected async ask(messages: ChatMessage[], temperature: number): Promise<string> {
    return firstContent(await this.engine.chat.completions.create({ messages, temperature, max_tokens: MAX_TOKENS }));
  }
}

/** Wire the real WebLLM runtime (loads + caches the model on first use; requires WebGPU). */
export async function createWebLLMBackend(opts?: { model?: string; initProgressCallback?: (p: unknown) => void }): Promise<WebLLMBackend> {
  const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
  const model = opts?.model ?? DEFAULT_MODEL;
  const engine = await CreateMLCEngine(model, { initProgressCallback: opts?.initProgressCallback });
  return new WebLLMBackend(engine as ChatEngine, model);
}
