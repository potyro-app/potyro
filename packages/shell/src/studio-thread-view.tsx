// The conversation as it reads on screen (#261).
//
// The person's words on one side, the agent's under them, and — where something was made — a card
// for it: the app's mark, its name, the version and what changed, with the one thing to do next.
// The newest card opens the app; an older one offers to go back to it. A version that was made but
// held back (it has problems, or it rewrote the app) is a card too, marked as not saved, with what
// can be done about it.

import { tileIdentity } from "./tile-identity.js";
import { PointGlyph } from "./point-mode.js";
import type { ChatItem, PlatformAsk, SentRequest } from "./studio-chat.js";
import type { PlatformRequestPayload } from "@potyro/platform-requests";
import { PlatformRequestCard } from "./platform-request-card.js";

/** A version that was made and not saved — see `Held` in studio.tsx. */
export interface HeldCard {
  name: string;
  /** Why it was held back, in a sentence. */
  why: string;
  canFix: boolean;
}

export interface ThreadViewProps {
  items: readonly ChatItem[];
  /** The app the cards are of — its id gives the mark its colour. */
  app: { id: string; name: string } | null;
  /** The agent is working: what it is doing right now, if it has said. */
  working: string | null;
  held: HeldCard | null;
  onOpen: () => void;
  onGoBack: (seq: number) => void;
  onFix: () => void;
  onKeep: () => void;
  onLook: () => void;
  onSuggest: (text: string) => void;
  /** Nothing has been said yet in a conversation that is about an app that already exists. */
  existing: boolean;
  /** Requests to the Potyro team (#263): what one would send, and sending it. Without it, none are offered. */
  requests?: {
    review: (ask: PlatformAsk) => Promise<PlatformRequestPayload>;
    send: (ask: PlatformAsk, payload: PlatformRequestPayload) => Promise<void>;
  };
}

/** Things people make, worded the way people ask — not features. */
const SUGGESTIONS = [
  "Books I've read, with a rating and a note",
  "My plants, and when each one needs water",
  "Shared costs with my flatmates",
  "A packing list I can reuse for trips",
];

function Mark({ app, name }: { app: { id: string } | null; name: string }) {
  const identity = tileIdentity({ key: app?.id ?? name, name });
  return (
    <span className="k-card-mark" aria-hidden style={{ ["--card-accent" as string]: identity.accent }}>
      {identity.glyph}
    </span>
  );
}

export function ThreadView({ items, app, working, held, onOpen, onGoBack, onFix, onKeep, onLook, onSuggest, existing, requests }: ThreadViewProps) {
  // What came of each request sent from here — the latest word on it wins (saved, then sent).
  const sent = new Map<string, SentRequest>();
  for (const item of items) if (item.type === "event" && item.request) sent.set(item.request.id, item.request);
  const askCard = (ask: PlatformAsk | undefined) =>
    ask && requests ? <PlatformRequestCard ask={ask} sent={sent.get(ask.id)} review={() => requests.review(ask)} onSend={(payload) => requests.send(ask, payload)} /> : null;
  if (!items.length && !working && !held) {
    return existing ? (
      <div className="k-studio-empty">
        <p className="k-studio-eyebrow">Change {app?.name ?? "this app"}</p>
        <h2 className="k-studio-hero">What should be different?</h2>
        <p className="k-studio-lede">Say it the way you would to a person — “add a rating”, “put the newest first”, “a page for the shopping list”.</p>
      </div>
    ) : (
      <div className="k-studio-empty">
        <p className="k-studio-eyebrow">New app</p>
        <h2 className="k-studio-hero">What would you like to make?</h2>
        <p className="k-studio-lede">
          Describe it in your own words. If something isn’t clear I’ll ask first, then build it — you can open it, use it, and keep changing it here.
        </p>
        <ul className="k-studio-suggest" aria-label="Ideas to start from">
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button type="button" className="k-studio-chip" onClick={() => onSuggest(s)}>
                {s}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <ol className="k-thread" aria-label="The conversation about this app">
      {items.map((item) => {
        if (item.type === "ask") {
          return (
            <li key={item.id} className="k-thread-turn k-thread-mine">
              {item.point ? (
                // What it was about, on the message itself: "this" in what was said means that part.
                <span className="k-point-chip k-thread-point" title={`About ${item.point.words}`}>
                  <PointGlyph />
                  <span className="k-point-chip-label">{item.point.label}</span>
                </span>
              ) : null}
              <p className="k-thread-ask">{item.text}</p>
            </li>
          );
        }
        if (item.type === "event") {
          return (
            <li key={item.id} className="k-thread-event">
              {item.text}
              {item.seq ? <span className="k-thread-seq">v{item.seq}</span> : null}
            </li>
          );
        }
        if (item.type === "agent") {
          return (
            <li key={item.id} className="k-thread-turn k-thread-theirs">
              <p className="k-thread-answer" data-tone={item.tone} data-refused={item.tone !== "answer" || undefined}>
                {item.tone === "question" ? <span className="k-thread-q" aria-hidden>?</span> : null}
                {item.text}
              </p>
              {item.detail ? (
                // The developer's words behind the plain ones, folded away: a person never needs them,
                // and whoever reports the problem can still copy them.
                <details className="k-thread-detail">
                  <summary>Details</summary>
                  <p>{item.detail}</p>
                </details>
              ) : null}
              {askCard(item.platform)}
            </li>
          );
        }
        const name = item.name ?? app?.name ?? "Your app";
        return (
          <li key={item.id} className="k-thread-turn k-thread-theirs">
            <article className="k-card" data-current={item.current || undefined} aria-label={`${name}${item.seq ? `, version ${item.seq}` : ""}`}>
              <Mark app={app} name={name} />
              <div className="k-card-body">
                <p className="k-card-name">
                  {name}
                  {item.seq ? <span className="k-thread-seq k-card-seq">v{item.seq}</span> : null}
                </p>
                <p className="k-card-what k-thread-answer">{item.text}</p>
              </div>
              {item.current ? (
                <button type="button" className="k-card-open" onClick={onOpen}>
                  Open
                </button>
              ) : item.seq ? (
                <button type="button" className="k-card-back" onClick={() => onGoBack(item.seq!)}>
                  Go back to this
                </button>
              ) : null}
            </article>
            {askCard(item.platform)}
          </li>
        );
      })}
      {held ? (
        <li className="k-thread-turn k-thread-theirs">
          <article className="k-card k-card-held" aria-label={`${held.name}, not saved`}>
            <Mark app={app} name={held.name} />
            <div className="k-card-body">
              <p className="k-card-name">
                {held.name}
                <span className="k-card-flag">not saved</span>
              </p>
              <p className="k-card-what">{held.why}</p>
              <div className="k-card-actions">
                {held.canFix ? (
                  <button type="button" className="k-card-open" onClick={onFix}>
                    Try to fix it
                  </button>
                ) : null}
                <button type="button" className="k-card-back" onClick={onLook}>
                  Look at it
                </button>
                <button type="button" className="k-card-back" onClick={onKeep}>
                  Keep it anyway
                </button>
              </div>
            </div>
          </article>
        </li>
      ) : null}
      {working !== null ? (
        <li className="k-thread-turn k-thread-theirs">
          <p className="k-thread-answer k-thread-working" aria-live="polite">
            <span className="k-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            {working || "Working…"}
          </p>
        </li>
      ) : null}
    </ol>
  );
}
