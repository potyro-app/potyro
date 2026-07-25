// Cloud generator backend (KA-05): turns a prompt into a `.app.ts` via the Claude Messages API,
// with a structured repair() that feeds the validator's errors back. The class depends only on a
// minimal `MessagesClient` shape, so it's unit-testable with an injected fake (no API key); the
// `createClaudeBackend` factory wires the real Anthropic SDK.

import type { GenPrompt, ModelBackend } from "./backend.js";
import { SYSTEM_PROMPT, buildRepairMessage, buildUserMessage, extractSource } from "./prompt.js";

// The slice of the Anthropic SDK we use (structurally satisfied by the real client + by test fakes).
export interface MessageParam {
  role: "user" | "assistant";
  content: string;
}
export interface CreateParams {
  model: string;
  max_tokens: number;
  system?: string;
  thinking?: { type: "adaptive" };
  messages: MessageParam[];
}
export interface MessageResponse {
  content: Array<{ type: string; text?: string }>;
}
export interface MessagesClient {
  messages: { create(params: CreateParams): Promise<MessageResponse> };
}

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_MAX_TOKENS = 16_000;

function joinText(res: MessageResponse): string {
  return res.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

export class ClaudeBackend implements ModelBackend {
  readonly name: string;

  constructor(
    private readonly client: MessagesClient,
    private readonly model: string = DEFAULT_MODEL,
    private readonly maxTokens: number = DEFAULT_MAX_TOKENS,
  ) {
    this.name = `claude:${model}`;
  }

  async generate(prompt: GenPrompt): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: buildUserMessage(prompt) }],
    });
    return extractSource(joinText(res));
  }

  async repair(source: string, errors: string[], prompt: GenPrompt): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      messages: [
        { role: "user", content: buildUserMessage(prompt) },
        { role: "assistant", content: "```ts\n" + source + "\n```" },
        { role: "user", content: buildRepairMessage(errors) },
      ],
    });
    return extractSource(joinText(res));
  }
}

/**
 * Wire the real Anthropic SDK (reads ANTHROPIC_API_KEY from env unless a key is passed). Set
 * `dangerouslyAllowBrowser` for the in-browser "Describe an app…" panel — the key is the user's own,
 * held only in-memory for their local personal tool (never persisted or sent anywhere but Anthropic).
 */
export async function createClaudeBackend(opts?: {
  apiKey?: string;
  model?: string;
  dangerouslyAllowBrowser?: boolean;
}): Promise<ClaudeBackend> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({
    ...(opts?.apiKey ? { apiKey: opts.apiKey } : {}),
    ...(opts?.dangerouslyAllowBrowser ? { dangerouslyAllowBrowser: true } : {}),
  });
  return new ClaudeBackend(client as unknown as MessagesClient, opts?.model);
}
