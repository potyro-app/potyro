// Talking to the people you share an app with (KA-35, part 2 — the UI).
//
// The storage half lives on the Store (`postMessage` / `messages` / `subscribeMessages`) and is
// deliberately NOT on `ctx`: an app shared with you is untrusted code written by someone else, and
// "their app can read the messages you send them" is an exfiltration path (hard rule 3). This file
// is the only thing that calls it — which is why the UI lives in the shell rather than in `views`,
// where it would be reachable from a page an app declares.
//
// ## Two surfaces, one mechanism
//
// A ROOM per app — the commodity part, a modal from the header, mirroring "Changes".
// A THREAD per record — the part nothing else can do, rendered inline under the record it is about.
// `recordThread(entity, id)` and `ROOM_THREAD` are just two thread keys into the same map, so both
// are the same component with a different `thread`.
//
// ## The watermark is LOCAL
//
// Same decision as activity (KA-36), for the same reasons: `localStorage`, per device. Nobody learns
// whether you read anything, nothing extra crosses the wire, and there are no read receipts to
// un-ship later. The cost is that unread does not follow you to a second device.
//
// ## Delivery is store-and-forward, and the UI has to say so
//
// A message lands when the recipient next opens the app. There is no push server (KA-37), and a
// local notification cannot wake an app that is not running (KA-03). If this looked like an instant
// messenger, silence would read as a bug rather than as "they haven't opened it yet" — so the
// composer says it, permanently, rather than in a dismissible first-run tip.
//
// ## Why there is no separate "chat on/off" flag
//
// KA-35's acceptance asked for one, "the same shape as sync". Part 1 settled it differently and this
// follows that: the container is created WITH the root, because a lazily created one is a container
// two peers can create at once, stranding the loser's messages. So chat exists exactly when the app
// is synced — which is also exactly when there is anybody to talk to. A second flag would gate an
// empty CoMap and add a switch whose "off" position means "the people you share with cannot reach
// you", which is not a setting worth offering.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KartaRuntime } from "@karta/runtime";
import { memberName } from "@karta/runtime";
import type { ChatMessage, Store } from "@karta/store";
import { ROOM_THREAD, recordThread } from "@karta/store";

/** Where this device remembers what it has already read. Local by design — see the header. */
const seenKey = (appId: string, thread: string): string => `karta:chat-seen:${appId}:${thread}`;

function lastRead(appId: string, thread: string): number {
  const raw = globalThis.localStorage?.getItem(seenKey(appId, thread));
  const at = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(at) ? 0 : at;
}

function markRead(appId: string, thread: string, at: Date = new Date()): void {
  globalThis.localStorage?.setItem(seenKey(appId, thread), at.toISOString());
}

/**
 * Whether this store can carry a conversation at all.
 *
 * Only the CRDT store can; a local-only app has no space and nobody in it. Callers must check rather
 * than render an empty thread, which would invite someone to type into a box nobody will ever read.
 */
export function chatSupported(store: Store): boolean {
  return typeof store.postMessage === "function" && typeof store.messages === "function";
}

/**
 * How many messages in this thread are new to this device — never counting your own.
 *
 * Your own messages arrive back through the same subscription (they are just entries in the map), so
 * without the author check every message you sent would raise your own unread badge.
 */
export function unreadCount(messages: readonly ChatMessage[], appId: string, thread: string, meId?: string): number {
  const since = lastRead(appId, thread);
  return messages.filter((m) => m.at.getTime() > since && m.by !== meId).length;
}

/**
 * A thread's messages, kept current.
 *
 * Subscribes rather than polls, so a peer's message appears without a reload — the guarantee this
 * feature is worth nothing without. `thread === null` loads nothing, so a caller can hold the hook
 * unconditionally while the record it is about is still resolving.
 */
export function useThread(runtime: KartaRuntime, thread: string | null): {
  messages: ChatMessage[];
  post: (text: string) => Promise<void>;
  error: string | null;
} {
  const store = runtime.core.store;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!thread || !chatSupported(store)) {
      setMessages([]);
      return;
    }
    let alive = true;
    const refresh = (): void => {
      void store
        .messages?.(thread)
        .then((next) => {
          if (alive) setMessages(next);
        })
        .catch(() => {
          // A read that fails is not worth a banner: the subscription will call again on the next
          // change, and an empty thread is what an unreachable one looks like anyway.
        });
    };
    refresh();
    const stop = store.subscribeMessages?.(thread, refresh);
    return () => {
      alive = false;
      stop?.();
    };
  }, [store, thread]);

  const post = useCallback(
    async (text: string): Promise<void> => {
      if (!thread || !store.postMessage) return;
      setError(null);
      try {
        await store.postMessage(thread, text);
        // Do not wait for the subscription: it fires, but the round trip is visible as a lag between
        // pressing Send and seeing your own words, which reads as the message being lost.
        const next = await store.messages?.(thread);
        if (next) setMessages(next);
      } catch (e) {
        // Posting is the one operation whose failure MUST be visible. Losing what someone typed
        // silently is the worst thing a message box can do.
        setError(e instanceof Error ? e.message : "That message could not be sent.");
      }
    },
    [store, thread],
  );

  return { messages, post, error };
}

