// The AI service apps reach through `ctx.caps.ai` (docs/23) — the platform half, one per app.
//
// The host has already checked the app's shape, written the prompt and (for a sealed app) asked the
// person; it hands this one request. This decides who pays and sends it:
//
//   1. the free allowance — the relay next to the site (`/ai/`, docs/16), which holds Potyro's key;
//   2. then the person's own OpenRouter key from Model settings, when the allowance is used up or
//      the relay is not there (not deployed yet, or not answering);
//   3. neither: refused, in words the shell shows as the action's failure.
//
// It also resizes the pictures (a phone photo is ~4 MB; 1600 px reads a receipt as well), refuses at
// once when the device is offline, holds every request to a timeout, and guards the person's own key
// with a per-app rate and monthly cap before anything is sent. What the key was charged is added to
// the app's AI spend (ask-spend.ts), shown in Edit tile.

import { t } from "@lingui/core/macro";
import { AI_FORMAT, OPENROUTER_URL, openRouterBody, readOpenRouterReply, type AiPart, type AiPayload } from "@potyro/ai-relay";
import type { AiCall, AiCap, AiReply } from "@potyro/capabilities";
import { addSpend } from "./ask-spend.js";
import { aiStanding, setAiStanding } from "./ai-setting.js";
import { currentSite } from "./site.js";

/** Each way of paying gets this long, body included. */
export const AI_TIMEOUT_MS = 60_000;
/** A relay that is not there is not asked again for this long. */
const MISSING_FOR_MS = 10 * 60_000;
/** On the person's own key: at most this many requests a minute per app — an app's loop must not empty a wallet… */
export const OWN_KEY_PER_MINUTE = 20;
/** …and at most this much a calendar month per app, on this device. */
export const OWN_KEY_MONTHLY_USD = 1;
const MAX_EDGE = 1600;
const SENDABLE = /^image\/(jpeg|png|webp|gif)$/;

export interface AppAiDeps {
  appId: string;
  /** The person's own OpenRouter key, read at the moment of the request ("" = none). */
  ownKey: () => string;
  /** The random device id the relay counts the allowance by. */
  device: () => string;
  /** The free relay's `/complete`. */
  relay?: string;
  /** The person's own language, read at each request (they may switch it): what the model writes in. */
  language?: () => string;
  fetch?: typeof fetch;
  now?: () => number;
  online?: () => boolean;
  /** Make a picture small enough to send. The default draws it on a canvas; tests pass their own. */
  resize?: (b: Blob) => Promise<Blob>;
  timeoutMs?: number;
}

/** Where the free relay is: the build's own address for it, or next to the site. */
export function aiRelayEndpoint(): string {
  const configured = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_POTYRO_AI;
  const base = configured || `${currentSite()?.origin ?? ""}/ai`;
  return `${base.replace(/\/$/, "")}/complete`;
}

// ---------------------------------------------------------------- pictures

/** At most 1600 px on the long side, as JPEG — or the picture itself when it is already small and sendable. */
export async function resizeForAi(b: Blob): Promise<Blob> {
  const g = globalThis as unknown as { createImageBitmap?: (b: Blob) => Promise<ImageBitmap>; OffscreenCanvas?: new (w: number, h: number) => OffscreenCanvas; document?: Document };
  if (typeof g.createImageBitmap !== "function") return b;
  let bmp: ImageBitmap;
  try {
    bmp = await g.createImageBitmap(b);
  } catch {
    // Not something this browser can draw (HEIC on some): sent as it is when the model can read it.
    if (SENDABLE.test(b.type)) return b;
    throw new Error(t`This picture's format can't be read. Try a JPEG or PNG photo.`);
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  if (scale === 1 && b.size < 1_500_000 && SENDABLE.test(b.type)) {
    bmp.close();
    return b;
  }
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  try {
    if (g.OffscreenCanvas) {
      const c = new g.OffscreenCanvas(w, h);
      c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
      return await c.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    }
    const c = g.document!.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => c.toBlob((out) => (out ? resolve(out) : reject(new Error("resize failed"))), "image/jpeg", 0.85));
  } finally {
    bmp.close();
  }
}

