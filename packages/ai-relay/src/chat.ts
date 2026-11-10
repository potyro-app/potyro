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
//     and when it did not say, what "WHAT A REQUEST WITHOUT A COST IS CHARGED" below works out;
//   - "used up" and "busy" are different answers. Used up (429 `allowance`, `address-day`,
//     `service-day`, `service-month`) is about money really spent, and the shell remembers it until
//     the month or day ends. When only the holds of requests in flight are in the way — the
//     service's, the address's — or as many are out as the relay sends at once, it is 503
//     `service-busy` with Retry-After, which nobody remembers: it is over in seconds.
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
import { BUSY_RETRY_SECONDS, createBudget, type Budget, type CapReason } from "./budget.ts";
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
   * home, school or mobile carrier behind one address shares it, so by default it is four devices'
   * months — but never more than `addressDayShare` of the service's day.
   */
  addressDayUsd: number;
  /**
   * The most of the service's day one address may have when `addressDayUsd` is not set: above 0,
   * below 1. Default a fifth (ADDRESS_DAY_SHARE).
   */
  addressDayShare: number;
  /** The whole service, every route together, when no shared `budget` is given (budget.ts). */
  monthlyUsd: number;
  /** The same, a day; default an eighth of `monthlyUsd`. */
  dayUsd: number;
  /** The least a request is held for while it is out; more when its estimate is more (prices.ts). */
  reserveUsd: number;
  /** The most output tokens one request may ask for. Reasoning comes out of the same budget. */
  maxTokens: number;
  /**
   * The most tokens a second a model is taken to write, for charging a request that was cut and
   * did not say what it cost ("WHAT A REQUEST WITHOUT A COST IS CHARGED"). On the high side for the
   * models in `AI_CHAT_MODELS`; raise it with a faster one.
   */
  outTokensPerSecond: number;
  /** The whole request body, checked before parsing. */
  bytes: number;
  concurrentPerDevice: number;
}

/**
 * The most of the service's day one address may spend, by default: a fifth.
 *
 * It was a half, so two addresses could close the day for everyone. A smaller share protects the
 * service; a larger one is kinder to the many people who share one address (a school, a mobile
 * carrier's NAT). A fifth means it takes five different networks to close a day, and with the
 * default $1.25 day still leaves one address $0.25, a dozen or two apps. With a real budget the
 * share stops mattering: four devices' months ($2) is the lower of the two from a $10 day up. What
 * used to hurt a shared address most was not this number but its holds being read as "used up"
 * (thirty pupils pressing Make at once): that is `service-busy` now, and nobody is locked out.
 */
export const ADDRESS_DAY_SHARE = 0.2;

/** The defaults; `addressDayUsd` and `dayUsd` follow from the others (`chatLimits`). */
export const DEFAULT_CHAT_LIMITS: Omit<ChatLimits, "addressDayUsd" | "dayUsd"> = {
  deviceMonthUsd: 0.5,
  monthlyUsd: 10,
  reserveUsd: 0.02,
  maxTokens: 64_000,
  outTokensPerSecond: 300,
  addressDayShare: ADDRESS_DAY_SHARE,
  bytes: 4 * 1024 * 1024,
  concurrentPerDevice: 3,
};

/** How many devices' months one address may spend a day, by default. */
export const ADDRESS_DEVICES = 4;

