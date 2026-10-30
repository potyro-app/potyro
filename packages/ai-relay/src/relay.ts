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
//   - limits per device a day and a month, per address a day (a fresh device id per request does not
//     get past it), and two requests at once per device;
//   - a MONTHLY SPENDING CAP for the whole service, checked before every dispatch with room for the
//     request about to go out; what each request really cost (OpenRouter's `usage.cost`) is added
//     after it. The month's spend and each device's count are kept in a `Ledger` (ledger.ts), which
//     the server writes to a file, so a restart does not hand out a second month's allowance.
//
// The chat route for the Studio and Ask is chat.ts; the demand counts are counts.ts.
//
// A device id is random (shell `deviceId()`), says nothing about the person, and is never logged.
// Pure apart from `upstream` and the ledger; server.ts is the thin HTTP part.

import { memoryLedger, monthOf, type Ledger } from "./ledger.ts";
import { AI_LIMITS, AI_MODEL, openRouterBody, readAiPayload, type UpstreamReply } from "./request.ts";

export { memoryLedger, persistentLedger, type Ledger, type LedgerState } from "./ledger.ts";

export interface Limits {
  perDeviceDay: number;
  perDeviceMonth: number;
  perAddressDay: number;
  /** US dollars a calendar month (UTC) for everyone together. */
  monthlyUsd: number;
  /** Kept free under the cap for the request about to be sent. */
  reserveUsd: number;
  concurrentPerDevice: number;
}

export const DEFAULT_LIMITS: Limits = {
  perDeviceDay: 20,
  perDeviceMonth: 100,
  perAddressDay: 60,
  monthlyUsd: 10,
  reserveUsd: 0.01,
  concurrentPerDevice: 2,
};

/** What a request is counted as when OpenRouter does not say what it cost: well above a receipt. */
export const UNPRICED_USD = 0.005;

export interface RelayDeps {
  /** Sends one OpenRouter body with Potyro's key. */
  upstream: (body: Record<string, unknown>) => Promise<UpstreamReply>;
  now: () => number;
  limits?: Partial<Limits>;
  ledger?: Ledger;
  model?: string;
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
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayCounter(now: () => number) {
  const seen = new Map<string, number[]>();
  return {
    count(key: string): number {
      const since = now() - DAY_MS;
      const times = (seen.get(key) ?? []).filter((t) => t > since);
      if (times.length) seen.set(key, times);
      else seen.delete(key);
      return times.length;
    },
    note(key: string): void {
      seen.set(key, [...(seen.get(key) ?? []), now()]);
    },
  };
}

/** "Used up" — the shell then tries the person's own key, and says so when there is none. */
const usedUp = (reason: string): RelayResponse => ({ status: 429, body: { ok: false, error: "allowance", reason } });

export function createAiRelay(deps: RelayDeps): { handle: (req: RelayRequest) => Promise<RelayResponse> } {
  const limits: Limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const ledger = deps.ledger ?? memoryLedger();
  const model = deps.model ?? AI_MODEL;
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
    const address = `address:${ip}`;

    // Every limit before anything is sent; the cap with room for this request.
    if (ledger.spent(month) + limits.reserveUsd > limits.monthlyUsd) return usedUp("service-month");
    if (ledger.count(month, p.device) >= limits.perDeviceMonth) {
      ledger.markExhausted(month, p.device);
      return usedUp("device-month");
    }
    if (daily.count(device) >= limits.perDeviceDay) return usedUp("device-day");
    if (daily.count(address) >= limits.perAddressDay) return usedUp("address-day");
    if ((inFlight.get(p.device) ?? 0) >= limits.concurrentPerDevice) return { status: 429, body: { ok: false, error: "busy" } };

    daily.note(device);
    daily.note(address);
    inFlight.set(p.device, (inFlight.get(p.device) ?? 0) + 1);
    try {
      const reply = await deps.upstream(openRouterBody(p, model));
      if (!reply.ok) {
        deps.onError?.(new Error(`OpenRouter ${reply.status}: ${reply.message}`));
        return { status: 502, body: { ok: false, error: "upstream" } };
      }
      ledger.addSpend(month, reply.cost ?? UNPRICED_USD);
      ledger.addCount(month, p.device);
      // The request that uses the last of the month is when the device crossed its allowance.
      if (ledger.count(month, p.device) >= limits.perDeviceMonth) ledger.markExhausted(month, p.device);
      return { status: 200, body: { ok: true, text: reply.text, model, left: Math.max(0, limits.perDeviceMonth - ledger.count(month, p.device)) } };
    } catch (e) {
      deps.onError?.(e);
      return { status: 502, body: { ok: false, error: "upstream" } };
    } finally {
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
