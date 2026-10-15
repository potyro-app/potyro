// Sending a request to the Potyro team (#263) — the Studio's half.
//
// When the agent finds that what the person asked for needs something Potyro itself does not offer,
// it writes a request in the person's words; the Studio shows it on a card and offers to send it.
// Nothing is sent until the person has seen exactly what goes and tapped Send. What goes is the
// request, the app's STRUCTURE — its declaration as data, every function and piece of code shown as
// a marker — its name and the request's language. Never its records: they are not in the source.
//
// It goes to the relay next to the site (`/requests/`, docs/16), which files it as a GitHub issue,
// since people have no GitHub account. Until that relay is deployed — or whenever it cannot be
// reached — the request is kept on this device and sent later (`sendSaved`, from the Studio).
//
// The later "Potyro can do this now" notice is #288's: a sent request is recorded in the app's
// conversation with its id and the issue's address (`SentRequest` in studio-chat.ts), which is what
// that notice will look for.

import { t } from "@lingui/core/macro";
import { REQUEST_FORMAT, type PlatformRequestPayload } from "@potyro/platform-requests";
import { appStructure } from "@potyro/generator/agent";
import type { PlatformAsk } from "./studio-chat.js";
import { deviceId, randomId } from "./device-id.js";
import { currentSite } from "./site.js";

export type { PlatformAsk };

/** What came of sending: filed (`url` is the issue), kept to send later, or refused as malformed. */
export type SendResult = { state: "sent"; url?: string } | { state: "saved" } | { state: "refused" };

const OUTBOX = "potyro:platform-requests:outbox";
/** Kept at most: a device that never reaches the relay does not fill its storage with requests. */
const MAX_SAVED = 20;

interface Saved {
  chatId: string;
  payload: PlatformRequestPayload;
}

export function newRequestId(): string {
  return `req-${randomId()}`;
}

/** A random id for this device, kept: the relay's rate limit counts per device. Says nothing about the person. */
export { deviceId };

/** Where requests go: the build's own address for them, or the relay next to the site. */
export function requestsEndpoint(): string {
  const configured = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_POTYRO_REQUESTS;
  const base = configured || `${currentSite()?.origin ?? ""}/requests`;
  return `${base.replace(/\/$/, "")}/platform-requests`;
}

/** The request exactly as it will be sent — what the review shows, word for word. */
export async function buildRequest(ask: PlatformAsk, opts: { source: string; app?: string; language: string }): Promise<PlatformRequestPayload> {
  return {
    format: REQUEST_FORMAT,
    id: ask.id,
    device: deviceId(),
    title: ask.title,
    body: ask.body,
    structure: await appStructure(opts.source),
    ...(opts.app ? { app: opts.app } : {}),
    language: opts.language,
  };
}

export function savedRequests(): Saved[] {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(OUTBOX) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as Saved[]).filter((s) => s && typeof s.chatId === "string" && s.payload?.format === REQUEST_FORMAT) : [];
  } catch {
    return [];
  }
}

function keepSaved(list: readonly Saved[]): void {
  try {
    globalThis.localStorage?.setItem(OUTBOX, JSON.stringify(list.slice(-MAX_SAVED)));
  } catch {
    // Storage full or blocked: the card still says it could not be sent.
  }
}

/** One attempt. Null: not reached — no answer, or an answer that is not the relay's. */
async function attempt(payload: PlatformRequestPayload, get: typeof fetch): Promise<SendResult | null> {
  let res: Response;
  try {
    res = await get(requestsEndpoint(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } catch {
    return null;
  }
  // A site whose proxy does not know the route yet answers with its own page: not the relay.
  let body: { ok?: unknown; url?: unknown } | null = null;
  try {
    body = (await res.json()) as { ok?: unknown; url?: unknown };
  } catch {
    return null;
  }
  if (res.ok && body?.ok === true) return { state: "sent", ...(typeof body.url === "string" ? { url: body.url } : {}) };
  if (res.status === 400 || res.status === 413) return { state: "refused" };
  return null;
}

/** Send it; when that cannot be done now, keep it on this device to send later. */
export async function sendPlatformRequest(payload: PlatformRequestPayload, chatId: string, opts: { fetch?: typeof fetch } = {}): Promise<SendResult> {
  const result = await attempt(payload, opts.fetch ?? fetch);
  const others = savedRequests().filter((s) => s.payload.id !== payload.id);
  if (result) {
    keepSaved(others);
    return result;
  }
  keepSaved([...others, { chatId, payload }]);
  return { state: "saved" };
}

/**
 * Try the ones kept for later. `onSent` hears each that went, so its conversation can say so. `only`
 * picks which this caller sends: the Studio its platform requests (each has a conversation), You →
 * Language its wording suggestions (#300, none has); the rest wait for their own caller.
 */
export function sendSaved(
  onSent: (chatId: string, payload: PlatformRequestPayload, url?: string) => void | Promise<void>,
  opts: { fetch?: typeof fetch; only?: (payload: PlatformRequestPayload) => boolean } = {},
): Promise<void> {
  // One run at a time, each reading the outbox afresh: two at once (the Studio and You opening
  // together, or React running an effect twice) would both send what the other is sending.
  const run = flushing.then(() => flush(onSent, opts));
  flushing = run.catch(() => {});
  return run;
}

let flushing: Promise<void> = Promise.resolve();

async function flush(
  onSent: (chatId: string, payload: PlatformRequestPayload, url?: string) => void | Promise<void>,
  opts: { fetch?: typeof fetch; only?: (payload: PlatformRequestPayload) => boolean },
): Promise<void> {
  const get = opts.fetch ?? fetch;
  const left: Saved[] = [];
  for (const s of savedRequests()) {
    if (opts.only && !opts.only(s.payload)) {
      left.push(s);
      continue;
    }
    const result = await attempt(s.payload, get);
    if (result?.state === "sent") await onSent(s.chatId, s.payload, result.url);
    else if (result?.state !== "refused") left.push(s);
  }
  keepSaved(left);
}

/** The line the conversation keeps about it, in the person's language. */
export function sentLine(title: string, result: SendResult): string {
  if (result.state === "sent") return t`Sent to the Potyro team: “${title}”`;
  if (result.state === "saved") return t`Couldn't send “${title}” to the Potyro team yet. It's saved on this device and will be sent later.`;
  return t`The Potyro team's inbox didn't accept “${title}”.`;
}
