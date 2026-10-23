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

import { fmt } from "@potyro/i18n";
import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { PotyroRuntime } from "@potyro/runtime";
import { memberName, personHue, personInitials } from "@potyro/runtime";
import type { ChatMessage, Store } from "@potyro/store";
import { ROOM_THREAD, recordThread } from "@potyro/store";

/** Where this device remembers what it has already read. Local by design — see the header. */
const seenKey = (appId: string, thread: string): string => `potyro:chat-seen:${appId}:${thread}`;

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
export function useThread(runtime: PotyroRuntime, thread: string | null): {
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
        setError(e instanceof Error ? e.message : t`That message could not be sent.`);
      }
    },
    [store, thread],
  );

  return { messages, post, error };
}

/**
 * Who is in the space, kept current.
 *
 * `runtime.ctx` is rebuilt per access, so the values are always fresh — but nothing would re-render
 * this panel when they change. Chat has no query hooks to piggyback on (its data comes from the
 * message subscription), so it subscribes to the runtime's own invalidation, which is what the
 * membership watcher already fires. Without it a peer's rename lands in the store, updates `ctx`,
 * and stays invisible until something unrelated happened to redraw the panel.
 */
function useLiveMembers(runtime: PotyroRuntime): {
  me: PotyroRuntime["ctx"]["me"];
  members: readonly { id: string; name: string }[] | undefined;
} {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => runtime.core.onInvalidate(() => bump()), [runtime]);
  return { me: runtime.ctx.me, members: runtime.ctx.space?.members };
}

/** "14:32", or the date once it is not today — a conversation is scanned by time, not by date. */
function when(at: Date): string {
  const today = new Date();
  const sameDay =
    at.getDate() === today.getDate() && at.getMonth() === today.getMonth() && at.getFullYear() === today.getFullYear();
  const time: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  return sameDay ? fmt.date(at, time) : fmt.date(at, { ...time, year: "numeric", month: "numeric", day: "numeric" });
}

/**
 * What just arrived, beside the button that opens it (#chat preview).
 *
 * A number on a button says there is something to read and nothing about whether it can wait. A
 * shared app's messages are mostly one line — "got the milk", "running late", "which aisle?" — so
 * the line itself is the notification, and the chat has to be opened only when there is something
 * to say back.
 *
 * Two ways out, both of them explicit: read it here and dismiss, or open the conversation. It does
 * not fade on a timer — a message that disappears while you are reading it is worse than no preview.
 */
