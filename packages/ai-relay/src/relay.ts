// The relay that pays for the free AI allowance (docs/23).
//
// It holds Potyro's OpenRouter key, which is the only reason it exists: a key in the shell would be
// everybody's key. Everything about it is narrow, because it stands between anyone on the internet
// and a bill:
//
//   - `POST /complete` (this file) takes exactly the payload `readAiPayload` accepts, size-capped
//     before parsing;
//   - the model, the token cap and the provider rules are fixed here (`openRouterBody`), never by the
//     sender;
//   - limits per device a day and a month, per address a day (an IPv6 address by its /64, so a fresh
//     device id or a fresh address per request does not get past it), and two requests at once per
//     device. A request is counted when it is SENT, whatever comes back;
//   - a MONTHLY and a DAILY SPENDING CAP for the whole service, shared with the chat route
//     (budget.ts), checked before every dispatch with what the request could cost at most
//     (prices.ts) on top of every request still out. Past a cap by what was SPENT is "used up"
//     (429 `allowance`); past it only by what requests in flight hold, or with as many out as the
//     relay sends at once, is 503 `busy` with Retry-After. After it, what it really cost (OpenRouter's
//     `usage.cost`) is spent — or the estimate, when OpenRouter did not say: a failure, an empty
//     answer, a timeout. The month's spend and each device's count are kept in a `Ledger`
//     (ledger.ts), which the server writes to a file, so a restart does not hand out a second
//     month's allowance.
//
// The chat route for the Studio and Ask is chat.ts; the demand counts are counts.ts.
//
// A device id is random (shell `deviceId()`), says nothing about the person, and is never logged.
// Pure apart from `upstream` and the ledger; server.ts is the thin HTTP part.

import { addressKey } from "./address.ts";
import { BUSY_RETRY_SECONDS, createBudget, type Budget } from "./budget.ts";
import { memoryLedger, monthOf, type Ledger } from "./ledger.ts";
import { estimateUsd, MODEL_PRICES, priceOf, type Prices } from "./prices.ts";
import { AI_LIMITS, AI_MODEL, openRouterBody, readAiPayload, type UpstreamReply } from "./request.ts";
import { dayWindow } from "./window.ts";

export { memoryLedger, persistentLedger, type Ledger, type LedgerState } from "./ledger.ts";

export interface Limits {
  perDeviceDay: number;
  perDeviceMonth: number;
  perAddressDay: number;
  /** US dollars a calendar month (UTC) for everyone together, when no shared `budget` is given. */
  monthlyUsd: number;
  /** The same, a day; default an eighth of `monthlyUsd`. */
  dayUsd?: number;
  concurrentPerDevice: number;
}

export const DEFAULT_LIMITS: Limits = {
  perDeviceDay: 20,
  perDeviceMonth: 100,
  perAddressDay: 60,
  monthlyUsd: 10,
  concurrentPerDevice: 2,
};

export interface RelayDeps {
  /** Sends one OpenRouter body with Potyro's key. */
  upstream: (body: Record<string, unknown>) => Promise<UpstreamReply>;
  now: () => number;
  limits?: Partial<Limits>;
  ledger?: Ledger;
  /** The service's caps, shared with the chat route. Absent: one of its own from `limits`. */
  budget?: Budget;
  model?: string;
  /** What the model costs (prices.ts); it must be in it. */
  prices?: Prices;
  onError?: (e: unknown) => void;
}

export interface RelayRequest {
  method: string;
  path: string;
  body: string;
  /** The sender's address, as the proxy in front reports it. */
  ip: string;
}

