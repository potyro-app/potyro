// How many people ran out of the free allowance, brought their own key, asked for a plan, or came
// by: counts a month, and nothing else (#118, docs/16 "AI for apps").
//
//   POST /count {"event": "exhausted" | "own-key" | "want-plan" | "visit"}  → 200 {ok: true}
//   GET  /count                                                         → {ok: true, months: {"2026-10": {visit: 41, …}}}
//
// Nothing that names anyone is kept or logged: no device id, no address, no time finer than the month.
// To keep one address from inflating a number, it counts each event once a day and may post a few
// times a day; that check is held in memory, under a salted hash of the address (an IPv6 one by its
// /64, address.ts) that a restart forgets, and is gone after a day (window.ts: each post looks at its
// own address only, the rest is swept now and then, and the map is capped). A repeat is answered
// like a first, without being counted.
//
// `exhausted` is also counted by the relay itself, the first time a device uses up its allowance in a
// month (ledger.ts `markExhausted`): the shell need not post it after the relay's own 429.

import { createHash, randomBytes } from "node:crypto";
import { addressKey } from "./address.ts";
import { COUNT_EVENTS, memoryLedger, monthOf, type CountEvent, type Ledger } from "./ledger.ts";
import { dayWindow } from "./window.ts";

export interface CountDeps {
  now: () => number;
  ledger?: Ledger;
  /** POSTs a day from one address; past it, 429. */
  perAddressDay?: number;
  /** The most addresses remembered at once (window.ts). */
  maxKeys?: number;
}

export interface CountRequest {
  method: string;
  body: string;
  ip: string;
}

export interface CountReply {
  status: number;
  body: Record<string, unknown>;
}

export function createCounts(deps: CountDeps): { handle: (req: CountRequest) => CountReply } {
  const ledger = deps.ledger ?? memoryLedger();
  const perAddressDay = deps.perAddressDay ?? 20;
  const salt = randomBytes(16);
  const hashed = (ip: string): string => createHash("sha256").update(salt).update(addressKey(ip)).digest("base64url");
  // Per hashed address: what each post in the last day counted (null: a repeat, or not an event).
  const seen = dayWindow<CountEvent | null>(deps.now, deps.maxKeys === undefined ? {} : { maxKeys: deps.maxKeys });

  const post = (raw: string, ip: string): CountReply => {
    const key = hashed(ip);
    const mine = seen.get(key);
    if (mine.length >= perAddressDay) return { status: 429, body: { ok: false, error: "busy" } };
    let event: unknown;
    try {
      const json = JSON.parse(raw) as unknown;
      if (typeof json !== "object" || json === null || Array.isArray(json) || Object.keys(json).length !== 1) throw new Error();
      event = (json as { event?: unknown }).event;
    } catch {
      return { status: 400, body: { ok: false, error: "not a count" } };
    }
    if (!(COUNT_EVENTS as readonly unknown[]).includes(event)) return { status: 400, body: { ok: false, error: "event" } };
    const e = event as CountEvent;
    const fresh = !mine.includes(e);
    seen.add(key, fresh ? e : null);
    if (fresh) ledger.addEvent(monthOf(deps.now()), e);
    return { status: 200, body: { ok: true } };
  };

  return {
    handle: (req) => {
      if (req.method === "GET") return { status: 200, body: { ok: true, months: ledger.events() } };
      if (req.method === "POST") return post(req.body, req.ip);
      return { status: 405, body: { ok: false, error: "GET or POST" } };
    },
  };
}
