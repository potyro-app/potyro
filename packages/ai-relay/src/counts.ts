// How many people ran out of the free allowance, brought their own key, asked for a plan, or came
// by: counts a month, and nothing else (#118, docs/16 "AI for apps").
//
//   POST /count {"event": "exhausted" | "own-key" | "want-plan" | "visit"}  → 200 {ok: true}
//   GET  /count                                                         → {ok: true, months: {"2026-10": {visit: 41, …}}}
//
// Nothing that names anyone is kept or logged: no device id, no address, no time finer than the month.
// To keep one address from inflating a number, it counts each event once a day and may post a few
// times a day; that check is held in memory, under a salted hash of the address that a restart
// forgets, and is gone after a day. A repeat is answered like a first, without being counted.
//
// `exhausted` is also counted by the relay itself, the first time a device uses up its allowance in a
// month (ledger.ts `markExhausted`): the shell need not post it after the relay's own 429.

import { createHash, randomBytes } from "node:crypto";
import { COUNT_EVENTS, memoryLedger, monthOf, type CountEvent, type Ledger } from "./ledger.ts";

export interface CountDeps {
  now: () => number;
  ledger?: Ledger;
  /** POSTs a day from one address; past it, 429. */
  perAddressDay?: number;
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

const DAY_MS = 24 * 60 * 60 * 1000;

export function createCounts(deps: CountDeps): { handle: (req: CountRequest) => CountReply } {
  const ledger = deps.ledger ?? memoryLedger();
  const perAddressDay = deps.perAddressDay ?? 20;
  const salt = randomBytes(16);
  const hashed = (ip: string): string => createHash("sha256").update(salt).update(ip).digest("base64url");
  // Per hashed address: when it posted, and what it counted, in the last day.
  const seen = new Map<string, Array<{ at: number; event: CountEvent | null }>>();

  const post = (raw: string, ip: string): CountReply => {
    const key = hashed(ip);
    const since = deps.now() - DAY_MS;
    // Forget what is a day old, everywhere, so the map holds at most a day.
    for (const [k, list] of seen) {
      const kept = list.filter((s) => s.at > since);
      if (kept.length) seen.set(k, kept);
      else seen.delete(k);
    }
    const mine = seen.get(key) ?? [];
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
    const fresh = !mine.some((s) => s.event === e);
    seen.set(key, [...mine, { at: deps.now(), event: fresh ? e : null }]);
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
