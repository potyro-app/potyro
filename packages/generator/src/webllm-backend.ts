// On-device / edge generator backend (KA-07): runs a small coder model in the browser via WebLLM
// (MLC) + WebGPU, fully offline once the weights are cached. It's the same ModelBackend contract as
// the cloud backend, so the eval harness reports comparable numbers. The class depends only on a
// minimal `ChatEngine` shape (mockable → unit-testable without a GPU); `createWebLLMBackend` wires
// the real runtime. Karta is an unusually good target for a weak model: the output is small,
// validator-gated, and safe-when-wrong (untrusted → isolate).

import type { GenPrompt, ModelBackend } from "./backend.js";
import { SYSTEM_PROMPT, buildRepairMessage, buildUserMessage, extractSource } from "./prompt.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}
export interface ChatResponse {
  choices: Array<{ message: { content: string } }>;
}
export interface ChatEngine {
  chat: { completions: { create(req: ChatRequest): Promise<ChatResponse> } };
}

// Apache-2.0, small enough for on-device; commercial-safe (avoids the non-commercial 3B).
const DEFAULT_MODEL = "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC";
const MAX_TOKENS = 2048;

function firstContent(res: ChatResponse): string {
  return res.choices[0]?.message.content ?? "";
}

export class WebLLMBackend implements ModelBackend {
  readonly name: string;

  constructor(private readonly engine: ChatEngine, model: string = DEFAULT_MODEL) {
    this.name = `webllm:${model}`;
  }

  async generate(prompt: GenPrompt): Promise<string> {
    const res = await this.engine.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(prompt) },
      ],
      temperature: 0.2,
      max_tokens: MAX_TOKENS,
    });
    return extractSource(firstContent(res));
  }

  async repair(source: string, errors: string[], prompt: GenPrompt): Promise<string> {
    const res = await this.engine.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(prompt) },
        { role: "assistant", content: "```ts\n" + source + "\n```" },
        { role: "user", content: buildRepairMessage(errors) },
      ],
      temperature: 0.1,
      max_tokens: MAX_TOKENS,
    });
    return extractSource(firstContent(res));
  }
}

/** Wire the real WebLLM runtime (loads + caches the model on first use; requires WebGPU). */
export async function createWebLLMBackend(opts?: { model?: string; initProgressCallback?: (p: unknown) => void }): Promise<WebLLMBackend> {
  const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
  const model = opts?.model ?? DEFAULT_MODEL;
  const engine = await CreateMLCEngine(model, { initProgressCallback: opts?.initProgressCallback });
  return new WebLLMBackend(engine as ChatEngine, model);
}
