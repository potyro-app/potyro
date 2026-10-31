// The Studio's free engine, "Potyro" (#121, docs/23 "Who pays"): app making on Potyro's own key,
// through the relay's chat route (`/ai/v1/chat/completions`, packages/ai-relay/src/chat.ts), while
// this device's monthly allowance lasts.
//
// This module holds what the shell knows about that route, and nothing about the person:
//
//   - whether it serves: the relay's `/health` says `chat: true` (asked through app-ai.ts's probe, so
//     the Studio and an app's consent question share one look and its ten-minute memory);
//   - how much is left: the relay's `x-potyro-left-usd` on each answer, said in words, never in cents
//     (`leftWords`);
//   - why it stopped: a refusal's code (`{error: {code, type: "potyro"}}`), said as a sentence with
//     what to do next (`refusalText`). A month's or a day's "used up" is kept on this device until
//     that month or day is over, so the Studio shows its no-dead-end panel at once, rather than after
//     one more request that cannot go. Only a real "used up" is kept: an `allowance` refusal while
//     more than the relay's least hold is left means THIS request is too big for what is left, and a
//     shorter one may still go (`stopOf`).
//
// The engine itself is the ordinary chat engine (engines.ts `chatEngineOptions`) pointed at the relay,
// with this device's random id as its key; `freeFetch` reads the header and the refusals on the way.

import { useSyncExternalStore } from "react";
import { t } from "@lingui/core/macro";
import { aiRelayEndpoint, forgetNoAnswer, forgetRelayHealth, relayHealth, type RelayHealth } from "./app-ai.js";
import { deviceId } from "./device-id.js";

/** The model the chat route sends when its `/health` names none: the relay's own default (chat.ts CHAT_MODELS). */
export const FREE_DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";

/** Every code the chat route refuses with (`ChatErrorCode` in packages/ai-relay/src/chat.ts). */
export const FREE_CODES = [
  "allowance",
  "address-day",
  "service-day",
  "service-month",
  "plan",
  "model",
  "off",
  "device",
  "busy",
  "request",
  "too-big",
  "method",
  "upstream",
] as const;
export type FreeCode = (typeof FREE_CODES)[number];

/** The refusals after which free app making cannot go on today or this month: the Studio shows its panel. */
export type FreeStop = Extract<FreeCode, "allowance" | "address-day" | "service-day" | "service-month" | "off">;
const STOPS: readonly FreeCode[] = ["allowance", "address-day", "service-day", "service-month", "off"];
export const isStop = (code: FreeCode): code is FreeStop => STOPS.includes(code);

/**
 * How much is left, in words. The relay says it in US dollars; a person is told one of three things:
 *
 *   plenty    at least $0.10 left — several more apps (a new app on the free model is about 1–3¢)
 *   a little  under $0.10 — a few more
 *   used up   under $0.02 — the relay's least hold for a request (`AI_CHAT_RESERVE_USD`): none fits
 */
export type Left = "plenty" | "little" | "none";
export const PLENTY_USD = 0.1;
export const NONE_USD = 0.02;
export function leftOf(usd: number): Left {
  if (usd >= PLENTY_USD) return "plenty";
  if (usd >= NONE_USD) return "little";
  return "none";
}

export function leftWords(left: Left): string {
  if (left === "plenty") return t({ message: "plenty left this month", comment: "The free engine: how much of this month's free app making is left" });
  if (left === "little") return t({ message: "a little left this month", comment: "The free engine: how much of this month's free app making is left" });
  return t({ message: "used up this month", comment: "The free engine: this month's free app making is used up" });
}

/**
 * What a person is told for each refusal, with what to do next. Always the shell's own sentence, in
 * the person's language: the relay's `message` is English, for a developer reading the wire.
 */
