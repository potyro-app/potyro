// The free allowance's chat route, for the Studio and Ask (docs/23, docs/16 "AI for apps").
//
// `POST /v1/chat/completions` (public path `/ai/v1/chat/completions`): an OpenAI-shaped chat request,
// sent on to OpenRouter with Potyro's key. Unlike `/complete`, the sender writes the messages, the
// tools and the reasoning settings, because the Studio's loop needs them as they are. What still
// belongs to the relay, because it is Potyro's bill:
//
//   - the model: one from an allowlist (`AI_CHAT_MODELS`), or the request is refused;
//   - `max_tokens`: clamped (64 000: the Studio's high thinking level asks for that much), and set
//     when the sender left it out, so no request is open-ended;
//   - `provider.data_collection: "deny"` and `usage.include: true`, forced on every request;
//   - OpenRouter's server tools (web search) are refused unless the request carries a plan token,
//     and no plan exists yet (`planAllows`);
//   - money: each device has a monthly allowance in US dollars (`AI_DEVICE_MONTH_USD`), each address
//     (an IPv6 address by its /64, address.ts) a daily one, and the whole service the daily and
//     monthly caps it shares with `/complete` (budget.ts). Every one is checked BEFORE dispatch with
//     what the request could cost at most (prices.ts), and that much is held while it is out; after
//     it, what OpenRouter says it cost (`usage.cost`, from the final chunk when streamed) is charged,
//     and when it did not say (the sender went away, a timeout, a cut stream, no usage), the estimate.
//
// Every refusal is in OpenAI's error shape, `{error: {code, message, type: "potyro"}}`, with a code
// the shell maps (docs/23 "The chat route's refusals") and a message a person can act on.
//
// The answer is piped, not buffered: a streamed answer and OpenRouter's ": OPENROUTER PROCESSING"
// keep-alive lines reach the sender as they come. The relay only reads along for `usage.cost`.
//
// The device id comes as `Authorization: Bearer potyro-device:<id>`, so the Studio's OpenRouter
// engine can point at this route unchanged (base URL `/ai/v1`, the device token as its key). It is
// random, says nothing about the person, and is never logged; nor is a request's content or an address.
//
// Pure apart from `upstream` and the ledger; server.ts is the thin HTTP part.

import { addressKey } from "./address.ts";
import { createBudget, type Budget, type CapReason } from "./budget.ts";
import { memoryLedger, monthOf, type Ledger } from "./ledger.ts";
import { estimateUsd, MODEL_PRICES, priceOf, type Prices } from "./prices.ts";
import { dayWindow } from "./window.ts";

/** The Studio's cheap default (packages/generator, openrouter-backend.ts). */
export const CHAT_MODELS: readonly string[] = ["deepseek/deepseek-v4-flash-0731"];

export interface ChatLimits {
  /** US dollars a device may spend a calendar month (UTC) on this route. */
  deviceMonthUsd: number;
  /**
   * US dollars a day for one address (an IPv6 one by its /64), whatever device ids it sends. A whole
   * home or office behind one address shares it, so by default it is four devices' months — but
   * never more than half the service's day, so one network cannot close the day for everyone.
   */
  addressDayUsd: number;
  /** The whole service, every route together, when no shared `budget` is given (budget.ts). */
  monthlyUsd: number;
  /** The same, a day; default an eighth of `monthlyUsd`. */
  dayUsd: number;
  /** The least a request is held for while it is out; more when its estimate is more (prices.ts). */
  reserveUsd: number;
  /** The most output tokens one request may ask for. Reasoning comes out of the same budget. */
  maxTokens: number;
  /** The whole request body, checked before parsing. */
  bytes: number;
  concurrentPerDevice: number;
}

/** The defaults; `addressDayUsd` and `dayUsd` follow from the others (`chatLimits`). */
export const DEFAULT_CHAT_LIMITS: Omit<ChatLimits, "addressDayUsd" | "dayUsd"> = {
  deviceMonthUsd: 0.5,
  monthlyUsd: 10,
  reserveUsd: 0.02,
  maxTokens: 64_000,
  bytes: 4 * 1024 * 1024,
  concurrentPerDevice: 3,
};

/** How many devices' months one address may spend a day, by default. */
export const ADDRESS_DEVICES = 4;