async function dataUrl(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${b.type || "image/jpeg"};base64,${btoa(bin)}`;
}

// ---------------------------------------------------------------- the person's own key: guards

const recent = new Map<string, number[]>();
const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);
const MONTH_KEY = (appId: string): string => `potyro:ai-month:${appId}`;

function spentThisMonth(appId: string, now: number): number {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(MONTH_KEY(appId)) ?? "null") as { month?: string; usd?: number } | null;
    return v?.month === monthOf(now) && typeof v.usd === "number" ? v.usd : 0;
  } catch {
    return 0;
  }
}

function addThisMonth(appId: string, now: number, usd: number): void {
  try {
    globalThis.localStorage?.setItem(MONTH_KEY(appId), JSON.stringify({ month: monthOf(now), usd: spentThisMonth(appId, now) + usd }));
  } catch {
    // not remembered: the guard then counts from zero, which only errs on the person's own key
  }
}

function guardOwnKey(appId: string, now: number): void {
  const minute = (recent.get(appId) ?? []).filter((t0) => t0 > now - 60_000);
  if (minute.length >= OWN_KEY_PER_MINUTE) throw new Error(t`This app is asking the AI too often. Wait a minute and try again.`);
  if (spentThisMonth(appId, now) >= OWN_KEY_MONTHLY_USD) {
    throw new Error(t`This app has used $1 of your OpenRouter credit on AI this month, the most one app may. It can use AI again next month.`);
  }
  recent.set(appId, [...minute, now]);
}

/** Test seam: forget the per-minute counts. */
export function resetAiGuards(): void {
  recent.clear();
}

// ---------------------------------------------------------------- sending

type Tried = "free-ok" | "used-up" | "missing" | "failed";

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

const isAbort = (e: unknown): boolean => (e as { name?: string } | null)?.name === "AbortError";

let relayMissingUntil = 0;
/** When the free relay last answered as itself (a reply, or "used up"), and whether it still gave. */
let relaySeen: { at: number; gives: boolean } | null = null;
/** How long what the relay said is believed, for the consent question. */
const SEEN_FOR_MS = 10 * 60_000;
const HEALTH_MS = 3_000;

/** Test seam: forget everything about the relay. */
export function resetRelayMemory(): void {
  relayMissingUntil = 0;
  relaySeen = null;
  healthSeen.clear();
}

// ---------------------------------------------------------------- the relay's /health

/**
 * What the relay's `/health` says (#121). `ok`: a relay answered as itself. `chat`: its chat route,
 * the Studio's free engine, serves now. `model`: the model that route sends, which the Studio sends.
 */
export interface RelayHealth {
  ok: boolean;
  chat: boolean;
  model?: string;
  /** Where the plan is offered, once there is one (#118, #120): a page's address. Absent while there is none. */
  plan?: string;
  /**
   * No answer at all: offline, unreachable or too slow. Says nothing about the relay, so nothing is
   * decided on it (the Studio keeps a chosen Potyro engine), and it is believed for a minute only.
   */
  unknown?: true;
}

const NOT_THERE: RelayHealth = { ok: false, chat: false };
const NO_ANSWER: RelayHealth = { ok: false, chat: false, unknown: true };
/** How long "no answer" is believed: long enough not to ask on every look, short enough to recover. */
const NO_ANSWER_FOR_MS = 60_000;
/** Per `/health` address: what it said, and when. Believed for `SEEN_FOR_MS`, as `relaySeen` is. */
const healthSeen = new Map<string, { at: number; health: RelayHealth }>();

/** Ask `/health` again next time: what it said is out of date (the chat route just said it is paused). */
export function forgetRelayHealth(): void {
  healthSeen.clear();
}

/** Ask again next time where there was no answer: the browser is back online, or the person looked again. */
export function forgetNoAnswer(): void {
  for (const [url, seen] of healthSeen) if (seen.health.unknown) healthSeen.delete(url);
}

/** The relay's `/health`, from the `/complete` address beside it. */
export const healthUrl = (complete: string): string => complete.replace(/\/complete$/, "/health");

/**
 * A look at the relay's `/health` (no AI, nothing sent but the GET), remembered for ten minutes, so
 * the consent question and the Studio ask it once between them. A site with no relay answers with
 * its own page or a 404: not there. No answer (offline, a network failure, slower than `HEALTH_MS`)
 * is `unknown`, remembered for a minute, and not at all while offline.
 */
export async function relayHealth(opts: { url?: string; fetch?: typeof fetch; now?: () => number; online?: () => boolean } = {}): Promise<RelayHealth> {
  const url = opts.url ?? healthUrl(aiRelayEndpoint());
  const now = opts.now ?? Date.now;
  const known = healthSeen.get(url);
  if (known && now() - known.at < (known.health.unknown ? NO_ANSWER_FOR_MS : SEEN_FOR_MS)) return known.health;
  if (!(opts.online?.() ?? globalThis.navigator?.onLine !== false)) return NO_ANSWER;
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  let health = NO_ANSWER;
  try {
    health = await withTimeout(HEALTH_MS, async (signal) => {
      const res = await doFetch(url, { method: "GET", signal });
      const body = (await res.json().catch(() => null)) as { ok?: unknown; chat?: unknown; model?: unknown; plan?: unknown } | null;
      if (!res.ok || body?.ok !== true) return NOT_THERE;
      // Only a web address is ever shown as a link; anything else the relay says here is ignored.
      const plan = typeof body.plan === "string" && /^https:\/\/\S+$/.test(body.plan) ? body.plan : undefined;
      return { ok: true, chat: body.chat === true, ...(typeof body.model === "string" && body.model ? { model: body.model } : {}), ...(plan ? { plan } : {}) };
    });
  } catch {
    // unreachable or too slow: no answer, which is not "not there"
  }
  healthSeen.set(url, { at: now(), health });
  return health;
}

export function createAppAi(deps: AppAiDeps): AiCap {
  const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const now = deps.now ?? Date.now;
  const online = deps.online ?? (() => globalThis.navigator?.onLine !== false);
  const resize = deps.resize ?? resizeForAi;
  const timeoutMs = deps.timeoutMs ?? AI_TIMEOUT_MS;
  const relay = deps.relay ?? aiRelayEndpoint();

  const free = async (payload: AiPayload): Promise<{ tried: Tried; text?: string }> => {
    if (now() < relayMissingUntil) return { tried: "missing" };
    try {
      return await withTimeout(timeoutMs, async (signal) => {
        const res = await doFetch(relay, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal });
        const body = (await res.json().catch(() => null)) as { ok?: boolean; text?: unknown; error?: string } | null;
        // Not there: a site with no relay answers with its own page, or with a 404 / 405 of its own.
        if (body === null || typeof body !== "object" || res.status === 404 || res.status === 405) {
          markMissing();
          return { tried: "missing" as const };
        }
        if (res.ok && body.ok && typeof body.text === "string") {
          relaySeen = { at: now(), gives: true };
          return { tried: "free-ok" as const, text: body.text };
        }
        if (res.status === 429 && body.error === "allowance") {
          relaySeen = { at: now(), gives: false };
          return { tried: "used-up" as const };
        }
        return { tried: "failed" as const };
      });
    } catch (e) {
      // Unreachable or too slow: the person's own key is next; an unreachable relay is not asked again for a while.
      if (!isAbort(e)) markMissing();
      return { tried: isAbort(e) ? "failed" : "missing" };
    }
  };

  const markMissing = (): void => {
    relayMissingUntil = now() + MISSING_FOR_MS;
    relaySeen = { at: now(), gives: false };
  };

  /**
   * Would the free allowance pay right now? What the relay last said, when that was recent; else a
   * look at its `/health` (no AI, nothing sent). Only a relay that answered may be promised as free.
   */
  const freeNow = async (): Promise<boolean> => {
    if (relaySeen && now() - relaySeen.at < SEEN_FOR_MS) return relaySeen.gives;
    if (now() < relayMissingUntil || !online()) return false;
    const { ok } = await relayHealth({ url: healthUrl(relay), fetch: doFetch, now, online });
    if (ok) relaySeen = { at: now(), gives: true };
    else markMissing();
    return ok;
  };

  const ownKey = async (key: string, payload: AiPayload): Promise<AiReply> => {
    guardOwnKey(deps.appId, now());
    let status: number;
    let text: string;
    try {
      ({ status, text } = await withTimeout(timeoutMs, async (signal) => {
        const res = await doFetch(OPENROUTER_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://github.com/potyro-app/potyro", "X-Title": "Potyro" },
          body: JSON.stringify(openRouterBody(payload)),
          signal,
        });
        return { status: res.status, text: await res.text() };
      }));
    } catch (e) {
      if (isAbort(e)) throw new Error(t`The AI service took too long to answer. Try again.`);
      throw new Error(t`Couldn't reach the AI service. Check your connection and try again.`);
    }
    const reply = readOpenRouterReply(status, text);
    if (!reply.ok) {
      if (reply.status === 401 || reply.status === 403) throw new Error(t`Your OpenRouter key was refused. Check it in Model settings.`);
      if (reply.status === 402) throw new Error(t`Your OpenRouter account is out of credit.`);
      if (reply.status === 429) throw new Error(t`The AI service is busy. Try again in a minute.`);
      throw new Error(t`The AI service could not answer this time. Try again.`);
    }
    if (reply.cost) {
      addSpend(deps.appId, reply.cost, "ai");
      addThisMonth(deps.appId, now(), reply.cost);
    }
    return { text: reply.text, via: "own-key", ...(reply.cost === undefined ? {} : { cost: reply.cost }) };
  };

  return {
    service: "OpenRouter",
    get language() {
      return deps.language?.();
    },

    async complete(call: AiCall): Promise<AiReply> {
      if (aiStanding(deps.appId) === "off") throw new Error(t`AI is turned off for this app. Turn it on again in Edit tile.`);
      if (!online()) throw new Error(t`You're offline. AI needs the internet — try again when you're connected.`);
      const parts: AiPart[] = [];
      for (const p of call.parts) {
        if ("image" in p) parts.push({ type: "image", data: await dataUrl(await resize(p.image)) });
        else if ("audio" in p) parts.push({ type: "audio", data: await dataUrl(p.audio) });
        else parts.push({ type: "text", text: p.text });
      }
      const payload: AiPayload = { format: AI_FORMAT, device: deps.device(), system: call.system, parts, ...(call.json ? { json: call.json } : {}), maxTokens: call.maxTokens };

      const first = await free(payload);
      if (first.tried === "free-ok") return { text: first.text!, via: "free" };
      const key = deps.ownKey().trim();
      if (key) return ownKey(key, payload);
      if (first.tried === "used-up") throw new Error(t`This month's free AI is used up — add your own OpenRouter key in Model settings.`);
      if (first.tried === "failed") throw new Error(t`The free AI service didn't answer. Try again in a minute, or add your own OpenRouter key in Model settings.`);
      throw new Error(t`Free AI isn't available yet — add your own key in Model settings.`);
    },

    standing: () => aiStanding(deps.appId),
    allow: () => setAiStanding(deps.appId, "on"),

    // Says who would pay as things are now: free only when the relay has answered; else the person's
    // own key; else that it cannot run until they add one. Never a promise the device cannot keep.
    consentWords: async (appName, sends) => {
      const free = await freeNow();
      const hasKey = deps.ownKey().trim().length > 0;
      const what =
        sends === "photo"
          ? t`Only what the app sends goes: this photo and its question — nothing else in the app.`
          : t`Only what the app sends goes: this text and its question — nothing else in the app.`;
      const pays = free
        ? t`Free while this month's allowance lasts; then your own OpenRouter key, usually under 1¢.`
        : hasKey
          ? t`It uses your own OpenRouter key from Model settings, usually under 1¢ a request.`
          : t`AI isn't available until you add your own OpenRouter key in Model settings.`;
      return {
        message:
          sends === "photo"
            ? t({ message: `“${appName}” wants to send a photo to an AI service (OpenRouter) to read it.`, comment: "Asked before a shared app first uses AI on a picture" })
            : t({ message: `“${appName}” wants to send some text to an AI service (OpenRouter).`, comment: "Asked before a shared app first uses AI on words" }),
        detail: `${what} ${pays}`,
        ok: t({ message: "Allow", comment: "Button: let a shared app use AI" }),
        cancel: t({ message: "Not now", comment: "Button: refuse a shared app's AI request this time" }),
        // The question links the privacy page's AI section, when this build has the page (#117).
        privacy: "ai",
      };
    },
  };
}