export function ChatPeek({
  runtime,
  message,
  anchor,
  onOpen,
  onDismiss,
}: {
  runtime: PotyroRuntime;
  message: ChatMessage;
  /** The Chat button. The balloon is measured against it and points back at it. */
  anchor: RefObject<HTMLElement | null>;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLingui();
  const { me, members } = useLiveMembers(runtime);
  const who = message.by === me?.id ? t({ message: "You", comment: "Chat: a message you wrote" }) : memberName(message.by, { me, members });
  const at = useAnchored(anchor);
  if (!at) return null;

  // Fixed and portalled, not absolute beside the button: on a wide screen that button lives in a
  // sidebar that scrolls, and a balloon inside it is cut off at the sidebar's edge — which is
  // exactly where the message was.
  return createPortal(
    <div
      className="k-chat-peek"
      role="status"
      style={{
        ["--k-hue" as string]: personHue(message.by),
        top: `${at.top}px`,
        left: `${at.left}px`,
        width: `${at.width}px`,
        ["--k-tail" as string]: `${at.tail}px`,
      }}
    >
      <span className="k-avatar" aria-hidden>
        {personInitials(who, message.by)}
      </span>
      <div className="k-chat-peek-body">
        <p className="k-chat-peek-who">
          {who} <span className="k-chat-peek-when">{when(message.at)}</span>
        </p>
        <p className="k-chat-peek-text">{message.text}</p>
      </div>
      <button type="button" className="k-add k-primary-action k-chat-peek-open" onClick={onOpen}>
        <Trans comment="Open the chat a message arrived in">Open</Trans>
      </button>
      <button type="button" className="k-chat-peek-close" aria-label={t`Dismiss this message`} onClick={onDismiss}>
        ✕
      </button>
    </div>,
    document.querySelector(".k-app") ?? document.body,
  );
}

/**
 * Where to put a balloon hanging off `anchor`: under it, right-aligned with it, and pulled back
 * inside the window if that would put it over an edge. `tail` is where the arrow goes, measured
 * from the balloon's own left edge so it still points at the button after that clamping.
 */
function useAnchored(anchor: RefObject<HTMLElement | null>): { top: number; left: number; width: number; tail: number } | null {
  const [at, setAt] = useState<{ top: number; left: number; width: number; tail: number } | null>(null);
  useLayoutEffect(() => {
    const place = (): void => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const room = window.innerWidth;
      const width = Math.min(336, room - 16);
      // Opens to the RIGHT of the button by default, because that is where the space is: on a wide
      // screen the button sits in the left sidebar, and a balloon hanging leftwards from it runs off
      // the app's column and out of the window. It flips to the left only when opening right would
      // not fit — which is the phone, where the button is up in the right corner.
      const rightwards = r.left + width <= room - 8;
      const left = Math.max(8, Math.min(room - width - 8, rightwards ? r.left : r.right - width));
      setAt({ top: r.bottom + 10, left, width, tail: Math.max(12, Math.min(width - 24, r.left + r.width / 2 - left - 6)) });
    };
    place();
    window.addEventListener("resize", place);
    // Capture: the scroller is whatever the button happens to sit in (a sidebar, the page).
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);
  return at;
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
  runtime: PotyroRuntime;
  appId: string;
  thread: string;
  emptyText: string;
  autoFocus?: boolean;
}) {
  const { t } = useLingui();
  const { messages, post, error } = useThread(runtime, thread);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const { me, members } = useLiveMembers(runtime);
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
          messages.map((m) => {
            const who = m.by === me?.id ? t({ message: "You", comment: "Chat: a message you wrote" }) : memberName(m.by, { me, members });
            return (
              <li
                key={m.id}
                className="k-chat-msg"
                data-mine={m.by === me?.id || undefined}
                // The colour is derived from the account id, so it is the same on everyone's screen
                // and needs nothing stored or agreed. It is what distinguishes people when the NAMES
                // cannot: a fresh identity is called "Me" until its owner renames it, and nothing
                // stops two people picking the same name.
                style={{ ["--k-hue" as string]: personHue(m.by) }}
              >
                <span className="k-avatar" aria-hidden>
                  {personInitials(who === "You" ? (me?.name ?? "") : who, m.by)}
                </span>
                <div className="k-chat-body">
                  <div className="k-chat-meta">
                    <span className="k-chat-who">{who}</span>
                    <time className="k-chat-when" dateTime={m.at.toISOString()}>
                      {when(m.at)}
                    </time>
                  </div>
                  <p className="k-chat-text">{m.text}</p>
                </div>
              </li>
            );
          })
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
          aria-label={t({ message: "Message", comment: "The box a chat message is typed in" })}
          placeholder={t`Write a message`}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="k-add k-chat-send" disabled={!draft.trim() || sending}>
          <Trans comment="Send a chat message">Send</Trans>
        </button>
      </form>

      {/* Permanent, not a dismissible tip. Delivery really is store-and-forward, and a chat box that
          hides that is one people read silence into. */}
      <p className="k-chat-note">
        {alone
          ? t`Nobody else is here yet. Share this app and whatever you write will be waiting for them.`
          : t`Messages arrive when the other person next opens this app — nothing is pushed to their phone.`}
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
  runtime: PotyroRuntime;
  appId: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const name = runtime.definition.name;
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
        aria-label={t`Chat about ${name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="k-activity-head">
          <h2>
            <Trans comment="Heading of an app's shared chat">Chat</Trans>
          </h2>
          <button type="button" className="k-add" onClick={onClose} aria-label={t`Close`}>
            ✕
          </button>
        </header>
        <Thread
          runtime={runtime}
          appId={appId}
          thread={ROOM_THREAD}
          autoFocus
          emptyText={t`Nothing said yet. This is for everyone you share ${name} with.`}
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
  runtime: PotyroRuntime;
  appId: string;
  entity: string;
  recordId: string;
  label: string;
}) {
  const { t } = useLingui();
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
        💬 <Trans comment="A record's own conversation">Comments</Trans>
        {started ? <span className="k-activity-count">{messages.length}</span> : null}
      </button>
      {open || started ? (
        <Thread
          runtime={runtime}
          appId={appId}
          thread={thread}
          autoFocus={open && !started}
          emptyText={t`Nothing about ${label} yet.`}
        />
      ) : null}
    </section>
  );
}