/** The limits in force: the defaults, what was set, and the two that follow from them. */
export function chatLimits(set: Partial<ChatLimits> = {}, dayUsd?: number): ChatLimits {
  const base = { ...DEFAULT_CHAT_LIMITS, ...set };
  const day = dayUsd ?? set.dayUsd ?? base.monthlyUsd / 8;
  const share = base.addressDayShare;
  if (!(share > 0 && share < 1)) throw new Error(`AI_ADDRESS_DAY_SHARE (${share}) must be above 0 and below 1: the part of the service's day one address may spend`);
  const limits: ChatLimits = { ...base, dayUsd: day, addressDayUsd: set.addressDayUsd ?? Math.min(ADDRESS_DEVICES * base.deviceMonthUsd, day * share) };
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
  | "service-busy"
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
  "service-busy": "Free AI is busy right now. Try again in a moment.",
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

const utf8 = new TextEncoder();
/** The bytes of every string in a value: no fewer than the tokens it took to write them. */
function textBytes(v: unknown): number {
  if (typeof v === "string") return utf8.encode(v).length;
  if (Array.isArray(v)) return v.reduce<number>((n, x) => n + textBytes(x), 0);
  if (isRecord(v)) return Object.values(v).reduce<number>((n, x) => n + textBytes(x), 0);
  return 0;
}
/** The bytes of answer one stream chunk carries: its deltas' strings (content, reasoning, tool calls). */
const chunkBytes = (json: unknown): number => {
  const choices = (json as { choices?: unknown } | null)?.choices;
  return Array.isArray(choices) ? choices.reduce<number>((n, c) => n + textBytes((c as { delta?: unknown; message?: unknown } | null)?.delta ?? (c as { message?: unknown } | null)?.message), 0) : 0;
};

/** How an answer ended, for the charge. */
interface Ended {
  /** What the answer said it cost; null when it did not say. */
  cost: number | null;
  /** True when it did not reach its end: the sender went away, or the upstream broke off. */
  cut: boolean;
  /** Bytes of answer that came: a stream's delta strings, or all of an unstreamed body. */
  outBytes: number;
}

/**
 * The answer as it comes, byte for byte, read along for `usage.cost` and for how much answer came.
 * `settle` is called exactly once: at the end, on an error, or when the sender goes away (which
 * also stops the upstream request).
 */
function readAlong(body: ReadableStream<Uint8Array> | null, streamed: boolean, settle: (ended: Ended) => void): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let settled = false;
  let cost: number | null = null;
  let outBytes = 0;
  // Streamed: the current unfinished line. Not streamed: everything so far.
  let text = "";
  const finish = (cut: boolean): void => {
    if (settled) return;
    settled = true;
    // A stream's unfinished line is answer too.
    settle({ cost, cut, outBytes: outBytes + (streamed ? text.length : 0) });
  };
  let over = false;
  const lines = (chunk: string, last: boolean): void => {
    text += chunk;
    const parts = text.split("\n");
    text = last ? "" : parts.pop()!;
    // Too long to keep: counted as answer, byte for byte.
    if (text.length > LINE_BYTES) (outBytes += text.length), (text = "");
    for (const line of parts) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as unknown;
        if (line.includes('"cost"')) cost = costOf(json) ?? cost;
        outBytes += chunkBytes(json);
      } catch {
        // Not JSON (cut): counted as it is.
        outBytes += data.length;
      }
    }
  };
  const whole = (chunk: string, last: boolean): void => {
    outBytes += chunk.length;
    if (!over) text += chunk;
    if (text.length > READ_ALONG_BYTES) (over = true), (text = "");
    if (!last || over) return;
    try {
      cost = costOf(JSON.parse(stripKeepAlive(text)) as unknown);
    } catch {
      // not JSON: charged as an answer that did not say
    }
  };
  const take = streamed ? lines : whole;
  const reader = body?.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!reader) {
        finish(false);
        return controller.close();
      }
      try {
        const { done, value } = await reader.read();
        if (done) {
          take(decoder.decode(), true);
          finish(false);
          return controller.close();
        }
        take(decoder.decode(value, { stream: true }), false);
        controller.enqueue(value);
      } catch (e) {
        finish(true);
        controller.error(e);
      }
    },
    async cancel(reason) {
      finish(true);
      await reader?.cancel(reason).catch(() => {});
    },
  });
}

/** Error codes of a connection that was never made (Node, undici): the request did not leave. */
const NEVER_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
/** True when a failed fetch never reached OpenRouter (the cause chain says the connection was not made). */
export function neverSent(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++) {
    const code = (x as { code?: unknown }).code;
    if (typeof code === "string" && NEVER_SENT.has(code)) return true;
  }
  return false;
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

/**
 * "Busy" — nothing is used up: requests in flight are in the way, and will not be for long. 503 with
 * Retry-After and no `x-potyro-left-usd`, so no client takes it for an allowance that ran out.
 */
