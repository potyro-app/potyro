// The OpenAI-chat shape, shared by every backend that speaks it — on-device (WebLLM/MLC) and cloud
// (OpenRouter). Keeping the three turns (generate / repair / modify) in one place is what makes eval
// numbers comparable across models: each one sees exactly the same contract and the same framing,
// so a difference in the report is a difference in the model, not in the prompt.
//
// Subclasses supply only `ask` — how one request reaches their engine — because that is the only
// part that genuinely differs (a cloud API needs the model id per request; an on-device engine is
// already bound to one).

import type { GenPrompt, ModelBackend } from "./backend.js";
import {
  SYSTEM_PROMPT,
  buildModifyMessage,
  buildModifyOpener,
  buildRepairMessage,
  buildUserMessage,
  extractSource,
} from "./prompt.js";
import type { ModifyContext } from "./prompt.js";

export interface ToolCallOnMessage {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** A page a provider-side search read, as the provider reports it. */
export interface Citation {
  url: string;
  title?: string;
  /** The text the search returned from this page: what the model read, and what its quotes are checked against. */
  content?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Set on a `tool` message: which call this is the result of. */
  tool_call_id?: string;
  /** Set on an `assistant` message that asked for tools, when replaying the transcript back. */
  tool_calls?: ToolCallOnMessage[];
}
export interface ChatRequest {
  /** Cloud engines route on this; on-device engines are constructed per-model and ignore it. */
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  /** Omitted entirely when absent — an on-device engine must see the request it saw before. */
  tools?: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
  tool_choice?: "auto" | "none";
  /** Tools the provider runs itself (OpenRouter's `openrouter:web_search`). Engines that have none ignore them. */
  serverTools?: Array<Record<string, unknown>>;
}
/** What one call cost, as the provider reports it. */
export interface Usage {
  /** In US dollars. */
  cost?: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface ChatResponse {
  choices: Array<{ message: { content: string; tool_calls?: ToolCallOnMessage[]; citations?: Citation[] }; finish_reason?: string }>;
  usage?: Usage;
}
export interface ChatEngine {
  chat: { completions: { create(req: ChatRequest): Promise<ChatResponse> } };
}

/** A fresh app is a wider search than an edit; repair/modify keep the shape they already have. */
const GENERATE_TEMPERATURE = 0.2;
const EDIT_TEMPERATURE = 0.1;

export function firstContent(res: ChatResponse): string {
  return res.choices[0]?.message.content ?? "";
}

/** The prior attempt, framed as the assistant's own turn so the model edits rather than restarts. */
function priorTurn(source: string): ChatMessage {
  return { role: "assistant", content: "```ts\n" + source + "\n```" };
}

export abstract class ChatBackend implements ModelBackend {
  abstract readonly name: string;

  /** Send one exchange and return the raw reply text (fences and all). */
  protected abstract ask(messages: ChatMessage[], temperature: number): Promise<string>;

  /** The contract this engine is taught. On-device engines with a small context override it. */
  protected get systemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  async generate(prompt: GenPrompt): Promise<string> {
    return extractSource(
      await this.ask(
        [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: buildUserMessage(prompt) },
        ],
        GENERATE_TEMPERATURE,
      ),
    );
  }

  async repair(source: string, errors: string[], prompt: GenPrompt): Promise<string> {
    return extractSource(
      await this.ask(
        [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: buildUserMessage(prompt) },
          priorTurn(source),
          { role: "user", content: buildRepairMessage(errors) },
        ],
        EDIT_TEMPERATURE,
      ),
    );
  }

  // `prompt` is deliberately unused: in a modify the caller passes the CHANGE as the description,
  // and opening with it ("create an app for: add a rating field") is what made models replace the
  // app wholesale. The app describes itself — it is right there in the next turn.
  // The reply is returned as text, not extracted: it holds edits, and `guardedModify` applies them.
  async modify(source: string, instruction: string, _prompt: GenPrompt, ctx?: ModifyContext): Promise<string> {
    return this.ask(
      [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: buildModifyOpener() },
        priorTurn(source),
        { role: "user", content: buildModifyMessage(instruction, ctx) },
      ],
      EDIT_TEMPERATURE,
    );
  }
}
