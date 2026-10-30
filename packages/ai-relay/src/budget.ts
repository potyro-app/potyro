// The whole service's money, shared by both routes (`/complete` and the chat route): a monthly cap
// and a daily one, each checked BEFORE dispatch, counting every request still out (docs/16 "AI for
// apps").
//
// A request about to go out is checked with what it could cost at most (prices.ts) on top of what
// was spent and what the requests in flight hold. If it fits it is held for that much until it
// settles; then the hold is let go and what it really cost (or, when OpenRouter did not say, the
// same estimate) is spent. So any number of requests at once cannot carry the service past a cap.
//
// The daily cap keeps one day from eating the month: by default an eighth of the month
// (`AI_DAY_USD`). The month's spend is written by the routes (ledger `debit`, `addSpend`), the day's
// here; both are in the ledger, so a restart keeps them. What is held is in memory: a restart lets
// go of requests that died with it.

import { dayOf, memoryLedger, monthOf, type Ledger } from "./ledger.ts";

export type CapReason = "service-month" | "service-day";

export interface Budget {
  readonly monthlyUsd: number;
  readonly dayUsd: number;
  /** The cap `usd` more would cross, counting what is held; null when it fits. */
  over(usd: number): CapReason | null;
  /** Holds `usd` while a request is out. The release, called once, lets it go and spends `costUsd` today. */
  hold(usd: number): (costUsd: number) => void;
  /** US dollars held by requests in flight. */
  held(): number;
}

export interface BudgetDeps {
  now: () => number;
  ledger?: Ledger;
  /** Default $10. */
  monthlyUsd?: number;
  /** Default an eighth of `monthlyUsd`. */
  dayUsd?: number;
}

export const DEFAULT_MONTHLY_USD = 10;
/** The daily cap, unless set, is the month's divided by this. */
export const DAY_SHARE = 8;

export function createBudget(deps: BudgetDeps): Budget {
  const ledger = deps.ledger ?? memoryLedger();
  const monthlyUsd = deps.monthlyUsd ?? DEFAULT_MONTHLY_USD;
  const dayUsd = deps.dayUsd ?? monthlyUsd / DAY_SHARE;
  let held = 0;
  return {
    monthlyUsd,
    dayUsd,
    over(usd) {
      const now = deps.now();
      if (ledger.spent(monthOf(now)) + held + usd > monthlyUsd) return "service-month";
      if (ledger.daySpent(dayOf(now)) + held + usd > dayUsd) return "service-day";
      return null;
    },
    hold(usd) {
      held += usd;
      let done = false;
      return (cost) => {
        if (done) return;
        done = true;
        held = Math.max(0, held - usd);
        if (cost > 0) ledger.addDaySpend(dayOf(deps.now()), cost);
      };
    },
    held: () => held,
  };
}