const serviceBusy = (): ChatReply => refuse(503, "service-busy", { headers: { "retry-after": String(BUSY_RETRY_SECONDS) } });

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
    // What is USED UP is said first (money really spent: waiting does not help); then what is only
    // BUSY (holds of requests in flight, or too many out at once: waiting a moment does).
    const startedAt = deps.now();
    const month = monthOf(startedAt);
    const address = `address:${addressKey(req.ip)}`;
    const price = priceOf(prices, read.body.model as string);
    const estimate = estimateUsd(price, req.body.length, read.maxTokens);
    const h = Math.max(limits.reserveUsd, estimate);
    const cap = budget.over(h);
    if (cap && cap !== "busy") return usedUp(cap);
    if (usedAll(month, device)) {
      ledger.markExhausted(month, device);
      return usedUp("allowance");
    }
    const addressSpent = addressDay.sum(address);
    if (addressSpent + h > limits.addressDayUsd) return usedUp("address-day");
    if ((inFlight.get(device) ?? 0) >= limits.concurrentPerDevice) return refuse(429, "busy");
    const spent = ledger.deviceSpent(month, device);
    const left = usd(limits.deviceMonthUsd - spent);
    // Not even alone would this one fit in what is left: a smaller one might.
    if (spent + h > limits.deviceMonthUsd) return usedUp("allowance", NOT_ENOUGH_LEFT, left);
    // Room for this one, but not with the ones it already has out: wait, not used up.
    if (spent + (held.get(device) ?? 0) + h > limits.deviceMonthUsd) return refuse(429, "busy");
    // Room in the service's day and month and in this address's day, but for what other requests
    // hold while they are out (or as many are out as the relay sends at once): come back in a moment.
    if (cap === "busy" || addressSpent + (held.get(address) ?? 0) + h > limits.addressDayUsd) return serviceBusy();

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

    // WHAT A REQUEST WITHOUT A COST IS CHARGED
    //
    // OpenRouter's own `usage.cost` is charged whenever an answer carries it. When none came, the
    // charge is the most the request can defensibly have cost, never more than its estimate:
    //
    //   1. OpenRouter was never reached (the connection was not made): NOTHING. Nothing ran.
    //   2. OpenRouter answered with an error status and no cost (Potyro's key refused or out of
    //      credit, a 5xx, a 400 or its own 429 passed back): NOTHING. It bills what a model wrote,
    //      and here none wrote. The sender got no answer either, so nothing is given away.
    //   3. The answer was CUT (`cutUsd`) — the sender went away, a timeout, the upstream broke off,
    //      before the first byte or in the middle of a stream: the INPUT side of the estimate (the
    //      model may have read the whole request), plus output for whichever is MORE of
    //        a. the bytes of answer that came, one token a byte. A token is never less than a
    //           byte, so this is no less than what was received (about four times it, for English);
    //        b. the seconds the request was out × `outTokensPerSecond`: what a model could have
    //           written that never showed (reasoning that is not streamed, an unstreamed answer
    //           still being written, a provider that kept writing after the sender left);
    //      and never more than the `max_tokens` the estimate already holds.
    //   4. A WHOLE answer with a 2xx that carries no cost: the full ESTIMATE, as before. It ran to
    //      its end and nothing says how far it went.
    //
    // Leaving late buys nothing. A sender that takes most of a stream and goes just before the
    // usage chunk pays, by 3a, for every byte it was given at a token a byte, which is more than
    // those tokens cost; once what came reaches `max_tokens` it pays the same full estimate as 4.
    // Leaving early is cheap because little was written: pressing Stop after two seconds is
    // charged for the request and two seconds of writing, not for 64 000 tokens that never were.
    const cutUsd = (outBytes: number): number => {
      const seconds = Math.max(0, (deps.now() - startedAt) / 1000);
      const tokens = Math.min(read.maxTokens, Math.max(outBytes, Math.ceil(seconds * limits.outTokensPerSecond)));
      return Math.min(estimate, estimateUsd(price, req.body.length, tokens));
    };

    let res: Response;
    try {
      res = await deps.upstream(read.body, req.signal);
    } catch (e) {
      // Nothing came back (the sender went away, a timeout, the network). Never reached: rule 1.
      // Otherwise it may have run for as long as it was out: rule 3. The sender leaving is not a
      // failure to report.
      settle(neverSent(e) ? 0 : cutUsd(0));
      if (!req.signal?.aborted) deps.onError?.(e);
      return refuse(502, "upstream");
    }
    // Potyro's key refused or out of credit, or the upstream down: not the sender's to see, and
    // nothing ran (rule 2).
    if (res.status === 401 || res.status === 402 || res.status === 403 || res.status >= 500) {
      settle(0);
      deps.onError?.(new Error(`OpenRouter ${res.status}`));
      await res.body?.cancel().catch(() => {});
      return refuse(502, "upstream");
    }
    // Anything else goes back as it is (an answer; or a refusal the sender can act on: 400
    // "reasoning is mandatory", 413, 429), charged what it says it cost, or by the rules above.
    const ran = res.status >= 200 && res.status < 300;
    const stream = readAlong(res.body, read.streamed, ({ cost, cut, outBytes }) => settle(cost ?? (!ran ? 0 : cut ? cutUsd(outBytes) : estimate)));
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