/** The limits in force: the defaults, what was set, and the two that follow from them. */
export function chatLimits(set: Partial<ChatLimits> = {}, dayUsd?: number): ChatLimits {
  const base = { ...DEFAULT_CHAT_LIMITS, ...set };
  const day = dayUsd ?? set.dayUsd ?? base.monthlyUsd / 8;
  const limits: ChatLimits = { ...base, dayUsd: day, addressDayUsd: set.addressDayUsd ?? Math.min(ADDRESS_DEVICES * base.deviceMonthUsd, day / 2) };
  if (limits.addressDayUsd >= limits.dayUsd) {
    throw new Error(`AI_ADDRESS_DAY_USD (${limits.addressDayUsd}) must be below the service's daily cap AI_DAY_USD (${limits.dayUsd})`);
  }
  return limits;
}

export interface ChatDeps {
  /** Sends one body to OpenRouter's chat completions with Potyro's key; the Response is read as a stream. */
  upstream: (body: Record<string, unknown>, signal?: AbortSignal) => Promise<Response>;
  now: () => number;
  ledger?: Ledger;
  limits?: Partial<ChatLimits>;
  /** The service's caps, shared with `/complete`. Absent: one of its own from `limits`. */
  budget?: Budget;
  models?: readonly string[];
  /** What each model costs (prices.ts); every model in `models` must be in it. */
  prices?: Prices;
  /** The kill switch, asked on every request: true answers 503 and sends nothing. */
  isOff?: () => boolean;
  /**
   * THE PLAN SEAM. Whether a plan token (header `x-potyro-plan`) may use OpenRouter's server tools
   * (web search), which cost per call on top of tokens. No plan exists yet: absent, every token is
   * refused, and so is every server tool.
   */
  planAllows?: (token: string) => boolean;
  /**
   * Told the upstream's status when it fails. Never the content, the device or the address, and not
   * when the sender went away (that is not a failure).
   */
  onError?: (e: unknown) => void;
}

export interface ChatRequest {
  method: string;
  body: string;
  /** The sender's address, as the trusted proxy reports it (address.ts). */
  ip: string;
  authorization?: string;
  plan?: string;
  /** Aborted when the sender goes away. */
  signal?: AbortSignal;
}

export type ChatReply =
  | { status: number; headers: Record<string, string>; json: Record<string, unknown> }
  | { status: number; headers: Record<string, string>; stream: ReadableStream<Uint8Array> };

/** Fields a chat request may carry, passed on as they are (bar the ones the relay decides). */
const FIELDS = new Set([
  "model",
  "messages",
  "stream",
  "stream_options",
  "max_tokens",
  "max_completion_tokens",
  "temperature",
  "top_p",
  "top_k",
  "min_p",
  "top_a",
  "seed",
  "stop",
  "frequency_penalty",
  "presence_penalty",
  "repetition_penalty",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "response_format",
  "structured_outputs",
  "reasoning",
  "provider",
  "usage",
]);

/** OpenRouter's ways of asking for its own tools: only with a plan. */
const PLAN_FIELDS = new Set(["plugins", "web_search_options"]);

const DEVICE = /^Bearer potyro-device:([A-Za-z0-9_-]{8,100})$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** What a refusal says it is: the shell maps the code to its own words (docs/23). */
export type ChatErrorCode =
  | "allowance"
  | "device"
  | "off"
  | "model"
  | "address-day"
  | "service-day"
  | "service-month"
  | "plan"
  | "busy"
  | "request"
  | "too-big"
  | "method"
  | "upstream";

/** What a person is told for each, in plain words, with what to do next. */
export const CHAT_MESSAGES: Readonly<Record<ChatErrorCode, string>> = {
  allowance: "This month's free AI on this device is used up. To keep going, add your own key in Model settings.",
  device: "Free AI could not tell which device this came from. Update Potyro and try again.",
  off: "Free AI is switched off for now. Try again later, or add your own key in Model settings.",
  model: "Free AI does not offer this model. Choose the default model, or add your own key in Model settings.",
  "address-day": "Free AI is busy on this network today; it is back tomorrow, or add your own key in Model settings.",
  "service-day": "Free AI is used up for today; it is back tomorrow, or add your own key in Model settings.",
  "service-month": "Free AI is used up for this month. To keep going, add your own key in Model settings.",
  plan: "Web search is not part of free AI. Turn web search off, or add your own key in Model settings.",
  busy: "This device already has requests out with free AI. Wait for one to finish, then try again.",
  request: "Free AI cannot take this request. Update Potyro and try again.",
  "too-big": "This chat is too long for free AI. Start a new one, or add your own key in Model settings.",
  method: "Free AI cannot take this request. Update Potyro and try again.",
  upstream: "Free AI could not reach the model just now. Try again in a minute, or add your own key in Model settings.",
};

