// The conversation as it reads on screen (#261).
//
// The person's words on one side, the agent's under them, and — where something was made — a card
// for it: the app's mark, its name, the version and what changed, with the one thing to do next.
// The newest card opens the app; an older one offers to go back to it. A version that was made but
// held back (it has problems, or it rewrote the app) is a card too, marked as not saved, with what
// can be done about it.

import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { tileIdentity } from "./tile-identity.js";
import { TileGlyph } from "./tile-glyph.js";
import { shownNote } from "./version-notes.js";
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
  /**
   * A remix nobody has asked anything of yet (docs/24 §6): the Studio greets it — what it is a remix of,
   * "What would you like to change?", and a few changes drawn from the app (remix-suggestions.ts).
   */
  remix?: RemixGreeting | null;
  /** Requests to the Potyro team (#263): what one would send, and sending it. Without it, none are offered. */
  requests?: {
    review: (ask: PlatformAsk) => Promise<PlatformRequestPayload>;
    send: (ask: PlatformAsk, payload: PlatformRequestPayload) => Promise<void>;
  };
}

/** Things people make, worded the way people ask — not features. Sent as the person's own words, so in their language. */
const SUGGESTIONS = [
  msg`Books I've read, with a rating and a note`,
  msg`My plants, and when each one needs water`,
  msg`Shared costs with my flatmates`,
  msg`A packing list I can reuse for trips`,
];

export interface RemixGreeting {
  /** "Remix of Groceries by Ana". */
  credit: string;
  suggestions: readonly string[];
}

/** The Studio's first words to a remix: an answer-side turn, so it reads as the Studio talking. */
function RemixHello({ remix, onSuggest }: { remix: RemixGreeting; onSuggest: (text: string) => void }) {
  const { t } = useLingui();
  return (
    <li className="k-thread-turn k-thread-theirs k-remix-hello" aria-label={t({ message: "The Studio, on your remix", comment: "The Studio's greeting on a remix, for a screen reader" })}>
      <p className="k-remix-credit">{remix.credit}</p>
      <p className="k-thread-answer k-remix-ask">
        <Trans comment="The Studio's first words on a remix">This is your own copy. What would you like to change?</Trans>
      </p>
      {remix.suggestions.length ? (
        <ul className="k-studio-suggest k-remix-suggest" aria-label={t({ message: "Changes to start from", comment: "Suggested changes for a remix" })}>
          {remix.suggestions.map((s) => (
            <li key={s}>
              <button type="button" className="k-studio-chip" onClick={() => onSuggest(s)}>
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Mark({ app, name }: { app: { id: string } | null; name: string }) {
  const identity = tileIdentity({ key: app?.id ?? name, name });
  return (
    <span className="k-card-mark" aria-hidden style={{ ["--card-accent" as string]: identity.accent }}>
      <TileGlyph identity={identity} size={20} />
    </span>
  );
}

export function ThreadView({ items, app, working, held, onOpen, onGoBack, onFix, onKeep, onLook, onSuggest, existing, remix, requests }: ThreadViewProps) {
  const { t } = useLingui();
  // What came of each request sent from here — the latest word on it wins (saved, then sent).
  const sent = new Map<string, SentRequest>();
  for (const item of items) if (item.type === "event" && item.request) sent.set(item.request.id, item.request);
  const askCard = (ask: PlatformAsk | undefined) =>
    ask && requests ? <PlatformRequestCard ask={ask} sent={sent.get(ask.id)} review={() => requests.review(ask)} onSend={(payload) => requests.send(ask, payload)} /> : null;
  // Greeted until the person first asks for something; after that the conversation speaks for itself.
  const greet = remix && !items.some((i) => i.type === "ask") && !working ? remix : null;
  if (!items.length && !working && !held && !greet) {
    return existing ? (
      <div className="k-studio-empty">
        <p className="k-studio-eyebrow">{app ? <Trans comment="Studio, empty conversation about an existing app; name is the app's">Change {app.name}</Trans> : <Trans>Change this app</Trans>}</p>
        <h2 className="k-studio-hero">
          <Trans>What should be different?</Trans>
        </h2>
        <p className="k-studio-lede">
          <Trans>Say it the way you would to a person — “add a rating”, “put the newest first”, “a page for the shopping list”.</Trans>
        </p>
      </div>
    ) : (
      <div className="k-studio-empty">
        <p className="k-studio-eyebrow">
          <Trans>New app</Trans>
        </p>
        <h2 className="k-studio-hero">
          <Trans>What would you like to make?</Trans>
        </h2>
        <p className="k-studio-lede">
          <Trans>Describe it in your own words. If something isn’t clear I’ll ask first, then build it — you can open it, use it, and keep changing it here.</Trans>
        </p>
        <ul className="k-studio-suggest" aria-label={t`Ideas to start from`}>
          {SUGGESTIONS.map((d) => {
            const s = t(d);
            return (
              <li key={s}>
                <button type="button" className="k-studio-chip" onClick={() => onSuggest(s)}>
                  {s}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <ol className="k-thread" aria-label={t`The conversation about this app`}>
      {items.map((item) => {
        if (item.type === "ask") {
          return (
            <li key={item.id} className="k-thread-turn k-thread-mine">
              {item.point ? (
                // What it was about, on the message itself: "this" in what was said means that part.
                <span className="k-point-chip k-thread-point" title={t({ message: `About ${item.point.label}`, comment: "The part of the app a message is about" })}>
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
              {shownNote(item.text)}
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
                  <summary>
                    <Trans comment="Folded developer details under a plain failure message">Details</Trans>
                  </summary>
                  <p>{item.detail}</p>
                </details>
              ) : null}
              {askCard(item.platform)}
            </li>
          );
        }
        const name = item.name ?? app?.name ?? t`Your app`;
        const seq = item.seq;
        return (
          <li key={item.id} className="k-thread-turn k-thread-theirs">
            <article className="k-card" data-current={item.current || undefined} aria-label={seq ? t({ message: `${name}, version ${seq}`, comment: "A card in the Studio conversation: the app and which version it is" }) : name}>
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
                  <Trans comment="Studio card: open the app this version made">Open</Trans>
                </button>
              ) : item.seq ? (
                <button type="button" className="k-card-back" onClick={() => onGoBack(item.seq!)}>
                  <Trans>Go back to this</Trans>
                </button>
              ) : null}
            </article>
            {askCard(item.platform)}
          </li>
        );
      })}
      {greet ? <RemixHello remix={greet} onSuggest={onSuggest} /> : null}
      {held ? (
        <li className="k-thread-turn k-thread-theirs">
          <article className="k-card k-card-held" aria-label={t({ message: `${held.name}, not saved`, comment: "A Studio card for a version that was made but not saved" })}>
            <Mark app={app} name={held.name} />
            <div className="k-card-body">
              <p className="k-card-name">
                {held.name}
                <span className="k-card-flag">
                  <Trans>not saved</Trans>
                </span>
              </p>
              <p className="k-card-what">{held.why}</p>
              <div className="k-card-actions">
                {held.canFix ? (
                  <button type="button" className="k-card-open" onClick={onFix}>
                    <Trans>Try to fix it</Trans>
                  </button>
                ) : null}
                <button type="button" className="k-card-back" onClick={onLook}>
                  <Trans>Look at it</Trans>
                </button>
                <button type="button" className="k-card-back" onClick={onKeep}>
                  <Trans>Keep it anyway</Trans>
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
            {working || t`Working…`}
          </p>
        </li>
      ) : null}
    </ol>
  );
}