export function refusalText(code: FreeCode): string {
  switch (code) {
    case "allowance":
      return t`This month's free app making is used up on this device. Add your own key to keep going, or start from an app in the gallery.`;
    case "service-month":
      return t`Free app making is used up for everyone this month. Add your own key to keep going.`;
    case "service-day":
      return t`Free app making is used up for today. It's back tomorrow, or add your own key.`;
    case "address-day":
      return t`Free app making is busy on this network today. It's back tomorrow, or add your own key.`;
    case "off":
      return t`Free app making is paused right now. Add your own key, or try again later.`;
    case "busy":
      return t`This device already has a request going. Wait for it to finish, then try again.`;
    case "plan":
      return t`Web search isn't part of free app making. Turn web search off, or add your own key.`;
    case "too-big":
      return t`This conversation is too long for free app making. Start a new app, or add your own key.`;
    case "upstream":
      return t`Free app making couldn't reach the model just now. Try again in a minute.`;
    case "model":
    case "device":
    case "request":
    case "method":
      return t`Free app making couldn't take this request. Reload Potyro and try again.`;
  }
}

/** An `allowance` refusal with more than the least hold left: this request does not fit, a shorter one may. */
export const tooLongForWhatIsLeft = (): string => t`This conversation is too long for the free allowance. Start a new app, or add your own key.`;

/** `/health` gave no answer (offline, unreachable, too slow): nothing is known about free app making. */
export const freeUnreachable = (): string =>
  t`Free app making can't be reached right now. Check your connection and try again, or add your own key.`;

/** Why the free engine cannot run now, for a surface outside the Studio (Ask, Fix this). */
export function freeNotNow(): string {
  const stopped = stoppedNow();
  if (stopped) return refusalText(stopped.code);
  if (getFreeAi().health?.unknown) return freeUnreachable();
  return t`Free app making isn't available right now. Add your own key in the Studio’s Model settings.`;
}

/** A refusal from the chat route, thrown out of the engine's fetch: `message` is already the person's words. */
export class FreeAiRefusal extends Error {
  constructor(
    readonly code: FreeCode,
    message: string,
  ) {
    super(message);
    this.name = "FreeAiRefusal";
  }
}

export const freeRefusal = (e: unknown): FreeAiRefusal | null => (e instanceof FreeAiRefusal ? e : null);

// ---------------------------------------------------------------- state

interface Stopped {
  code: FreeStop;
  /** The month (`2026-10`) or day (`2026-10-30`, UTC) it lasts; "" for this page only. */
  until: string;
}

export interface FreeAi {
  /** null: not asked yet. */
  health: RelayHealth | null;
  /** What the relay last said was left, in words; null before the first answer. */
  left: Left | null;
  stopped: Stopped | null;
}

const STOP_KEY = "potyro:free-ai-stop";
const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
let clock: () => number = Date.now;

function storedStop(): Stopped | null {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(STOP_KEY) ?? "null") as Stopped | null;
    if (!v || typeof v.until !== "string" || !STOPS.includes(v.code)) return null;
    const now = clock();
    return v.until === monthOf(now) || v.until === dayOf(now) ? v : null;
  } catch {
    return null;
  }
}

let state: FreeAi = { health: null, left: null, stopped: storedStop() };
const listeners = new Set<() => void>();
function set(patch: Partial<FreeAi>): void {
  state = { ...state, ...patch };
  for (const cb of listeners) cb();
}

export function getFreeAi(): FreeAi {
  return state;
}

/** What stops free app making now: a stop for yesterday, or last month, is over. */
export function stoppedNow(s: FreeAi = getFreeAi()): Stopped | null {
  const until = s.stopped?.until;
  if (until && until !== monthOf(clock()) && until !== dayOf(clock())) return null;
  return s.stopped;
}

