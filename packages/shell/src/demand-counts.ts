// Demand, counted and nothing else (#118, docs/23 "Counts"): how many devices brought their own key,
// and how many asked to hear about a paid plan. The relay keeps each as one number a month
// (packages/ai-relay/src/counts.ts); it never learns which device, or who.
//
//   own-key    the first time a key is typed into Model settings, this month
//   want-plan  "Tell me when there is a paid plan", pressed, this month
//   exhausted  NOT sent from here: the relay counts it itself when a device uses up its month
//
// Each goes at most once a calendar month per device, which a flag in localStorage holds
// (`potyro:counted:<event>:<month>` — the event and the month, nothing else). The request is
// `{"event": "<name>"}` and a content type: no device id, no cookies, no referrer, nothing about the
// app or the person. It goes only to a relay that answered `/health` as itself, so a site without
// one is never sent anything.
//
// Off in You ("Send anonymous counts"): then nothing is sent, from anywhere.

import { aiRelayEndpoint, relayHealth } from "./app-ai.js";

export type ShellCount = "own-key" | "want-plan";

const OFF = "potyro:counts-off";
const SENT = (event: ShellCount, month: string): string => `potyro:counted:${event}:${month}`;
const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

/** Are counts sent from this device? On unless the person turned them off. */
export function countsOn(): boolean {
  try {
    return globalThis.localStorage?.getItem(OFF) !== "1";
  } catch {
    return false;
  }
}

export function setCountsOn(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.removeItem(OFF);
    else globalThis.localStorage?.setItem(OFF, "1");
  } catch {
    // not kept
  }
}

/** Was this counted from here this month? */
export function countedThisMonth(event: ShellCount, now: number = Date.now()): boolean {
  try {
    return globalThis.localStorage?.getItem(SENT(event, monthOf(now))) === "1";
  } catch {
    return false;
  }
}

/** The relay's `/count`, beside its `/complete`. */
export const countUrl = (): string => aiRelayEndpoint().replace(/\/complete$/, "/count");

export type CountOutcome = "sent" | "already" | "off" | "no-relay" | "failed";

const going = new Set<string>();

export interface CountDeps {
  fetch?: typeof fetch;
  now?: () => number;
  /** Is a relay there to count? Default: its `/health` (app-ai.ts), remembered ten minutes. */
  relayThere?: () => Promise<boolean>;
}

/** Count this event once this month, if counts are on and a relay is there to count it. */
export async function countOnce(event: ShellCount, deps: CountDeps = {}): Promise<CountOutcome> {
  if (!countsOn()) return "off";
  const now = (deps.now ?? Date.now)();
  const flag = SENT(event, monthOf(now));
  if (countedThisMonth(event, now) || going.has(flag)) return "already";
  going.add(flag);
  try {
    const there = deps.relayThere ? await deps.relayThere() : (await relayHealth()).ok;
    if (!there) return "no-relay";
    // Read again: the switch may have been turned off while the relay was looked at.
    if (!countsOn()) return "off";
    const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
    try {
      await doFetch(countUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event }),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      });
    } catch {
      // Not reached: tried again the next time it happens.
      return "failed";
    }
    // Any answer is the relay's: a repeat or a busy address is not worth sending again this month.
    try {
      globalThis.localStorage?.setItem(flag, "1");
    } catch {
      // not kept: it may go once more, and the relay's per-address check sets it aside
    }
    return "sent";
  } finally {
    going.delete(flag);
  }
}
