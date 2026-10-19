import { msg } from "potyro";
// How a price, a change and the feed read, in six languages (docs/20). Every language but English is
// a model's draft (#297). Symbols ("BTC-USD") are codes and stay as they are.

import type { Ctx, Words } from "potyro";
import type { LiveState } from "./live.js";
import { quoteOf } from "./prices.js";

export type Say = Pick<Ctx, "t" | "format">;
export type FeedState = LiveState | "demo" | "demo-done";

export const STATE_WORDS: Record<FeedState, Words> = {
  off: msg("Not live"),
  connecting: msg("Connecting…"),
  live: msg("Live"),
  retrying: msg("Connection lost — trying again"),
  paused: msg("Paused while you were away"),
  offline: msg("You're offline"),
  unreachable: msg("Can't reach the prices right now"),
  denied: msg("Not allowed to connect"),
  blocked: msg("This copy can't reach Coinbase"),
  demo: msg("Demo — made-up prices"),
  "demo-done": msg("Demo finished"),
};

const ECB = msg("Currencies: the ECB's reference rates, which change once a working day — fetched every 30 minutes.");

export const STATE_HINTS: Record<FeedState, Words> = {
  off: msg("Tap “Watch live” for live prices — or “Demo” to see how it looks. Add symbols with “Add”."),
  connecting: msg("Opening the connection to Coinbase."),
  live: msg("Crypto: every trade on Coinbase, shown at most every 3 seconds. "),
  retrying: msg("It picks up again by itself."),
  paused: msg("It carries on as soon as you are back."),
  offline: msg("It connects again when you are back online. The last prices stay here."),
  unreachable: msg("Trying again, a little less often each time. The demo works without it."),
  denied: msg("Tap “Watch live” to be asked again."),
  blocked: msg("The demo still works."),
  demo: msg("A made-up market on this device, ticking several times a second. Nothing is sent anywhere."),
  "demo-done": msg("“Watch live” shows real prices; “Clear the demo” removes the made-up ones."),
};

export const ECB_NOTE = ECB;

/** A price in its own currency: "$82,275.79", "5.6679 R$"; a currency pair's rate to four places. */
export function priceText(price: number, code: string, say: Say): string {
  if (code.includes("/")) return say.format.number(price, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  // Money in its currency to the cent; under one unit (a XRP, a DOGE) the cents say nothing, so four places.
  if (price >= 1) return say.format.money(Math.round(price * 100), quoteOf(code));
  return `${say.format.number(price, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ${quoteOf(code)}`;
}

/** "▲ 0.67%", "▼ 1.20%", "— 0.00%". */
export function changeText(change: number | null | undefined, say: Say): string {
  if (typeof change !== "number") return "";
  const arrow = change > 0.004 ? "▲" : change < -0.004 ? "▼" : "—";
  return `${arrow} ${say.format.number(Math.abs(change) / 100, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "BTC-USD went above $90,000.00". */
export const alertText = (code: string, dir: "above" | "below", level: number, say: Say): string =>
  dir === "above"
    ? say.t("{code} went above {level}", { code, level: priceText(level, code, say) })
    : say.t("{code} dropped below {level}", { code, level: priceText(level, code, say) });

/** "2 s ago", "4 min ago", "15 Oct". */
export function agoText(time: Date, now: Date, say: Say): string {
  const s = Math.max(0, Math.round((now.getTime() - time.getTime()) / 1000));
  if (s < 5) return say.t("just now");
  if (s < 60) return say.t("{n} s ago", { n: s });
  if (s < 3600) return say.t("{n} min ago", { n: Math.round(s / 60) });
  if (s < 86_400) return say.t("{n} h ago", { n: Math.round(s / 3600) });
  return say.format.date(time, { day: "numeric", month: "short" });
}
