import { msg } from "potyro";
// How the feed reads, in six languages (docs/20). Every language but English is a model's draft (#297).
// A post's text and a watched word are records: never translated.

import type { Ctx, Words } from "potyro";
import type { LiveState } from "./live.js";

export type Say = Pick<Ctx, "t" | "format">;
export type FeedState = LiveState | "demo" | "demo-done";

export const STATE_WORDS: Record<FeedState, Words> = {
  off: msg("Not live"),
  connecting: msg("Connecting…"),
  live: msg("Live"),
  retrying: msg("Connection lost — trying again"),
  paused: msg("Paused while you were away"),
  offline: msg("You're offline"),
  unreachable: msg("Can't reach Bluesky right now"),
  denied: msg("Not allowed to connect"),
  blocked: msg("This copy can't reach Bluesky"),
  demo: msg("Demo — made-up posts"),
  "demo-done": msg("Demo finished"),
};

export const STATE_HINTS: Record<FeedState, Words> = {
  off: msg("Add a few words under Words, then tap “Watch live” — or “Demo” to see how it looks."),
  connecting: msg("Opening the connection to Bluesky."),
  live: msg("Every new public post on Bluesky passes by; the ones with your words stay."),
  retrying: msg("It picks up again by itself."),
  paused: msg("It carries on as soon as you are back. Posts from while you were away are not caught up."),
  offline: msg("It connects again when you are back online."),
  unreachable: msg("Trying again, a little less often each time. The demo works without it."),
  denied: msg("Tap “Watch live” to be asked again."),
  blocked: msg("The demo still works."),
  demo: msg("Invented posts, played on this device. Nothing is sent anywhere."),
  "demo-done": msg("“Watch live” follows the real Bluesky; “Clear the demo” removes the sample posts."),
};

/** "just now", "4 min ago", "3 h ago". */
export function agoText(time: Date, now: Date, say: Say): string {
  const min = Math.max(0, Math.round((now.getTime() - time.getTime()) / 60_000));
  if (min < 1) return say.t("just now");
  if (min < 60) return say.t("{n} min ago", { n: min });
  const h = Math.round(min / 60);
  if (h < 48) return say.t("{n} h ago", { n: h });
  return say.format.date(time, { day: "numeric", month: "short" });
}

/** "12 a minute". */
export const perMinuteText = (n: number, say: Say): string =>
  say.t("{n} a minute", { n: say.format.number(n) });

/** "48 in the last hour". */
export const lastHourText = (n: number, say: Say): string =>
  say.t(
    "{n, plural, one {# in the last hour} other {# in the last hour}}",
    { n },
  );
