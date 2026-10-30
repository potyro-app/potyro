// The free allowance's chat route, for the Studio and Ask (docs/23, docs/16 "AI for apps").
//
// `POST /v1/chat/completions` (public path `/ai/v1/chat/completions`): an OpenAI-shaped chat request,
// sent on to OpenRouter with Potyro's key. Unlike `/complete`, the sender writes the messages, the
// tools and the reasoning settings, because the Studio's loop needs them as they are. What still
// belongs to the relay, because it is Potyro's bill:
//
//   - the model: one from an allowlist (`AI_CHAT_MODELS`), or the request is refused;
//   - `max_tokens`: clamped, and set when the sender left it out, so no request is open-ended;
//   - `provider.data_collection: "deny"` and `usage.include: true`, forced on every request;
//   - OpenRouter's server tools (web search) are refused unless the request carries a plan token,
//     and no plan exists yet (`planAllows`);
//   - money: each device has a monthly allowance in US dollars (`AI_DEVICE_MONTH_USD`), each address
//     a daily one, and the whole service the monthly cap it shares with `/complete`. Every one is
//     checked BEFORE dispatch, with a reserve held for the request about to go out; after it, what
//     OpenRouter says it cost (`usage.cost`, from the final chunk when streamed) replaces the reserve.
//
// The answer is piped, not buffered: a streamed answer and OpenRouter's ": OPENROUTER PROCESSING"
// keep-alive lines reach the sender as they come. The relay only reads along for `usage.cost`.
//
// The device id comes as `Authorization: Bearer potyro-device:<id>`, so the Studio's OpenRouter
// engine can point at this route unchanged (base URL `/ai/v1`, the device token as its key). It is
// random, says nothing about the person, and is never logged; nor is a request's content or an address.
//
// Pure apart from `upstream` and the ledger; server.ts is the thin HTTP part.

import { memoryLedger, monthOf, type Ledger } from "./ledger.ts";

/** The Studio's cheap default (packages/generator, openrouter-backend.ts). */
export const CHAT_MODELS: readonly string[] = ["deepseek/deepseek-v4-flash-0731"];

export interface ChatLimits {
  /** US dollars a device may spend a calendar month (UTC) on this route. */
  deviceMonthUsd: number;
  /** US dollars a day for one address, whatever device ids it sends. */
  addressDayUsd: number;
  /** The whole service, every route together: the same cap as `/complete`'s `monthlyUsd`. */
  monthlyUsd: number;
  /** Held against every allowance while a request is out, and charged when its cost is not known. */
  reserveUsd: number;
  /** The most output tokens one request may ask for. Reasoning comes out of the same budget. */
  maxTokens: number;
  /** The whole request body, checked before parsing. */
  bytes: number;
  concurrentPerDevice: number;
}

export const DEFAULT_CHAT_LIMITS: ChatLimits = {
  deviceMonthUsd: 0.5,
  addressDayUsd: 1,
  monthlyUsd: 10,
  reserveUsd: 0.02,
  maxTokens: 32_000,
  bytes: 4 * 1024 * 1024,
  concurrentPerDevice: 3,
};