export interface RelayResponse {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** Requests per key over the last 24 hours, in memory (window.ts). */
function dayCounter(now: () => number) {
  const window = dayWindow<true>(now);
  return {
    count: (key: string): number => window.get(key).length,
    note: (key: string): void => window.add(key, true),
  };
}

/** "Used up" — the shell then tries the person's own key, and says so when there is none. */
const usedUp = (reason: string): RelayResponse => ({ status: 429, body: { ok: false, error: "allowance", reason } });

/**
 * "Busy" — nothing is used up: the requests in flight (on either route) hold the room there is, or
 * as many are out as the relay sends at once (budget.ts). The shell says "try again", and does not
 * take it for an allowance that ran out.
 */
const serviceBusy = (): RelayResponse => ({ status: 503, body: { ok: false, error: "busy" }, headers: { "retry-after": String(BUSY_RETRY_SECONDS) } });

export function createAiRelay(deps: RelayDeps): { handle: (req: RelayRequest) => Promise<RelayResponse> } {
  const limits: Limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const ledger = deps.ledger ?? memoryLedger();
  const model = deps.model ?? AI_MODEL;
  const budget = deps.budget ?? createBudget({ now: deps.now, ledger, monthlyUsd: limits.monthlyUsd, dayUsd: limits.dayUsd });
  // A model the relay cannot price is one it cannot hold to a cap: refuse to start.
  const price = priceOf(deps.prices ?? MODEL_PRICES, model);
  const daily = dayCounter(deps.now);
  const inFlight = new Map<string, number>();

  const complete = async (raw: string, ip: string): Promise<RelayResponse> => {
    if (raw.length > AI_LIMITS.bytes) return { status: 413, body: { ok: false, error: "too big" } };
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { status: 400, body: { ok: false, error: "not JSON" } };
    }
    const read = readAiPayload(json);
    if (!read.ok) return { status: 400, body: { ok: false, error: read.error } };
    const p = read.payload;
    const month = monthOf(deps.now());
    const device = `device:${p.device}`;
    const address = `address:${addressKey(ip)}`;
    const body = openRouterBody(p, model);
    const estimate = estimateUsd(price, JSON.stringify(body).length, body.max_tokens as number);

    // Every limit before anything is sent; the caps with room for the most this request could cost.
    const cap = budget.over(estimate);
    if (cap === "busy") return serviceBusy();
    if (cap) return usedUp(cap);
    if (ledger.count(month, p.device) >= limits.perDeviceMonth) {
      ledger.markExhausted(month, p.device);
      return usedUp("device-month");
    }
    if (daily.count(device) >= limits.perDeviceDay) return usedUp("device-day");
    if (daily.count(address) >= limits.perAddressDay) return usedUp("address-day");
    if ((inFlight.get(p.device) ?? 0) >= limits.concurrentPerDevice) return { status: 429, body: { ok: false, error: "busy" } };

    // Counted as it goes out: a request that fails still used a turn, and may have cost something.
    daily.note(device);
    daily.note(address);
    ledger.addCount(month, p.device);
    // The request that uses the last of the month is when the device crossed its allowance.
    if (ledger.count(month, p.device) >= limits.perDeviceMonth) ledger.markExhausted(month, p.device);
    inFlight.set(p.device, (inFlight.get(p.device) ?? 0) + 1);
    const release = budget.hold(estimate);
    // What it cost if OpenRouter said, and the estimate if not (a failure, an empty answer, a timeout).
    let cost = estimate;
    try {
      const reply = await deps.upstream(body);
      if (!reply.ok) {
        deps.onError?.(new Error(`OpenRouter ${reply.status}: ${reply.message}`));
        return { status: 502, body: { ok: false, error: "upstream" } };
      }
      cost = reply.cost ?? estimate;
      return { status: 200, body: { ok: true, text: reply.text, model, left: Math.max(0, limits.perDeviceMonth - ledger.count(month, p.device)) } };
    } catch (e) {
      deps.onError?.(e);
      return { status: 502, body: { ok: false, error: "upstream" } };
    } finally {
      release(cost);
      ledger.addSpend(month, cost);
      const n = (inFlight.get(p.device) ?? 1) - 1;
      if (n > 0) inFlight.set(p.device, n);
      else inFlight.delete(p.device);
    }
  };

  return {
    handle: async (req) => {
      if (req.path === "/health") return req.method === "GET" ? { status: 200, body: { ok: true } } : { status: 405, body: { ok: false } };
      if (req.path !== "/complete") return { status: 404, body: { ok: false, error: "not found" } };
      if (req.method !== "POST") return { status: 405, body: { ok: false, error: "POST only" } };
      return complete(req.body, req.ip);
    },
  };
}