/** Said instead of `allowance`'s message when what is left would do for a smaller request. */
export const NOT_ENOUGH_LEFT =
  "What is left of this month's free AI on this device is not enough for this request. Start a new chat, or add your own key in Model settings.";

type Read =
  | { ok: true; body: Record<string, unknown>; streamed: boolean; maxTokens: number }
  | { ok: false; status: number; code: "model" | "plan" | "request"; param?: string };

/**
 * The body that goes to OpenRouter, or why not. Unknown fields are refused, not dropped; messages,
 * tools, tool calls and reasoning go on unchanged.
 */
export function readChatRequest(v: unknown, opts: { models: readonly string[]; maxTokens: number; planned: boolean }): Read {
  // `param`: the field that is wrong, for whoever reads the answer while building a client.
  const bad = (param?: string): Read => ({ ok: false, status: 400, code: "request", ...(param ? { param } : {}) });
  const plan = (param: string): Read => ({ ok: false, status: 403, code: "plan", param });
  if (!isRecord(v)) return bad();
  for (const k of Object.keys(v)) {
    if (PLAN_FIELDS.has(k)) {
      if (!opts.planned) return plan(k);
    } else if (!FIELDS.has(k)) return bad(k);
  }
  if (typeof v.model !== "string" || !opts.models.includes(v.model)) return { ok: false, status: 400, code: "model", param: "model" };
  if (!Array.isArray(v.messages) || v.messages.length === 0) return bad("messages");
  if (v.stream !== undefined && typeof v.stream !== "boolean") return bad("stream");
  if (v.stream_options !== undefined && !isRecord(v.stream_options)) return bad("stream_options");
  if (v.provider !== undefined && !isRecord(v.provider)) return bad("provider");
  if (v.tools !== undefined) {
    if (!Array.isArray(v.tools) || !v.tools.every(isRecord)) return bad("tools");
    // A function tool runs on the sender's side; any other kind (openrouter:web_search) runs upstream.
    if (v.tools.some((t) => (t as Record<string, unknown>).type !== "function") && !opts.planned) return plan("tools");
  }
  for (const k of ["max_tokens", "max_completion_tokens"] as const) {
    const n = v[k];
    if (n !== undefined && (typeof n !== "number" || !Number.isInteger(n) || n < 1)) return bad(k);
  }
  const clamp = (n: unknown): number | undefined => (typeof n === "number" ? Math.min(n, opts.maxTokens) : undefined);
  const maxTokens = clamp(v.max_tokens);
  const maxCompletion = clamp(v.max_completion_tokens);
  const sentMax = maxTokens !== undefined || maxCompletion === undefined ? (maxTokens ?? opts.maxTokens) : undefined;
  return {
    ok: true,
    streamed: v.stream === true,
    // The most the answer may be, whichever of the two fields OpenRouter goes by.
    maxTokens: Math.max(sentMax ?? 0, maxCompletion ?? 0),
    body: {
      ...v,
      ...(maxCompletion !== undefined ? { max_completion_tokens: maxCompletion } : {}),
      // Never open-ended: absent, it is the clamp.
      ...(sentMax !== undefined ? { max_tokens: sentMax } : {}),
      // Only providers that do not keep or train on what they are sent.
      provider: { ...(v.provider as Record<string, unknown> | undefined), data_collection: "deny" },
      // What it cost comes back in the answer (the final chunk, when streamed).
      usage: { include: true },
    },
  };
}

/** Dollars per key over the last 24 hours, in memory (window.ts). */
function daySum(now: () => number) {
  const window = dayWindow<number>(now);
  return {
    sum: (key: string): number => window.get(key).reduce((a, usd) => a + usd, 0),
    add: (key: string, usd: number): void => window.add(key, usd),
    size: (): number => window.size(),
  };
}

/** A US-dollar amount for a header: never negative, to a millionth. */
const usd = (n: number): string => String(Math.max(0, Math.round(n * 1e6) / 1e6));

