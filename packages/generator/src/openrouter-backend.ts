// Cloud generator backend over OpenRouter — one key, any hosted model (DeepSeek, Qwen, Llama, …),
// so KA-06 can answer "how good does the model have to be?" with numbers instead of a guess. It
// speaks the OpenAI chat-completions shape over plain `fetch` (no SDK dependency) and reuses the
// same contract and turns as every other chat backend, so its report is directly comparable to the
// Claude baselines in eval-out/.
//
// The HTTP adapter is separate from the backend (`createOpenRouterEngine`) so both halves are
// testable without a key: inject a `ChatEngine` to check prompt assembly, inject a `fetch` to check
// the wire format and the failure modes.

import {
  ChatBackend,
  firstContent,
  type ChatEngine,
  type ChatMessage,
  type ChatRequest,
  type ToolCallOnMessage,
} from "./chat-backend.js";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** A model worth pointing the harness at. `note` is what you'd want to know before spending on a run. */
export interface OpenRouterModel {
  id: string;
  label: string;
  /** Approximate USD per million tokens, in/out, at the time of writing. */
  price: string;
  note?: string;
}

/**
 * A short curated list for the Studio picker — cheap-and-fast first, since the whole point of
 * running a small model is finding out whether Karta's validator-gated, safe-when-wrong output
 * makes an inexpensive model good enough. Any OpenRouter model id works; this is just the shortlist.
 */
export const OPENROUTER_MODELS: readonly OpenRouterModel[] = [
  { id: "deepseek/deepseek-v4-flash-0731", label: "DeepSeek V4 Flash", price: "$0.14/$0.28", note: "Cheap, fast, 1M context — start here" },
  { id: "deepseek/deepseek-v4-pro-0813", label: "DeepSeek V4 Pro", price: "$0.44/$0.87", note: "Stronger sibling, still ~50× cheaper than a frontier model" },
  { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2", price: "$0.27/$0.40", note: "Previous generation, for a regression check" },
  { id: "qwen/qwen3-coder", label: "Qwen3 Coder", price: "varies", note: "Coder-tuned — the output is a structured .app.ts" },
];

const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
/** Reasoning tokens come out of this same budget, so it has to cover the thinking AND the app. */
const DEFAULT_MAX_TOKENS = 32_000;
const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Reasoning is drawn from `max_tokens` alongside the answer, and its size is wildly unpredictable:
 * measured on the real generator payload, the same ask produced 481 thinking tokens one run and
 * 1173 the next (15s vs 96s). Off, the same ask is 309–338 tokens in 1–7s and still yields a valid
 * app. So the default optimises for a responsive Studio; whether thinking buys enough quality to be
 * worth the wait is a corpus question, not a hunch — `--reasoning low|medium|high` to measure it.
 */
const DEFAULT_REASONING: ReasoningOptions = { effort: "none" };

/**
 * OpenRouter's default routing optimises for price and can land on a provider serving under 10
 * tok/s — that is the 95-second "hang", not the model. Sorting for throughput moved the same
 * request to 83–306 tok/s for a fraction of a cent more.
 */
const DEFAULT_PROVIDER: ProviderOptions = { sort: "throughput" };

export type ReasoningEffort = "max" | "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
export interface ReasoningOptions {
  effort?: ReasoningEffort;
  /** Keep the thinking out of the response body. */
  exclude?: boolean;
  enabled?: boolean;
}

/** OpenRouter's provider-routing controls — which upstream actually serves the model. */
export interface ProviderOptions {
  sort?: "throughput" | "price" | "latency";
  order?: string[];
  allow_fallbacks?: boolean;
}

export interface OpenRouterOptions {
  /** Falls back to `OPENROUTER_API_KEY` in the environment. */
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  /** Defaults to `{ effort: "none" }` — see DEFAULT_REASONING for why. */
  reasoning?: ReasoningOptions;
  /** Defaults to `{ sort: "throughput" }` — the single biggest lever on how long a generation takes. */
  provider?: ProviderOptions;
  baseUrl?: string;
  timeoutMs?: number;
  /** Attribution shown on OpenRouter's dashboards. */
  appTitle?: string;
  referer?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Injectable for tests; defaults to `process.env` where it exists (undefined in the browser). */
  env?: Record<string, string | undefined>;
}

/** The error body OpenRouter returns — on a 4xx/5xx, and sometimes on a 200 when the upstream fails. */
interface ErrorBody {
  error?: { message?: string; code?: number | string };
}

function readEnv(env: OpenRouterOptions["env"]): Record<string, string | undefined> | undefined {
  if (env) return env;
  return typeof process !== "undefined" ? process.env : undefined;
}

/**
 * While the upstream model works, OpenRouter keeps the connection from timing out by padding it
 * with SSE comment lines (`: OPENROUTER PROCESSING`). They are not JSON and they arrive before the
 * completion does, so the body has to be cleaned before parsing — otherwise a slow-but-successful
 * generation is reported as a model that answered with nothing.
 */
function stripKeepAlive(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith(":"))
    .join("\n")
    .trim();
}

