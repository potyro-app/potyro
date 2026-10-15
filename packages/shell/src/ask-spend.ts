// What AI has cost (#213, docs/23). Ask and an app's own AI (`ctx.caps.ai`) run on the person's own
// key when they pay at all, so each request says what it cost — as OpenRouter reports it — and each
// app keeps a running total per kind, per device, in localStorage (a convenience, not an account:
// another device has its own). The two kinds are kept apart: "Ask has used…" must not count what
// the app's own button spent.

import { t } from "@lingui/core/macro";
import { fmt } from "@potyro/i18n";

/** Ask's (`ask`) or the app's own AI's (`ai`). */
export type SpendKind = "ask" | "ai";

const KEY = (appId: string, kind: SpendKind): string => `potyro:${kind}-spent:${appId}`;

export function spentIn(appId: string, kind: SpendKind = "ask"): number {
  try {
    const v = Number(globalThis.localStorage?.getItem(KEY(appId, kind)) ?? 0);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

export function addSpend(appId: string, usd: number | undefined, kind: SpendKind = "ask"): void {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return;
  try {
    globalThis.localStorage?.setItem(KEY(appId, kind), String(spentIn(appId, kind) + usd));
  } catch {
    // not remembered; the request still said what it cost
  }
}

/** "under 1¢", "2.1¢", "35¢", "$1.23" — numbers in the person's language; OpenRouter bills in US dollars. */
export function formatSpend(usd: number): string {
  if (usd < 0.01) return t({ message: "under 1¢", comment: "Ask's cost: less than one US cent" });
  if (usd < 1) {
    const cents = fmt.number(usd * 100, usd < 0.1 ? { minimumFractionDigits: 1, maximumFractionDigits: 1 } : { maximumFractionDigits: 0 });
    return t({ message: `${cents}¢`, comment: "Ask's cost in US cents, e.g. 2.1¢" });
  }
  return fmt.number(usd, { style: "currency", currency: "USD" });
}
