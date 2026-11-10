// The whole service's money, shared by both routes (`/complete` and the chat route): a monthly cap
// and a daily one, each checked BEFORE dispatch, counting every request still out (docs/16 "AI for
// apps").
//
// A request about to go out is checked with what it could cost at most (prices.ts) on top of what
// was spent and what the requests in flight hold. If it fits it is held for that much until it
// settles; then the hold is let go and what it is charged (what OpenRouter says it cost, or the
// routes' rule when it did not say) is spent. So any number of requests at once cannot carry the
// service past a cap.
//
// A request that does not fit is refused unsent, for one of two reasons that must not be mixed up:
//
//   - USED UP (`service-month`, `service-day`): what was really SPENT leaves no room for it. That
//     lasts until the month or the day ends, and the shell remembers it that long.
//   - BUSY (`busy`): what was spent would leave room, but the requests in flight hold it for now —
//     or as many are out as the relay sends at once (`AI_MAX_IN_FLIGHT`). A hold is the most a
//     request could cost, usually ten times what it will, so a hundred people at the same minute
//     can hold a whole day of which a hundredth is spent. That is over in seconds: the answer says
//     to come back (Retry-After), and nobody may remember it as "used up".
//
// The daily cap keeps one day from eating the month: by default an eighth of the month
// (`AI_DAY_USD`). The month's spend is written by the routes (ledger `debit`, `addSpend`), the day's
// here; both are in the ledger, so a restart keeps them. What is held is in memory: a restart lets
// go of requests that died with it.

import { dayOf, memoryLedger, monthOf, type Ledger } from "./ledger.ts";

/** Used up: what was spent leaves no room, until the month or the day is over. */
export type CapReason = "service-month" | "service-day";
/** Why a request cannot go now: used up, or only `busy` (the requests in flight are in the way). */
export type Full = CapReason | "busy";

/** Seconds a `busy` answer asks the sender to wait (Retry-After): requests in flight settle within seconds. */
export const BUSY_RETRY_SECONDS = 5;

export interface Budget {
  readonly monthlyUsd: number;
  readonly dayUsd: number;
  /** The most requests out at once, both routes together. */
  readonly maxInFlight: number;
  /**
   * Why `usd` more cannot go out now; null when it can. A cap that what was SPENT leaves no room
   * under is named; `busy` when only the requests in flight are in the way.
   */
  over(usd: number): Full | null;
  /** Holds `usd` while a request is out. The release, called once, lets it go and spends `costUsd` today. */
  hold(usd: number): (costUsd: number) => void;
  /** US dollars held by requests in flight. */
  held(): number;
  /** Requests in flight. */
  inFlight(): number;
}

export interface BudgetDeps {
  now: () => number;
  ledger?: Ledger;
  /** Default $10. */
  monthlyUsd?: number;
  /** Default an eighth of `monthlyUsd`. */
  dayUsd?: number;
  /** Default 50. */
  maxInFlight?: number;
}

export const DEFAULT_MONTHLY_USD = 10;
/** The daily cap, unless set, is the month's divided by this. */
export const DAY_SHARE = 8;
/**
 * Requests out at once towards OpenRouter, both routes together, unless set. A chat request can be
 * out for minutes, so this is roughly how many people may be waiting for an answer at the same
 * moment. It bounds the sockets and memory of one small process and what a burst can ask of
 * Potyro's one OpenRouter key, whatever the money caps are set to.
 */
export const DEFAULT_MAX_IN_FLIGHT = 50;

export function createBudget(deps: BudgetDeps): Budget {
  const ledger = deps.ledger ?? memoryLedger();
  const monthlyUsd = deps.monthlyUsd ?? DEFAULT_MONTHLY_USD;
  const dayUsd = deps.dayUsd ?? monthlyUsd / DAY_SHARE;
  const maxInFlight = deps.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
  if (!Number.isInteger(maxInFlight) || maxInFlight < 1) throw new Error(`AI_MAX_IN_FLIGHT (${maxInFlight}) must be a whole number, 1 or more`);
  let held = 0;
  let out = 0;
  return {
    monthlyUsd,
    dayUsd,
    maxInFlight,
    over(usd) {
      const now = deps.now();
      const month = ledger.spent(monthOf(now));
      const day = ledger.daySpent(dayOf(now));
      // What was spent decides "used up", and is said first: waiting does not help with it.
      if (month + usd > monthlyUsd) return "service-month";
      if (day + usd > dayUsd) return "service-day";
      if (out >= maxInFlight) return "busy";
      if (month + held + usd > monthlyUsd || day + held + usd > dayUsd) return "busy";
      return null;
    },
    hold(usd) {
      held += usd;
      out += 1;
      let done = false;
      return (cost) => {
        if (done) return;
        done = true;
        held = Math.max(0, held - usd);
        out -= 1;
        // Nothing is out: nothing is held, whatever the sums' rounding left.
        if (out === 0) held = 0;
        if (cost > 0) ledger.addDaySpend(dayOf(deps.now()), cost);
      };
    },
    held: () => held,
    inFlight: () => out,
  };
}