export interface ChatDeps {
  /** Sends one body to OpenRouter's chat completions with Potyro's key; the Response is read as a stream. */
  upstream: (body: Record<string, unknown>, signal?: AbortSignal) => Promise<Response>;
  now: () => number;
  ledger?: Ledger;
  limits?: Partial<ChatLimits>;
  models?: readonly string[];
  /** The kill switch, asked on every request: true answers 503 and sends nothing. */
  isOff?: () => boolean;
  /**
   * THE PLAN SEAM. Whether a plan token (header `x-potyro-plan`) may use OpenRouter's server tools
   * (web search), which cost per call on top of tokens. No plan exists yet: absent, every token is
   * refused, and so is every server tool.
   */
  planAllows?: (token: string) => boolean;
  /** Told the upstream's status when it fails. Never the content, the device or the address. */
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

type Read = { ok: true; body: Record<string, unknown>; streamed: boolean } | { ok: false; status: number; error: string };

/**
 * The body that goes to OpenRouter, or why not. Unknown fields are refused, not dropped; messages,
 * tools, tool calls and reasoning go on unchanged.
 */
export function readChatRequest(v: unknown, opts: { models: readonly string[]; maxTokens: number; planned: boolean }): Read {
  const bad = (error: string, status = 400): Read => ({ ok: false, status, error });
  if (!isRecord(v)) return bad("not an object");
  for (const k of Object.keys(v)) {
    if (PLAN_FIELDS.has(k)) {
      if (!opts.planned) return bad("plan", 403);
    } else if (!FIELDS.has(k)) return bad(`unknown field ${k}`);
  }
  if (typeof v.model !== "string" || !opts.models.includes(v.model)) return bad("model");
  if (!Array.isArray(v.messages) || v.messages.length === 0) return bad("messages");
  if (v.stream !== undefined && typeof v.stream !== "boolean") return bad("stream");
  if (v.stream_options !== undefined && !isRecord(v.stream_options)) return bad("stream_options");
  if (v.provider !== undefined && !isRecord(v.provider)) return bad("provider");
  if (v.tools !== undefined) {
    if (!Array.isArray(v.tools) || !v.tools.every(isRecord)) return bad("tools");
    // A function tool runs on the sender's side; any other kind (openrouter:web_search) runs upstream.
    if (v.tools.some((t) => (t as Record<string, unknown>).type !== "function") && !opts.planned) return bad("plan", 403);
  }
  for (const k of ["max_tokens", "max_completion_tokens"] as const) {
    const n = v[k];
    if (n !== undefined && (typeof n !== "number" || !Number.isInteger(n) || n < 1)) return bad(k);
  }
  const clamp = (n: unknown): number | undefined => (typeof n === "number" ? Math.min(n, opts.maxTokens) : undefined);
  const maxTokens = clamp(v.max_tokens);
  const maxCompletion = clamp(v.max_completion_tokens);
  return {
    ok: true,
    streamed: v.stream === true,
    body: {
      ...v,
      ...(maxCompletion !== undefined ? { max_completion_tokens: maxCompletion } : {}),
      // Never open-ended: absent, it is the clamp.
      ...(maxTokens !== undefined || maxCompletion === undefined ? { max_tokens: maxTokens ?? opts.maxTokens } : {}),
      // Only providers that do not keep or train on what they are sent.
      provider: { ...(v.provider as Record<string, unknown> | undefined), data_collection: "deny" },
      // What it cost comes back in the answer (the final chunk, when streamed).
      usage: { include: true },
    },
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Dollars per key over the last 24 hours, in memory. */
function daySum(now: () => number) {
  const seen = new Map<string, Array<[number, number]>>();
  return {
    sum(key: string): number {
      const since = now() - DAY_MS;
      const kept = (seen.get(key) ?? []).filter(([t]) => t > since);
      if (kept.length) seen.set(key, kept);
      else seen.delete(key);
      return kept.reduce((a, [, usd]) => a + usd, 0);
    },
    add(key: string, usd: number): void {
      seen.set(key, [...(seen.get(key) ?? []), [now(), usd]]);
    },
  };
}

/** A US-dollar amount for a header: never negative, to a millionth. */
const usd = (n: number): string => String(Math.max(0, Math.round(n * 1e6) / 1e6));

/** What a reading-along found once the answer ended: its cost, or that it was an error without one. */
type Found = { cost: number | null; error: boolean };

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

/** The most of an unstreamed answer kept to read its cost from. Past it, the reserve is charged. */
const READ_ALONG_BYTES = 16 * 1024 * 1024;
/** The longest line of a stream kept while looking for the one with the cost. */
const LINE_BYTES = 1024 * 1024;

/**
 * The answer as it comes, byte for byte, read along for `usage.cost`. `settle` is called exactly once:
 * at the end, on an error, or when the sender goes away (which also stops the upstream request).
 */
function readAlong(body: ReadableStream<Uint8Array> | null, streamed: boolean, settle: (f: Found) => void): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let settled = false;
  const finish = (f: Found): void => {
    if (!settled) (settled = true), settle(f);
  };
  let cost: number | null = null;
  let error = false;
  // Streamed: the current unfinished line. Not streamed: everything so far.
  let text = "";
  let over = false;
  const lines = (chunk: string, last: boolean): void => {
    text += chunk;
    const parts = text.split("\n");
    text = last ? "" : parts.pop()!;
    if (text.length > LINE_BYTES) text = "";
    // An error in the middle of a stream may come after paid-for tokens: it is not marked free.
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
      const json = JSON.parse(stripKeepAlive(text)) as unknown;
      cost = costOf(json);
      error = isRecord(json) && Boolean(json.error);
    } catch {
      // not JSON: the reserve is charged
    }
  };
  const take = streamed ? lines : whole;
  const reader = body?.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!reader) {
        finish({ cost: null, error: false });
        return controller.close();
      }
      try {
        const { done, value } = await reader.read();
        if (done) {
          take(decoder.decode(), true);
          finish({ cost, error });
          return controller.close();
        }
        take(decoder.decode(value, { stream: true }), false);
        controller.enqueue(value);
      } catch (e) {
        finish({ cost, error: false });
        controller.error(e);
      }
    },
    async cancel(reason) {
      finish({ cost, error: false });
      await reader?.cancel(reason).catch(() => {});
    },
  });
}

