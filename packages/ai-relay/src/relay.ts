// The relay that pays for the free AI allowance (docs/23).
//
// It holds Potyro's OpenRouter key, which is the only reason it exists: a key in the shell would be
// everybody's key. Everything about it is narrow, because it stands between anyone on the internet
// and a bill:
//
//   - one route, `POST /complete`, taking exactly the payload `readAiPayload` accepts, size-capped
//     before parsing;
//   - the model, the token cap and the provider rules are fixed here (`openRouterBody`), never by the
//     sender;
//   - limits per device a day and a month, per address a day (a fresh device id per request does not
//     get past it), and two requests at once per device;
//   - a MONTHLY SPENDING CAP for the whole service, checked before every dispatch with room for the
//     request about to go out; what each request really cost (OpenRouter's `usage.cost`) is added
//     after it. The month's spend and each device's count are kept in a `Ledger`, which the server
//     writes to a file, so a restart does not hand out a second month's allowance.
//
// A device id is random (shell `deviceId()`), says nothing about the person, and is never logged.
// Pure apart from `upstream` and the ledger; server.ts is the thin HTTP part.

import { AI_LIMITS, AI_MODEL, openRouterBody, readAiPayload, type UpstreamReply } from "./request.ts";

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

/** The month's spend and counts. Kept in memory by default; server.ts keeps it in a file. */
export interface Ledger {
  spent(month: string): number;
  addSpend(month: string, usd: number): void;
  count(month: string, device: string): number;
  addCount(month: string, device: string): void;
}

export function memoryLedger(initial?: LedgerState | null): Ledger & { snapshot(): LedgerState } {
  let state: LedgerState = readState(initial) ?? { month: "", spent: 0, devices: {} };
  const at = (month: string): LedgerState => (state.month === month ? state : (state = { month, spent: 0, devices: {} }));
  return {
    spent: (m) => at(m).spent,
    addSpend: (m, usd) => void (at(m).spent += usd),
    count: (m, d) => at(m).devices[d] ?? 0,
    addCount: (m, d) => void (at(m).devices[d] = (at(m).devices[d] ?? 0) + 1),
    snapshot: () => state,
  };
}

/** The ledger's whole state: one month, its spend and a count per device id. */
export interface LedgerState {
  month: string;
  spent: number;
  devices: Record<string, number>;
}

/** A saved state, if it is one; a damaged file is not a reason to start the month at zero silently — the server refuses to start. */
function readState(s: unknown): LedgerState | null {
  if (s == null) return null;
  const o = s as Partial<LedgerState>;
  if (typeof o.month !== "string" || typeof o.spent !== "number" || !Number.isFinite(o.spent) || typeof o.devices !== "object" || o.devices === null) {
    throw new Error("the ledger file is not a ledger");
  }
  const devices: Record<string, number> = {};
  for (const [d, n] of Object.entries(o.devices)) if (typeof n === "number" && Number.isFinite(n)) devices[d] = n;
  return { month: o.month, spent: o.spent, devices };
}

/** A memory ledger that starts from `initial` and calls `save` after every change. */
export function persistentLedger(initial: LedgerState | null, save: (s: LedgerState) => void): Ledger {
  const mem = memoryLedger(initial);
  return {
    spent: mem.spent,
    count: mem.count,
    addSpend: (m, usd) => (mem.addSpend(m, usd), save(mem.snapshot())),
    addCount: (m, d) => (mem.addCount(m, d), save(mem.snapshot())),
  };
}

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

const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

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
    if (ledger.count(month, p.device) >= limits.perDeviceMonth) return usedUp("device-month");
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
