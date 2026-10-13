// The Studio's conversation — every message, kept (#261).
//
// The thread used to be READ from version notes (studio-thread.ts): a version records the prompt
// that produced it, so a conversation that only ever produced versions could be rebuilt from them.
// A conversation does not only produce versions. The agent asks what the app is for before it
// builds anything, the person answers, a request is declined as the platform's — none of that is a
// version, and all of it vanished when the Studio closed. So the conversation is its own record now.
//
// Storage: a durable Store of its own (`studio-chat`), like app history and for the same reason —
// it grows with use and does not belong in the localStorage budget that carries every app's source.
// One `message` record per message, keyed by the conversation it belongs to (`chatId`).
//
// A conversation starts before there is an app to hang it on. Until the first version it lives
// under a DRAFT id, and the launcher lists those as unfinished apps; the first version moves the
// messages over to the app's id (`adoptDraft`). Deleting the app deletes its conversation, because
// app ids are name slugs and a later app with the same name must not inherit it.
//
// Versions are still history's. A `version` message names the `seq` it produced and says what
// changed; the source itself is never copied here. A version made OUTSIDE the Studio — a hand edit,
// a rollback, an app arriving from someone — has no message, and `threadItems` folds those in from
// history where they happened in time, so the thread never pretends they did not.

import type { Store } from "@potyro/store";
import { openStore } from "./open-store.js";
import { isEvent } from "./studio-thread.js";
import type { AppVersion } from "./app-history.js";

const NAMESPACE = "studio-chat";
const ENTITY = "message";
const DRAFT_PREFIX = "draft-";
/** Dispatched on `globalThis` when a draft appears, is adopted or is deleted — the launcher lists them. */
export const STUDIO_CHAT_CHANGED = "potyro:studio-chat:changed";

/**
 * What a message is.
 *
 * `ask` is the person. The rest are the agent: a `question` it needs answered before it builds, an
 * `answer` that changed nothing but says something, a `refusal` (the request is not the app's to
 * change), a `failure` (it tried and could not), and a `version` — something was made, and the card
 * for it. `event` is neither of them: something that happened to the conversation itself.
 */
export type ChatKind = "ask" | "question" | "answer" | "refusal" | "failure" | "version" | "event";
const KINDS: ReadonlySet<string> = new Set<ChatKind>(["ask", "question", "answer", "refusal", "failure", "version", "event"]);

export interface ChatMessage {
  id: string;
  /** The app's id, or a draft's while there is no app yet. */
  chatId: string;
  /** Order within the conversation, from 1. */
  n: number;
  at: string; // ISO
  kind: ChatKind;
  text: string;
  /** For a `version`: the history version it produced. */
  seq?: number;
  /** For a `version`: what the app was called then. */
  name?: string;
  /** For a `failure`: what went wrong in a developer's words, kept folded away under the plain one. */
  detail?: string;
  /** For an `ask`: the part of the app the person pointed at while asking (#284). */
  point?: MessagePoint;
}

/** A part of the app pointed at, as a message keeps it: the chip's label and the words the model read. */
export interface MessagePoint {
  label: string;
  words: string;
}

export type NewMessage = Pick<ChatMessage, "kind" | "text"> & Partial<Pick<ChatMessage, "seq" | "name" | "detail" | "point">>;

export interface DraftChat {
  id: string;
  /** What was first asked, as the person wrote it. */
  title: string;
  updatedAt: string;
}

let handle: Promise<Store> | null = null;

function store(): Promise<Store> {
  // A failed open is dropped, not cached: storage that was not ready at boot is retried next time.
  handle ??= openStore(NAMESPACE).catch((e: unknown) => {
    handle = null;
    throw e;
  });
  return handle;
}

/** Test seam: drop the cached handle so a fresh store is opened next call. */
export function resetChatStore(): void {
  handle = null;
}

function announce(): void {
  if (typeof globalThis.dispatchEvent === "function" && typeof Event === "function") globalThis.dispatchEvent(new Event(STUDIO_CHAT_CHANGED));
}

function toMessage(record: Record<string, unknown>): ChatMessage | null {
  const { id, chatId, n, at, kind, text, seq, name, detail, point } = record as Partial<ChatMessage>;
  if (typeof id !== "string" || typeof chatId !== "string" || typeof n !== "number" || typeof text !== "string") return null;
  if (typeof kind !== "string" || !KINDS.has(kind)) return null;
  return {
    id,
    chatId,
    n,
    at: typeof at === "string" ? at : new Date(0).toISOString(),
    kind,
    text,
    ...(typeof seq === "number" ? { seq } : {}),
    ...(typeof name === "string" ? { name } : {}),
    ...(typeof detail === "string" ? { detail } : {}),
    ...(isPoint(point) ? { point: { label: point.label, words: point.words } } : {}),
  };
}

const isPoint = (p: unknown): p is MessagePoint =>
  !!p && typeof p === "object" && typeof (p as MessagePoint).label === "string" && typeof (p as MessagePoint).words === "string";