/** "Used up" — the shell then moves to the person's own key, or says there is none. */
const usedUp = (reason: string): ChatReply => ({
  status: 429,
  headers: { "x-potyro-left-usd": "0" },
  json: { ok: false, error: "allowance", reason },
});
const refuse = (status: number, error: string): ChatReply => ({ status, headers: {}, json: { ok: false, error } });

export function createChatProxy(deps: ChatDeps): { handle: (req: ChatRequest) => Promise<ChatReply> } {
  const limits: ChatLimits = { ...DEFAULT_CHAT_LIMITS, ...deps.limits };
  const ledger = deps.ledger ?? memoryLedger();
  const models = deps.models ?? CHAT_MODELS;
  const addressDay = daySum(deps.now);
  // Reserves held for requests that are out: per device, per address, and for the whole service.
  const held = new Map<string, number>();
  let heldAll = 0;
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
    if (req.method !== "POST") return refuse(405, "POST only");
    const device = DEVICE.exec(req.authorization ?? "")?.[1];
    if (!device) return refuse(401, "device");
    if (req.body.length > limits.bytes) return refuse(413, "too big");
    let json: unknown;
    try {
      json = JSON.parse(req.body);
    } catch {
      return refuse(400, "not JSON");
    }
    const planned = req.plan ? (deps.planAllows?.(req.plan) ?? false) : false;
    const read = readChatRequest(json, { models, maxTokens: limits.maxTokens, planned });
    if (!read.ok) return refuse(read.status, read.error);

    // Every allowance before anything is sent, each with room for this request.
    const month = monthOf(deps.now());
    const address = `address:${req.ip}`;
    const r = limits.reserveUsd;
    if (ledger.spent(month) + heldAll + r > limits.monthlyUsd) return usedUp("service-month");
    if (usedAll(month, device)) {
      ledger.markExhausted(month, device);
      return usedUp("device-month");
    }
    if (addressDay.sum(address) + (held.get(address) ?? 0) + r > limits.addressDayUsd) return usedUp("address-day");
    if ((inFlight.get(device) ?? 0) >= limits.concurrentPerDevice) return refuse(429, "busy");
    // Room for this one, but not with the ones it already has out: wait, not used up.
    if (ledger.deviceSpent(month, device) + (held.get(device) ?? 0) + r > limits.deviceMonthUsd) return refuse(429, "busy");

    const left = usd(limits.deviceMonthUsd - ledger.deviceSpent(month, device));
    hold(device, r);
    hold(address, r);
    heldAll += r;
    inFlight.set(device, (inFlight.get(device) ?? 0) + 1);
    let settled = false;
    const settle = (cost: number): void => {
      if (settled) return;
      settled = true;
      hold(device, -r);
      hold(address, -r);
      heldAll = Math.max(0, heldAll - r);
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
      // Nothing came back: nothing is charged.
      settle(0);
      deps.onError?.(e);
      return refuse(502, "upstream");
    }
    // Potyro's key refused or out of credit, or the upstream down: not the sender's to see.
    if (res.status === 401 || res.status === 402 || res.status === 403 || res.status >= 500) {
      settle(0);
      deps.onError?.(new Error(`OpenRouter ${res.status}`));
      await res.body?.cancel().catch(() => {});
      return refuse(502, "upstream");
    }
    const failed = res.status < 200 || res.status >= 300;
    // A refusal the sender can act on (400 "reasoning is mandatory", 413, 429) goes back as it is, free.
    const stream = readAlong(res.body, read.streamed, (f) => settle(failed || (f.cost === null && f.error) ? 0 : (f.cost ?? r)));
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
