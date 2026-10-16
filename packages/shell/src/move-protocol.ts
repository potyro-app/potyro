// The hand-over between an old Potyro site and its new home, as messages between two windows
// (docs/16 §Moving to a new home). No server sees any of it: the old site opens the new one, and
// the two talk with `postMessage`.
//
//   old                                        new (opened at `/?move=<channel>`)
//    │  window.open(new/?move=<channel>)  ─────▶
//    │  ◀──── hello                          (content-free; the opener already knows the channel)
//    │  offer: manifest + digest  ──────────▶  shown to the person; nothing is taken yet
//    │  ◀──── send                           only after they press "Bring them in"
//    │  archive  ───────────────────────────▶  accepted only now, only if its digest is the offer's
//    │  ◀──── done | failed
//
// Each side accepts a message only from the window it is talking to (`source`), only from a Potyro
// origin (move-origins.ts), and only for its channel — a random id made fresh for each hand-over.
// The new site pins the first origin that offers and hears no other from then on. Nothing travels in
// a URL but the channel.
//
// Pure: the decisions are functions of the message and the state, so they are tested without windows
// (test/move-protocol.test.ts); move-page.tsx and move-banner.tsx do the posting.

import { isPotyroOrigin, type OriginEnv } from "./move-origins.js";
import { readOffer, type MoveOffer } from "./move-archive.js";

export const MOVE_MESSAGE = "potyro-move";
export const MOVE_VERSION = 1;

/** A fresh channel: 128 random bits, hex. */
export function newChannel(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const isChannel = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{32}$/.test(v);

/** What the moved apps came to, as the new site reports it back. */
export interface MoveResult {
  apps: number;
  records: number;
  files: number;
}

export type MoveMessage =
  | { step: "hello" }
  | { step: "offer"; offer: MoveOffer; digest: string; size: number }
  | { step: "send" }
  | { step: "archive"; bytes: ArrayBuffer; digest: string }
  | { step: "done"; result: MoveResult }
  | { step: "failed"; reason: string };

type Envelope = MoveMessage & { type: typeof MOVE_MESSAGE; v: typeof MOVE_VERSION; channel: string };

export function envelope(channel: string, message: MoveMessage): Envelope {
  return { type: MOVE_MESSAGE, v: MOVE_VERSION, channel, ...message };
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);

/** The message inside `data`, for `channel`, or null when it is not one of ours. Pure. */
export function readMessage(data: unknown, channel: string): MoveMessage | null {
  if (!isObject(data) || data.type !== MOVE_MESSAGE || data.v !== MOVE_VERSION || data.channel !== channel) return null;
  switch (data.step) {
    case "hello":
    case "send":
      return { step: data.step };
    case "offer": {
      const offer = readOffer(data.offer);
      if (!offer || typeof data.digest !== "string" || !/^[0-9a-f]{64}$/.test(data.digest)) return null;
      return { step: "offer", offer, digest: data.digest, size: count(data.size) };
    }
    case "archive":
      if (!(data.bytes instanceof ArrayBuffer) || typeof data.digest !== "string") return null;
      return { step: "archive", bytes: data.bytes, digest: data.digest };
    case "done":
      if (!isObject(data.result)) return null;
      return { step: "done", result: { apps: count(data.result.apps), records: count(data.result.records), files: count(data.result.files) } };
    case "failed":
      return { step: "failed", reason: typeof data.reason === "string" ? data.reason.slice(0, 500) : "" };
    default:
      return null;
  }
}

/** Where the new site's side of the hand-over is. */
export type ReceiverPhase = "waiting" | "offered" | "confirmed" | "importing" | "done" | "failed";

export interface ReceiverState {
  phase: ReceiverPhase;
  channel: string;
  /** The origin that offered first. No other is heard from then on. */
  peer?: string;
  offer?: MoveOffer;
  digest?: string;
}

/** A message as the receiving page sees it. */
export interface Incoming {
  origin: string;
  /** Did it come from `window.opener` — the window that opened this one? */
  fromOpener: boolean;
  data: unknown;
}

export type ReceiverDecision =
  | { accept: false; reason: "not-ours" | "not-opener" | "not-potyro" | "own-origin" | "other-peer" | "out-of-turn" }
  | { accept: true; message: MoveMessage; state: ReceiverState };

/**
 * Should the new site take this message, and where does that leave it? Pure.
 *
 * Only an offer is taken before the person confirms — and an offer is a description, shown to them,
 * with nothing written. The archive is taken only once they have pressed "Bring them in", only from
 * the origin that made the offer, and only if it is the archive that was offered.
 */
export function receive(state: ReceiverState, ev: Incoming, here: string, env: OriginEnv): ReceiverDecision {
  const message = readMessage(ev.data, state.channel);
  if (!message) return { accept: false, reason: "not-ours" };
  if (!ev.fromOpener) return { accept: false, reason: "not-opener" };
  if (!isPotyroOrigin(ev.origin, env)) return { accept: false, reason: "not-potyro" };
  if (ev.origin === here) return { accept: false, reason: "own-origin" };
  if (state.peer && ev.origin !== state.peer) return { accept: false, reason: "other-peer" };

  if (message.step === "offer" && state.phase === "waiting") {
    return { accept: true, message, state: { ...state, phase: "offered", peer: ev.origin, offer: message.offer, digest: message.digest } };
  }
  if (message.step === "archive" && state.phase === "confirmed" && message.digest === state.digest) {
    return { accept: true, message, state: { ...state, phase: "importing" } };
  }
  return { accept: false, reason: "out-of-turn" };
}

/** A message as the old site sees it. */
export interface Reply {
  origin: string;
  /** Did it come from the window this site opened for the hand-over? */
  fromChild: boolean;
  data: unknown;
}

/** Should the old site take this reply? Only from the new home it opened, on its channel. Pure. */
export function acceptReply(ev: Reply, channel: string, newHome: string): MoveMessage | null {
  if (!ev.fromChild || ev.origin !== newHome) return null;
  const message = readMessage(ev.data, channel);
  if (!message) return null;
  return message.step === "hello" || message.step === "send" || message.step === "done" || message.step === "failed" ? message : null;
}
