// Chrome built-in AI (Gemini Nano) generator backend — the "zero-download" on-device option. The
// model ships inside Chrome/Edge, so there's no ~1 GB weight fetch like WebLLM; the trade-off is
// it's a general model (not coder-tuned) and gated by channel/hardware. Same ModelBackend contract
// as the cloud + WebLLM backends, so it slots into the panel and the eval harness identically.
//
// The class depends only on a minimal `PromptModel`/`PromptSession` shape (the Prompt API surface),
// so it's unit-testable without Chrome; `createGeminiNanoBackend` resolves the real global.

import type { GenPrompt, ModelBackend } from "./backend.js";
import { SYSTEM_PROMPT_COMPACT, buildModifyMessage, buildRepairMessage, buildUserMessage, extractSource } from "./prompt.js";
import type { ModifyContext } from "./prompt.js";

/** A live prompting session (Chrome's `LanguageModel` session). */
export interface PromptSession {
  prompt(input: string): Promise<string>;
  destroy?(): void;
}

/** The Prompt API factory (Chrome's global `LanguageModel`). */
export interface PromptModel {
  /** "unavailable" | "downloadable" | "downloading" | "available". */
  availability(): Promise<string>;
  create(opts?: {
    initialPrompts?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    monitor?: (m: EventTarget) => void;
  }): Promise<PromptSession>;
}

/** Run the whole generation in one fresh session, so system context is isolated per call. */
async function once<T>(session: PromptSession, run: (s: PromptSession) => Promise<T>): Promise<T> {
  try {
    return await run(session);
  } finally {
    session.destroy?.();
  }
}

export class GeminiNanoBackend implements ModelBackend {
  readonly name = "gemini-nano";

  constructor(private readonly model: PromptModel) {}

  private newSession(): Promise<PromptSession> {
    // The Prompt API takes the system prompt as an initial "system" turn, not a per-message role.
    // Compact: Nano's context cannot hold the full schema reference.
    return this.model.create({ initialPrompts: [{ role: "system", content: SYSTEM_PROMPT_COMPACT }] });
  }

  async generate(prompt: GenPrompt): Promise<string> {
    const session = await this.newSession();
    return once(session, async (s) => extractSource(await s.prompt(buildUserMessage(prompt))));
  }

  async repair(source: string, errors: string[], prompt: GenPrompt): Promise<string> {
    // The Prompt API turn is a single string, so fold the prior attempt + errors into one message.
    const message = [
      buildUserMessage(prompt),
      "",
      "The previous attempt:",
      "```ts",
      source,
      "```",
      "",
      buildRepairMessage(errors),
    ].join("\n");
    const session = await this.newSession();
    return once(session, async (s) => extractSource(await s.prompt(message)));
  }

  async modify(source: string, instruction: string, prompt: GenPrompt, ctx?: ModifyContext): Promise<string> {
    const message = [
      buildUserMessage(prompt),
      "",
      "The current app:",
      "```ts",
      source,
      "```",
      "",
      buildModifyMessage(instruction, ctx),
    ].join("\n");
    const session = await this.newSession();
    return once(session, (s) => s.prompt(message));
  }
}

/** Resolve Chrome's built-in Prompt API. Present on recent Chrome/Edge; behind a flag on some. */
export function getPromptModel(): PromptModel | null {
  const g = globalThis as unknown as {
    LanguageModel?: PromptModel;
    ai?: { languageModel?: PromptModel };
  };
  return g.LanguageModel ?? g.ai?.languageModel ?? null;
}

/** True if the built-in Prompt API is exposed at all (sync check for gating UI). */
export function hasBuiltInAI(): boolean {
  return getPromptModel() !== null;
}

/** Wire the real Chrome built-in model; throws a clear message when it isn't usable. */
export async function createGeminiNanoBackend(): Promise<GeminiNanoBackend> {
  const model = getPromptModel();
  if (!model) throw new Error("Chrome built-in AI (Prompt API) is not available in this browser.");
  const status = await model.availability();
  if (status === "unavailable") {
    throw new Error("Chrome built-in AI is unavailable on this device (unsupported hardware or disabled).");
  }
  // "downloadable"/"downloading" are fine — create() triggers/awaits the one-time model provisioning.
  return new GeminiNanoBackend(model);
}
