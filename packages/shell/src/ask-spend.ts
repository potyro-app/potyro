// What Ask has cost (#213). Every request runs on the person's own key, so each says what it cost —
// the model's calls and its checks, as OpenRouter reports them — and each app keeps a running total,
// per device, in localStorage (a convenience, not an account: another device has its own).

import { t } from "@lingui/core/macro";
import { fmt } from "@potyro/i18n";

const KEY = (appId: string): string => `potyro:ask-spent:${appId}`;

export function spentIn(appId: string): number {
  try {
    const v = Number(globalThis.localStorage?.getItem(KEY(appId)) ?? 0);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

export function addSpend(appId: string, usd: number | undefined): void {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return;
  try {
    globalThis.localStorage?.setItem(KEY(appId), String(spentIn(appId) + usd));
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