/** "14:32", or the date once it is not today — a conversation is scanned by time, not by date. */
function when(at: Date): string {
  const today = new Date();
  const sameDay =
    at.getDate() === today.getDate() && at.getMonth() === today.getMonth() && at.getFullYear() === today.getFullYear();
  return sameDay
    ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : `${at.toLocaleDateString()} ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * The conversation itself: the messages, and a box to add one.
 *
 * Shared by the room and by a record's thread, because they differ only in what they hang off.
 */
export function Thread({
  runtime,
  appId,
  thread,
  emptyText,
  autoFocus,
}: {
  runtime: KartaRuntime;
  appId: string;
  thread: string;
  emptyText: string;
  autoFocus?: boolean;
}) {
  const { messages, post, error } = useThread(runtime, thread);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const me = runtime.ctx.me;
  const members = runtime.ctx.space?.members;
  const alone = (members?.length ?? 1) <= 1;

  // Reading IS having read. The watermark moves whenever the rendered set changes, so a thread left
  // open while someone replies does not keep the reply marked unread.
  useEffect(() => {
    if (messages.length) markRead(appId, thread, messages[messages.length - 1]!.at);
  }, [appId, thread, messages]);

  // A conversation is read from the bottom; a new message that lands below the fold has not arrived
  // as far as the person is concerned.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    // Cleared BEFORE the await so a slow write does not let the same text be sent twice, and
    // restored if it fails — losing what someone typed is worse than a duplicated attempt.
    setDraft("");
    await post(text).catch(() => setDraft(text));
    setSending(false);
  };

  return (
    <div className="k-chat">
      <ul className="k-chat-list">
        {messages.length === 0 ? (
          <li className="k-muted k-chat-empty">{emptyText}</li>
        ) : (
          messages.map((m) => (
            <li key={m.id} className="k-chat-msg" data-mine={m.by === me?.id || undefined}>
              <div className="k-chat-meta">
                <span className="k-chat-who">{memberName(m.by, { me, members })}</span>
                <time className="k-chat-when" dateTime={m.at.toISOString()}>
                  {when(m.at)}
                </time>
              </div>
              <p className="k-chat-text">{m.text}</p>
            </li>
          ))
        )}
        <div ref={endRef} />
      </ul>

      {error ? <p className="k-chat-error">{error}</p> : null}

      <form
        className="k-chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          type="text"
          className="k-chat-input"
          value={draft}
          autoFocus={autoFocus}
          aria-label="Message"
          placeholder="Write a message…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="k-add k-chat-send" disabled={!draft.trim() || sending}>
          Send
        </button>
      </form>

      {/* Permanent, not a dismissible tip. Delivery really is store-and-forward, and a chat box that
          hides that is one people read silence into. */}
      <p className="k-chat-note">
        {alone
          ? "Nobody else is here yet. Share this app and whatever you write will be waiting for them."
          : "Messages arrive when the other person next opens this app — nothing is pushed to their phone."}
      </p>
    </div>
  );
}

/** The room: everyone who shares the app, not attached to any record. */
export function ChatPanel({
  runtime,
  appId,
  onClose,
}: {
  runtime: KartaRuntime;
  appId: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    globalThis.addEventListener?.("keydown", onKey);
    return () => globalThis.removeEventListener?.("keydown", onKey);
  }, [onClose]);

  return (
    <div className="k-modal-scrim" onClick={onClose}>
      <div
        className="k-modal k-chat-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Chat about ${runtime.definition.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="k-activity-head">
          <h2>Chat</h2>
          <button type="button" className="k-add" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <Thread
          runtime={runtime}
          appId={appId}
          thread={ROOM_THREAD}
          autoFocus
          emptyText={`Nothing said yet. This is for everyone you share ${runtime.definition.name} with.`}
        />
      </div>
    </div>
  );
}

/**
 * A record's own conversation, inline under it.
 *
 * This is the half of KA-35 that nothing else can do: a comment on the milk item, in the app where
 * milk lives, with an author that cannot be forged. So it is not behind a button — it is part of the
 * record, collapsed to its header until there is something to say.
 */
export function RecordThread({
  runtime,
  appId,
  entity,
  recordId,
  label,
}: {
  runtime: KartaRuntime;
  appId: string;
  entity: string;
  recordId: string;
  label: string;
}) {
  const thread = useMemo(() => recordThread(entity, recordId), [entity, recordId]);
  const { messages } = useThread(runtime, thread);
  // Open when there is a conversation to see. Collapsed otherwise, so an empty box does not sit
  // under every record demanding to be filled.
  const [open, setOpen] = useState(false);
  const started = messages.length > 0;

  return (
    <section className="k-record-thread">
      <button
        type="button"
        className="k-add k-record-thread-toggle"
        aria-expanded={open || started}
        onClick={() => setOpen((v) => !v)}
      >
        💬 Comments
        {started ? <span className="k-activity-count">{messages.length}</span> : null}
      </button>
      {open || started ? (
        <Thread
          runtime={runtime}
          appId={appId}
          thread={thread}
          autoFocus={open && !started}
          emptyText={`Nothing about ${label} yet.`}
        />
      ) : null}
    </section>
  );
}