/** Hear every change to what the relay said. */
export function subscribeFreeAi(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useFreeAi(): FreeAi {
  return useSyncExternalStore(subscribeFreeAi, getFreeAi, getFreeAi);
}

/** The chat route serves, as far as `/health` said. */
export const freeOffered = (s: FreeAi = getFreeAi()): boolean => Boolean(s.health?.ok && s.health.chat);
/** It serves and nothing has stopped it for this device. */
export const freeWorks = (s: FreeAi = getFreeAi()): boolean => freeOffered(s) && !stoppedNow(s) && s.left !== "none";

/** Ask the relay's `/health` (or its memory: ten minutes for an answer, a minute for none) whether the chat route serves. */
export async function checkFreeAi(
  opts: Parameters<typeof relayHealth>[0] & { again?: boolean } = {},
  /** Called with what is about to be said, before anyone hears it: the engine store picks the engine first. */
  before?: (next: FreeAi) => void,
): Promise<FreeAi> {
  // Looking again (back online, Model settings opened): a "no answer" is not believed any longer.
  if (opts.again) forgetNoAnswer();
  const health = await relayHealth(opts);
  // A stop that is over, or a pause the relay no longer reports, goes.
  const over = state.stopped && (!stoppedNow(state) || (state.stopped.code === "off" && health.chat));
  const patch: Partial<FreeAi> = { health, ...(over ? { stopped: null } : {}) };
  before?.({ ...state, ...patch });
  set(patch);
  return getFreeAi();
}

function stop(code: FreeStop): void {
  const now = clock();
  // The device's month and the service's month last the month; a day's (the service's, this
  // network's), the day; "off" this page only.
  const until = code === "allowance" || code === "service-month" ? monthOf(now) : code === "off" ? "" : dayOf(now);
  const stopped: Stopped = { code, until };
  if (until) {
    try {
      globalThis.localStorage?.setItem(STOP_KEY, JSON.stringify(stopped));
    } catch {
      // not kept: the next request finds out again, which costs nothing
    }
  }
  // Paused: what `/health` said is out of date, and is asked again at the next look.
  if (code === "off") forgetRelayHealth();
  set({ stopped, ...(code === "allowance" ? { left: "none" as const } : {}) });
}

/** Read what this device kept again, as a new page does. */
export function reloadFreeAi(): void {
  state = { health: null, left: null, stopped: storedStop() };
  for (const cb of listeners) cb();
}

/** Test seam: forget what the relay said. */
export function resetFreeAi(now: () => number = Date.now): void {
  clock = now;
  try {
    globalThis.localStorage?.removeItem(STOP_KEY);
  } catch {
    // nothing kept
  }
  state = { health: null, left: null, stopped: null };
  for (const cb of listeners) cb();
}

// ---------------------------------------------------------------- the engine's wire

/** The chat route's base, for the engine: `{site}/ai/v1`. */
export function freeBaseUrl(): string {
  return `${aiRelayEndpoint().replace(/\/complete$/, "")}/v1`;
}

/** The engine's key: this device's random id, which is what the relay counts the allowance by. */
export const freeKey = (): string => `potyro-device:${deviceId()}`;

/** The model to send: the one the relay named, else its default. */
export const freeModel = (): string => getFreeAi().health?.model ?? FREE_DEFAULT_MODEL;

const isCode = (v: unknown): v is FreeCode => typeof v === "string" && (FREE_CODES as readonly string[]).includes(v);

/**
 * The engine's fetch: the request as it is; on the way back, what is left, and a refusal turned into
 * a `FreeAiRefusal` carrying the person's words (the generator rethrows a fetch's error as it is).
 */
export function freeFetch(inner: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => globalThis.fetch(u, i)) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const res = await inner(url, init);
    const header = res.headers.get("x-potyro-left-usd");
    const usd = header === null || header.trim() === "" ? NaN : Number(header);
    // On an answer, what was left before it; on a refusal, what is left now (0 when used up).
    if (Number.isFinite(usd) && res.ok) set({ left: leftOf(usd) });
    if (res.ok) {
      if (state.stopped) set({ stopped: null });
      return res;
    }
    const body = (await res
      .clone()
      .json()
      .catch(() => null)) as { error?: { code?: unknown; message?: unknown; type?: unknown } } | null;
    const error = body?.error;
    if (error?.type !== "potyro" || !isCode(error.code)) return res;
    if (error.code === "allowance" && !(usd < NONE_USD)) {
      // More than the least hold is left (or the relay did not say): this request is too big for it,
      // a shorter one may still go. Nothing is kept; what is left is as the relay says.
      if (Number.isFinite(usd)) set({ left: leftOf(usd) });
      throw new FreeAiRefusal(error.code, tooLongForWhatIsLeft());
    }
    if (isStop(error.code)) stop(error.code);
    throw new FreeAiRefusal(error.code, refusalText(error.code));
  };
}
