// What a request can cost at most, before it is sent and whenever OpenRouter does not say what it
// did cost (docs/16 "AI for apps").
//
// The relay charges OpenRouter's own `usage.cost` when the answer carries it. When it does not — the
// sender went away, the request timed out, a stream was cut before its last chunk, an answer came
// back without usage, OpenRouter failed — it charges this ESTIMATE instead, and it checks the same
// estimate against every allowance before dispatch, so a request that could cost more than is left
// is refused unsent:
//
//   input  ≈ the body's characters / 4 tokens × the model's price per million input tokens
//   output = the request's max_tokens (after the relay's clamp) × its price per million output tokens
//
// Both are on the high side: a body's characters overcount its tokens (a picture's base64 most of
// all), and a model rarely writes all of max_tokens. Reasoning tokens are output tokens and come out
// of the same max_tokens.
//
// The table holds every model the relay may send. A price is US dollars per million tokens, and it
// must be the DEAREST provider's on OpenRouter for that model, since the relay does not choose the
// provider. `AI_MODEL_PRICES` (JSON) adds to it or replaces entries; a model the relay may send
// without a price stops it starting.

export interface ModelPrice {
  /** US dollars per million input tokens. */
  input: number;
  /** US dollars per million output tokens. */
  output: number;
}

export type Prices = Readonly<Record<string, ModelPrice>>;

export const MODEL_PRICES: Prices = {
  // `/complete`'s model: docs/23 "Model".
  "google/gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  // The chat route's default: packages/generator, openrouter-backend.ts MODELS ("$0.14/$0.28").
  "deepseek/deepseek-v4-flash-0731": { input: 0.14, output: 0.28 },
};

const CHARS_PER_TOKEN = 4;

/** The most a request of `chars` characters asking for up to `maxTokens` tokens can cost, in US dollars. */
export function estimateUsd(price: ModelPrice, chars: number, maxTokens: number): number {
  return (Math.ceil(chars / CHARS_PER_TOKEN) * price.input + maxTokens * price.output) / 1e6;
}

/** The price of `model`, or an error naming the model: a relay must never send a model it cannot price. */
export function priceOf(prices: Prices, model: string): ModelPrice {
  const p = prices[model];
  if (!p) throw new Error(`no price for ${model}: add it to AI_MODEL_PRICES (US dollars per million tokens)`);
  return p;
}

/** `AI_MODEL_PRICES` over the table: `{"<model>": {"input": 0.14, "output": 0.28}}`. Anything else stops the relay. */
export function readModelPrices(raw: string | undefined, base: Prices = MODEL_PRICES): Prices {
  if (raw === undefined || raw.trim() === "") return base;
  const bad = (why: string): never => {
    throw new Error(`AI_MODEL_PRICES ${why}: it is {"<model>": {"input": <$ a million tokens>, "output": <$ a million tokens>}}`);
  };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return bad("is not JSON");
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return bad("is not an object");
  const out: Record<string, ModelPrice> = { ...base };
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  for (const [model, p] of Object.entries(json)) {
    const { input, output } = (p ?? {}) as Record<string, unknown>;
    if (typeof p !== "object" || p === null || !ok(input) || !ok(output) || Object.keys(p).length !== 2) return bad(`has a bad entry for ${model}`);
    out[model] = { input, output };
  }
  return out;
}