/** OpenRouter's padding lines start with ":"; they are not JSON. */
const stripKeepAlive = (text: string): string =>
  text
    .split("\n")
    .filter((l) => !l.startsWith(":"))
    .join("\n");

const costOf = (json: unknown): number | null => {
  const c = (json as { usage?: { cost?: unknown } } | null)?.usage?.cost;
  return typeof c === "number" && Number.isFinite(c) && c >= 0 ? c : null;
};

/** The most of an unstreamed answer kept to read its cost from. Past it, the estimate is charged. */
const READ_ALONG_BYTES = 16 * 1024 * 1024;
/** The longest line of a stream kept while looking for the one with the cost. */
const LINE_BYTES = 1024 * 1024;

/**
 * The answer as it comes, byte for byte, read along for `usage.cost`. `settle` is called exactly once,
 * with the cost if the answer said it and null if not: at the end, on an error, or when the sender
 * goes away (which also stops the upstream request).
 */
function readAlong(body: ReadableStream<Uint8Array> | null, streamed: boolean, settle: (cost: number | null) => void): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let settled = false;
  let cost: number | null = null;
  const finish = (): void => {
    if (!settled) (settled = true), settle(cost);
  };
  // Streamed: the current unfinished line. Not streamed: everything so far.
  let text = "";
  let over = false;
  const lines = (chunk: string, last: boolean): void => {
    text += chunk;
    const parts = text.split("\n");
    text = last ? "" : parts.pop()!;
    if (text.length > LINE_BYTES) text = "";
    for (const line of parts) {
      if (!line.startsWith("data:") || !line.includes('"cost"')) continue;
      try {
        cost = costOf(JSON.parse(line.slice(5).trim())) ?? cost;
      } catch {
        // not JSON ([DONE], or cut)
      }
    }
  };
  const whole = (chunk: string, last: boolean): void => {
    if (!over) text += chunk;
    if (text.length > READ_ALONG_BYTES) (over = true), (text = "");
    if (!last || over) return;
    try {
      cost = costOf(JSON.parse(stripKeepAlive(text)) as unknown);
    } catch {
      // not JSON: the estimate is charged
    }
  };
  const take = streamed ? lines : whole;
  const reader = body?.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!reader) {
        finish();
        return controller.close();
      }
      try {
        const { done, value } = await reader.read();
        if (done) {
          take(decoder.decode(), true);
          finish();
          return controller.close();
        }
        take(decoder.decode(value, { stream: true }), false);
        controller.enqueue(value);
      } catch (e) {
        finish();
        controller.error(e);
      }
    },
    async cancel(reason) {
      finish();
      await reader?.cancel(reason).catch(() => {});
    },
  });
}

/** A refusal in OpenAI's error shape, with Potyro's code and words. */
function refuse(status: number, code: ChatErrorCode, extra: { message?: string; param?: string; headers?: Record<string, string> } = {}): ChatReply {
  return {
    status,
    headers: extra.headers ?? {},
    json: { error: { code, message: extra.message ?? CHAT_MESSAGES[code], type: "potyro", ...(extra.param ? { param: extra.param } : {}) } },
  };
}

/** "Used up" — the shell then moves to the person's own key, or says there is none. */
const usedUp = (code: "allowance" | "address-day" | CapReason, message?: string, left = "0"): ChatReply =>
  refuse(429, code, { headers: { "x-potyro-left-usd": left }, ...(message ? { message } : {}) });

