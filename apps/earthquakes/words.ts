import { msg } from "potyro";
// How the feed and a quake read, in six languages (docs/20). Every language but English is a model's
// draft (#297). A place name comes from EMSC in English and is a record: it is never translated.

import type { Ctx, Words } from "potyro";
import type { LiveState } from "./live.js";
import type { Strength } from "./quakes.js";

export type Say = Pick<Ctx, "t" | "format">;

export const STRENGTH_WORDS: Record<Strength, Words> = {
  minor: msg("Minor"),
  light: msg("Light"),
  moderate: msg("Moderate"),
  strong: msg("Strong"),
  major: msg("Major"),
};

/** The status line's first words, by state. */
export const STATE_WORDS: Record<LiveState | "demo" | "demo-done", Words> = {
  off: msg("Not live"),
  connecting: msg("Connecting…"),
  live: msg("Live"),
  retrying: msg("Connection lost — trying again"),
  paused: msg("Paused while you were away"),
  offline: msg("You're offline"),
  unreachable: msg("Can't reach EMSC right now"),
  denied: msg("Not allowed to connect"),
  blocked: msg("This copy can't reach EMSC"),
  demo: msg("Demo — a replay"),
  "demo-done": msg("Demo finished"),
};

/** What to do about each state, under the status line. */
export const STATE_HINTS: Record<LiveState | "demo" | "demo-done", Words> = {
  off: msg("Tap “Watch live” to follow new earthquakes as EMSC reports them — or “Demo” to see how it looks."),
  connecting: msg("Opening the connection to EMSC."),
  live: msg("New earthquakes appear the moment EMSC reports them."),
  retrying: msg("It picks up again by itself."),
  paused: msg("It carries on as soon as you are back."),
  offline: msg("It connects again when you are back online. What you already have stays here."),
  unreachable: msg("Trying again, a little less often each time. The demo works without it."),
  denied: msg("Tap “Watch live” to be asked again."),
  blocked: msg("The demo still works."),
  demo: msg("Real earthquakes from earlier, replayed on this device. Nothing is sent anywhere."),
  "demo-done": msg("“Watch live” follows the real feed; “Clear the demo” removes the sample quakes."),
};

const MAG = msg("M{mag}");

/** "M4.7" in the person's own decimal mark. */
export const magText = (mag: number, say: Say): string => say.t(MAG, { mag: say.format.number(mag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });

/** "10 km deep". */
export const depthText = (km: number, say: Say): string =>
  say.t("{km} km deep", { km: say.format.number(Math.round(km)) });

/** "just now", "4 min ago", "3 h ago", "2 days ago" — from `now`. */
export function agoText(time: Date, now: Date, say: Say): string {
  const min = Math.max(0, Math.round((now.getTime() - time.getTime()) / 60_000));
  if (min < 1) return say.t("just now");
  if (min < 60) return say.t("{n} min ago", { n: min });
  const h = Math.round(min / 60);
  if (h < 48) return say.t("{n} h ago", { n: h });
  return say.t(
    "{n, plural, one {# day ago} other {# days ago}}",
    { n: Math.round(h / 24) },
  );
}

/** "1,240 km away". */
export const awayText = (km: number, say: Say): string =>
  say.t("{km} km away", { km: say.format.number(Math.round(km)) });

/** The alert's title: "M5.2 earthquake 120 km away". */
export const alertTitle = (mag: number, km: number, say: Say): string =>
  say.t("{mag} earthquake {away}", { mag: magText(mag, say), away: awayText(km, say) });