async function readAll(): Promise<ChatMessage[]> {
  const rows = await (await store()).all(ENTITY);
  return rows.map((r) => toMessage(r as Record<string, unknown>)).filter((m): m is ChatMessage => m !== null);
}

/** A conversation, oldest first. Empty when there is none, or storage is unavailable. */
export async function listMessages(chatId: string): Promise<ChatMessage[]> {
  try {
    return (await readAll()).filter((m) => m.chatId === chatId).sort((a, b) => a.n - b.n);
  } catch (e) {
    console.warn("[potyro] studio conversation unavailable:", e);
    return [];
  }
}

/**
 * Add a message. Resolves to what was stored.
 *
 * Unlike history this THROWS when storage fails: the conversation is what the person is looking at,
 * and a message that silently was not kept is exactly the loss this record exists to prevent. The
 * Studio shows the failure; it does not pretend.
 */
export async function appendMessage(chatId: string, message: NewMessage, now: string): Promise<ChatMessage> {
  const s = await store();
  const mine = (await readAll()).filter((m) => m.chatId === chatId);
  const n = mine.reduce((max, m) => Math.max(max, m.n), 0) + 1;
  const written = await s.insert(ENTITY, {
    chatId,
    n,
    at: now,
    kind: message.kind,
    text: message.text,
    ...(message.seq !== undefined ? { seq: message.seq } : {}),
    ...(message.name !== undefined ? { name: message.name } : {}),
    ...(message.detail !== undefined ? { detail: message.detail } : {}),
    ...(message.point !== undefined ? { point: message.point } : {}),
  });
  if (isDraftId(chatId) && mine.length === 0) announce();
  const stored = toMessage(written as Record<string, unknown>);
  if (!stored) throw new Error("the conversation could not be saved");
  return stored;
}