export function createChatProxy(deps: ChatDeps): { handle: (req: ChatRequest) => Promise<ChatReply> } {
  const ledger = deps.ledger ?? memoryLedger();
  const budget = deps.budget ?? createBudget({ now: deps.now, ledger, monthlyUsd: deps.limits?.monthlyUsd ?? DEFAULT_CHAT_LIMITS.monthlyUsd, dayUsd: deps.limits?.dayUsd });
  const limits = chatLimits(deps.limits, budget.dayUsd);
  const models = deps.models ?? CHAT_MODELS;
  const prices = deps.prices ?? MODEL_PRICES;
  // A model the relay cannot price is one it cannot hold to a cap: refuse to start.
  for (const m of models) priceOf(prices, m);
  const addressDay = daySum(deps.now);
  // Estimates held for requests that are out, per device and per address (the service's: budget).
  const held = new Map<string, number>();
  const hold = (key: string, usd: number): void => {
    const h = (held.get(key) ?? 0) + usd;
    if (h > 1e-12) held.set(key, h);
    else held.delete(key);
  };
  const inFlight = new Map<string, number>();

  /** No request this device could send this month would fit: it has used its allowance. */
  const usedAll = (month: string, device: string): boolean => ledger.deviceSpent(month, device) + limits.reserveUsd > limits.deviceMonthUsd;

  const handle = async (req: ChatRequest): Promise<ChatReply> => {
    if (deps.isOff?.()) return refuse(503, "off");
    if (req.method !== "POST") return refuse(405, "method");
    const device = DEVICE.exec(req.authorization ?? "")?.[1];
    if (!device) return refuse(401, "device");
    if (req.body.length > limits.bytes) return refuse(413, "too-big");
    let json: unknown;
    try {
      json = JSON.parse(req.body);
    } catch {
      return refuse(400, "request");
    }
    const planned = req.plan ? (deps.planAllows?.(req.plan) ?? false) : false;
    const read = readChatRequest(json, { models, maxTokens: limits.maxTokens, planned });
    if (!read.ok) return refuse(read.status, read.code, read.param ? { param: read.param } : {});

    // Every allowance before anything is sent, each with room for the most this request could cost.
    const month = monthOf(deps.now());
    const address = `address:${addressKey(req.ip)}`;
    const estimate = estimateUsd(priceOf(prices, read.body.model as string), req.body.length, read.maxTokens);
    const h = Math.max(limits.reserveUsd, estimate);
    const cap = budget.over(h);
    if (cap) return usedUp(cap);
    if (usedAll(month, device)) {
      ledger.markExhausted(month, device);
      return usedUp("allowance");
    }
    if (addressDay.sum(address) + (held.get(address) ?? 0) + h > limits.addressDayUsd) return usedUp("address-day");
    if ((inFlight.get(device) ?? 0) >= limits.concurrentPerDevice) return refuse(429, "busy");
    const spent = ledger.deviceSpent(month, device);
    const left = usd(limits.deviceMonthUsd - spent);
    // Not even alone would this one fit in what is left: a smaller one might.
    if (spent + h > limits.deviceMonthUsd) return usedUp("allowance", NOT_ENOUGH_LEFT, left);
    // Room for this one, but not with the ones it already has out: wait, not used up.
    if (spent + (held.get(device) ?? 0) + h > limits.deviceMonthUsd) return refuse(429, "busy");

    hold(device, h);
    hold(address, h);
    const release = budget.hold(h);
    inFlight.set(device, (inFlight.get(device) ?? 0) + 1);
    let settled = false;
    const settle = (cost: number): void => {
      if (settled) return;
      settled = true;
      hold(device, -h);
      hold(address, -h);
      release(cost);
      const n = (inFlight.get(device) ?? 1) - 1;
      if (n > 0) inFlight.set(device, n);
      else inFlight.delete(device);
      if (cost > 0) {
        ledger.debit(month, device, cost);
        addressDay.add(address, cost);
      }
      if (usedAll(month, device)) ledger.markExhausted(month, device);
    };

    let res: Response;
    try {
      res = await deps.upstream(read.body, req.signal);
    } catch (e) {
      // It went out and nothing came back (the sender went away, a timeout, the network): it may
      // have run, so the estimate is charged. The sender leaving is not a failure to report.
      settle(estimate);
      if (!req.signal?.aborted) deps.onError?.(e);
      return refuse(502, "upstream");
    }
    // Potyro's key refused or out of credit, or the upstream down: not the sender's to see. No
    // usage.cost came back, so the estimate is charged.
    if (res.status === 401 || res.status === 402 || res.status === 403 || res.status >= 500) {
      settle(estimate);
      deps.onError?.(new Error(`OpenRouter ${res.status}`));
      await res.body?.cancel().catch(() => {});
      return refuse(502, "upstream");
    }
    // Anything else goes back as it is (a refusal the sender can act on: 400 "reasoning is
    // mandatory", 413, 429), charged what it says it cost, or the estimate when it does not say.
    const stream = readAlong(res.body, read.streamed, (cost) => settle(cost ?? estimate));
    return {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
        "x-potyro-left-usd": left,
      },
      stream,
    };
  };

  return { handle };
}