function errorMessage(body: unknown): string | null {
  const e = (body as ErrorBody)?.error;
  if (!e) return null;
  return e.message ?? JSON.stringify(e);
}

/**
 * A `ChatEngine` backed by OpenRouter's HTTP API. Every failure mode ends as a thrown Error with
 * enough detail to act on: a silent empty string here would reach the harness as an app that failed
 * to compile, blaming the model for what was actually a bad key or a dead upstream.
 */
export function createOpenRouterEngine(opts: OpenRouterOptions = {}): ChatEngine {
  const apiKey = opts.apiKey ?? readEnv(opts.env)?.OPENROUTER_API_KEY ?? "";
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const doFetch = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const create = async (req: ChatRequest) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": opts.referer ?? "https://github.com/fuzue/karta",
      "X-Title": opts.appTitle ?? "Karta",
    };
    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: req.model ?? opts.model ?? DEFAULT_MODEL,
        messages: req.messages,
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
        max_tokens: req.max_tokens ?? opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        reasoning: opts.reasoning ?? DEFAULT_REASONING,
        provider: opts.provider ?? DEFAULT_PROVIDER,
        ...(req.tools ? { tools: req.tools, tool_choice: req.tool_choice ?? "auto" } : {}),
      }),
      ...(typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
        ? { signal: AbortSignal.timeout(timeoutMs) }
        : {}),
    });

    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(stripKeepAlive(text)) as unknown;
    } catch {
      body = null;
    }

    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${errorMessage(body) ?? text.slice(0, 500)}`);
    }
    // A 200 carrying an `error` is how an upstream provider failure arrives.
    const upstream = errorMessage(body);
    if (upstream) throw new Error(`OpenRouter: ${upstream}`);

    const choices = (
      body as {
        choices?: Array<{
          message?: { content?: string | null; tool_calls?: ToolCallOnMessage[] };
          finish_reason?: string;
        }>;
      }
    )?.choices;
    const choice = choices?.[0];
    const content = choice?.message?.content;
    const toolCalls = choice?.message?.tool_calls;
    // A tool call IS an answer — it just isn't prose. Only an empty reply with neither is a failure.
    if (!content && !toolCalls?.length) {
      // "length" with no content means the thinking ate the budget — a settings problem, not a
      // model that can't write the app. Say so, or the next hour goes into the wrong question.
      const why =
        choice?.finish_reason === "length"
          ? " — it hit max_tokens before writing any code. Raise maxTokens, or lower the reasoning effort."
          : choice?.finish_reason
            ? ` (finish_reason: ${choice.finish_reason})`
            : " — the model replied with no content.";
      throw new Error(`OpenRouter returned no completion${why}`);
    }
    return {
      choices: [
        {
          message: { content: content ?? "", ...(toolCalls ? { tool_calls: toolCalls } : {}) },
          ...(choice?.finish_reason ? { finish_reason: choice.finish_reason } : {}),
        },
      ],
    };
  };

  return { chat: { completions: { create } } };
}

export class OpenRouterBackend extends ChatBackend {
  readonly name: string;
  private readonly maxTokens: number;

  constructor(
    private readonly engine: ChatEngine,
    private readonly model: string = DEFAULT_MODEL,
    opts: { maxTokens?: number; reasoning?: ReasoningOptions } = {},
  ) {
    super();
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    // The reasoning effort changes both the cost and the quality of a run, so a report that does not
    // name it cannot be compared with another.
    const effort = opts.reasoning?.effort;
    this.name = `openrouter:${model}${effort ? `+reasoning=${effort}` : ""}`;
  }

  protected async ask(messages: ChatMessage[], temperature: number): Promise<string> {
    return firstContent(
      await this.engine.chat.completions.create({
        model: this.model,
        messages,
        temperature,
        max_tokens: this.maxTokens,
      }),
    );
  }
}

/**
 * Wire the real OpenRouter endpoint. The key check is up-front and by name: discovering a missing
 * key as a 401 halfway through a corpus run wastes both time and the calls already spent.
 *
 * Browser-safe — OpenRouter allows cross-origin calls, and the key is the user's own, held in memory
 * for their local tool only.
 */
export async function createOpenRouterBackend(opts: OpenRouterOptions = {}): Promise<OpenRouterBackend> {
  const apiKey = opts.apiKey || readEnv(opts.env)?.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set (or pass apiKey). Get one at https://openrouter.ai/keys");
  }
  const model = opts.model ?? DEFAULT_MODEL;
  const engine = createOpenRouterEngine({ ...opts, apiKey, model });
  return new OpenRouterBackend(engine, model, {
    ...(opts.maxTokens === undefined ? {} : { maxTokens: opts.maxTokens }),
    ...(opts.reasoning === undefined ? {} : { reasoning: opts.reasoning }),
  });
}