/** A fresh conversation with no app behind it yet. Nothing is stored until something is said. */
export function newDraftId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${DRAFT_PREFIX}${Date.now().toString(36)}-${random}`;
}

export function isDraftId(chatId: string): boolean {
  return chatId.startsWith(DRAFT_PREFIX);
}

/** Conversations that never became an app, newest first — the launcher's unfinished apps. */
export async function listDrafts(): Promise<DraftChat[]> {
  let all: ChatMessage[];
  try {
    all = await readAll();
  } catch (e) {
    console.warn("[potyro] studio conversations unavailable:", e);
    return [];
  }
  const byChat = new Map<string, ChatMessage[]>();
  for (const m of all) {
    if (!isDraftId(m.chatId)) continue;
    byChat.set(m.chatId, [...(byChat.get(m.chatId) ?? []), m]);
  }
  return [...byChat.entries()]
    .map(([id, messages]) => {
      const ordered = messages.slice().sort((a, b) => a.n - b.n);
      const first = ordered.find((m) => m.kind === "ask") ?? ordered[0]!;
      return { id, title: first.text, updatedAt: ordered[ordered.length - 1]!.at };
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** The draft became an app: its conversation is the app's now, in the same order. */
export async function adoptDraft(draftId: string, appId: string): Promise<void> {
  const s = await store();
  const all = await readAll();
  const offset = all.filter((m) => m.chatId === appId).reduce((max, m) => Math.max(max, m.n), 0);
  for (const m of all.filter((m) => m.chatId === draftId)) await s.update(ENTITY, m.id, { chatId: appId, n: m.n + offset });
  announce();
}

/** Forget a conversation — a draft the person deleted, or the app it belonged to. */
export async function clearChat(chatId: string): Promise<void> {
  try {
    const s = await store();
    for (const m of (await readAll()).filter((m) => m.chatId === chatId)) await s.delete(ENTITY, m.id);
    if (isDraftId(chatId)) announce();
  } catch (e) {
    console.warn("[potyro] could not clear the conversation:", e);
  }
}

// ---- The thread as shown ----------------------------------------------------------------------

/** One thing on screen in the Studio's conversation. */
export type ChatItem =
  | { type: "ask"; id: string; text: string; point?: MessagePoint }
  | { type: "agent"; id: string; text: string; tone: "answer" | "question" | "refusal" | "failure"; detail?: string }
  | { type: "version"; id: string; text: string; seq?: number; name?: string; current: boolean }
  | { type: "event"; id: string; text: string; seq?: number };

type Timed = { at: string; order: number; items: ChatItem[] };

function fromMessage(m: ChatMessage): ChatItem {
  if (m.kind === "ask") return { type: "ask", id: m.id, text: m.text, ...(m.point ? { point: m.point } : {}) };
  if (m.kind === "version") return { type: "version", id: m.id, text: m.text, seq: m.seq, name: m.name, current: false };
  if (m.kind === "event") return { type: "event", id: m.id, text: m.text, seq: m.seq };
  return { type: "agent", id: m.id, text: m.text, tone: m.kind, ...(m.detail ? { detail: m.detail } : {}) };
}

function fromVersion(v: AppVersion): ChatItem[] {
  if (isEvent(v)) return v.note ? [{ type: "event", id: `v${v.seq}`, text: v.note, seq: v.seq }] : [];
  const card: ChatItem = { type: "version", id: `v${v.seq}`, text: v.rationale || "Saved.", seq: v.seq, current: false };
  return v.note ? [{ type: "ask", id: `v${v.seq}-ask`, text: v.note }, card] : [card];
}

/**
 * The conversation as it reads: its messages, and every version it does not already tell, where it
 * happened in time. The newest version's card is marked current — that one opens the app as it is.
 *
 * `versions` newest-first, as `listVersions` returns them.
 */
export function threadItems(messages: readonly ChatMessage[], versions: readonly AppVersion[]): ChatItem[] {
  const told = new Set(messages.filter((m) => m.kind === "version" && m.seq !== undefined).map((m) => m.seq));
  const timed: Timed[] = [
    ...messages.map((m, i) => ({ at: m.at, order: i, items: [fromMessage(m)] })),
    ...versions
      .filter((v) => !told.has(v.seq))
      .slice()
      .reverse()
      .map((v, i) => ({ at: v.createdAt, order: messages.length + i, items: fromVersion(v) })),
  ];
  // Stable on ties: a message and the version it produced share a timestamp, and the message (which
  // already carries the card) must not be split from its ask.
  const items = timed.sort((a, b) => (a.at === b.at ? a.order - b.order : a.at < b.at ? -1 : 1)).flatMap((t) => t.items);
  const newest = versions[0]?.seq;
  let marked = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.type !== "version") continue;
    // The newest card is current only when it IS the newest version; with no history to say, the
    // last card is.
    if (!marked && (newest === undefined || item.seq === newest)) {
      items[i] = { ...item, current: true };
      marked = true;
    }
  }
  return items;
}

/**
 * What the agent is told: everything said since the app last changed, in order, its own questions
 * included — so an answer reaches it beside the question it answers. A single request goes as typed.
 */
export function briefSince(messages: ReadonlyArray<Pick<ChatMessage, "kind" | "text" | "point">>): string {
  let start = 0;
  messages.forEach((m, i) => {
    if (m.kind === "version") start = i + 1;
  });
  const lines: string[] = [];
  let answering = false;
  for (const m of messages.slice(start)) {
    if (m.kind === "ask") {
      // Pointed at: what "this" meant goes with the words, so it is read the way it was said (#284).
      const said = m.point ? `About ${m.point.words}: ${m.text}` : m.text;
      lines.push(answering ? `The answer: ${said}` : lines.length ? `\n${said}` : said);
      answering = false;
    } else if (m.kind === "question") {
      lines.push(`\nYou asked: ${m.text}`);
      answering = true;
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---- How an app was made, carried with it -----------------------------------------------------

export const CHAT_FORMAT = "potyro-chat/1";

/** A conversation as it travels: no ids, no app — only what was said, in order. */
export interface ChatRecord {
  format: typeof CHAT_FORMAT;
  messages: Array<{ at: string; kind: ChatKind; text: string; seq?: number; name?: string }>;
}

export async function exportChat(chatId: string): Promise<ChatRecord> {
  return {
    format: CHAT_FORMAT,
    messages: (await listMessages(chatId)).map(({ at, kind, text, seq, name }) => ({
      at,
      kind,
      text,
      ...(seq !== undefined ? { seq } : {}),
      ...(name !== undefined ? { name } : {}),
    })),
  };
}

/** A record from someone else, read as data: anything that is not a conversation is refused whole. */
export function parseChatRecord(raw: unknown): ChatRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const { format, messages } = raw as { format?: unknown; messages?: unknown };
  if (format !== CHAT_FORMAT || !Array.isArray(messages)) return null;
  const out: ChatRecord["messages"] = [];
  for (const m of messages as unknown[]) {
    if (!m || typeof m !== "object") return null;
    const { at, kind, text, seq, name } = m as Record<string, unknown>;
    if (typeof kind !== "string" || !KINDS.has(kind) || typeof text !== "string") return null;
    out.push({
      at: typeof at === "string" ? at : new Date(0).toISOString(),
      kind: kind as ChatKind,
      text,
      ...(typeof seq === "number" ? { seq } : {}),
      ...(typeof name === "string" ? { name } : {}),
    });
  }
  return { format: CHAT_FORMAT, messages: out };
}

/**
 * Land a shared conversation as this app's. It replaces what is there — an app just installed has
 * none — and ends with a line saying whose it was, so what the receiver asks next is not read as
 * more of the author's.
 */
export async function importChat(appId: string, record: ChatRecord, now: string): Promise<void> {
  await clearChat(appId);
  for (const m of record.messages) await appendMessage(appId, m, m.at);
  await appendMessage(appId, { kind: "event", text: "how it was made, as shared by its author" }, now);
}
