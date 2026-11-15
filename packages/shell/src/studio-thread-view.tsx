// The conversation as it reads on screen (#261).
//
// The person's words on one side, the agent's under them, and — where something was made — a card
// for it: the app's mark, its name, the version and what changed, with the one thing to do next.
// The newest card opens the app; an older one offers to go back to it. A version that was made but
// held back (it has problems, or it rewrote the app) is a card too, marked as not saved, with what
// can be done about it.
//
// #75 adds three things to it. A QUESTION that waits on the person shows its answers as buttons — one
// tap answers it. A version's card lists what was GUESSED while making it, each guess a button that
// starts the sentence that corrects it. And a change that is not small is a PLAN first: what it does,
// what happens to the records already there, and Go — it is saved only then.

import { Mascot } from "@potyro/views";
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

/** A change that was made and waits for Go — see `Planned` in studio-plan.ts. */
export interface PlanCard {
  name: string;
  /** What the change does: the sentences its version card would say. */
  summary: string;
  /** What happens to the records already there, a sentence each. */
  consequences: readonly string[];
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
  /**
   * A suggestion tapped: its words go in the box. Absent while the box is not there to fill (the key
   * panel stands in its place, #488): then no suggestions are offered, since a tap would show nothing.
   */
  onSuggest?: (text: string) => void;
  /** A question's choice tapped (#75): it is the person's answer, sent as said. Absent, the choices are not offered. */
  onAnswer?: (text: string) => void;
  /** A guess on the current version's card tapped (#75): the box starts the sentence that corrects it. */
  onAssumption?: (text: string) => void;
  /** A change that is not small, made and not saved until Go (#75). */
  plan?: PlanCard | null;
  onGo?: () => void;
  /** "Change something": nothing is saved, and the box takes what should be different. */
  onChangePlan?: () => void;
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
function RemixHello({ remix, onSuggest }: { remix: RemixGreeting; onSuggest?: (text: string) => void }) {
  const { t } = useLingui();
  return (
    <li className="k-thread-turn k-thread-theirs k-remix-hello" aria-label={t({ message: "The Studio, on your remix", comment: "The Studio's greeting on a remix, for a screen reader" })}>
      <p className="k-remix-credit">{remix.credit}</p>
      <p className="k-thread-answer k-remix-ask">
        <Trans comment="The Studio's first words on a remix">This is your own copy. What would you like to change?</Trans>
      </p>
      {remix.suggestions.length && onSuggest ? (
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

export function ThreadView({
  items,
  app,
  working,
  held,
  onOpen,
  onGoBack,
  onFix,
  onKeep,
  onLook,
  onSuggest,
  onAnswer,
  onAssumption,
  plan = null,
  onGo,
  onChangePlan,
  existing,
  remix,
  requests,
}: ThreadViewProps) {
  const { t } = useLingui();
  const busy = working !== null;
  // The plan that waits is the newest thing said as one; an older one was not kept, and says so.
  const livePlanAt = plan ? items.reduce((at, item, i) => (item.type === "agent" && item.plan && item.text === plan.summary ? i : at), -1) : -1;
  const planCard = plan ? (
    <article className="k-card k-card-plan" aria-label={t({ message: `${plan.name}, a change not saved yet`, comment: "A Studio card for a change that waits for the person's Go before it is saved" })}>
      <Mark app={app} name={plan.name} />
      <div className="k-card-body">
        <p className="k-card-name">
          {plan.name}
          <span className="k-card-flag k-plan-flag">
            <Trans comment="Studio plan card: the change was made and waits for Go">not saved yet</Trans>
          </span>
        </p>
        <p className="k-card-what k-plan-what">{plan.summary}</p>
        {plan.consequences.length ? (
          <ul className="k-plan-consequences" aria-label={t({ message: "What happens to what you have entered", comment: "Studio plan card: the list of what a change does to the records already in the app" })}>
            {plan.consequences.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : null}
        <div className="k-card-actions">
          <button type="button" className="k-card-open k-plan-go" disabled={busy} onClick={onGo}>
            <Trans comment="Studio plan card: keep the change exactly as it was made">Go</Trans>
          </button>
          <button type="button" className="k-card-back k-plan-change" disabled={busy} onClick={onChangePlan}>
            <Trans comment="Studio plan card: do not save it; say what should be different">Change something</Trans>
          </button>
          <button type="button" className="k-card-back" onClick={onLook}>
            <Trans>Look at it</Trans>
          </button>
        </div>
      </div>
    </article>
  ) : null;
  // What came of each request sent from here — the latest word on it wins (saved, then sent).
  const sent = new Map<string, SentRequest>();
  for (const item of items) if (item.type === "event" && item.request) sent.set(item.request.id, item.request);
  const askCard = (ask: PlatformAsk | undefined) =>
    ask && requests ? <PlatformRequestCard ask={ask} sent={sent.get(ask.id)} review={() => requests.review(ask)} onSend={(payload) => requests.send(ask, payload)} /> : null;
  // Greeted until the person first asks for something; after that the conversation speaks for itself.
  const greet = remix && !items.some((i) => i.type === "ask") && !working ? remix : null;
  if (!items.length && !working && !held && !greet && !plan) {
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
        {onSuggest ? (
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
        ) : null}
      </div>
    );
  }

  return (
    <ol className="k-thread" aria-label={t`The conversation about this app`}>
      {items.map((item, at) => {
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
        if (item.type === "agent" && item.plan) {
          // The plan that waits is its card. One the person said Go to became the version under it:
          // said once, by that card. Any other was not kept — the Studio closed, or it was changed.
          if (at === livePlanAt) {
            return (
              <li key={item.id} className="k-thread-turn k-thread-theirs">
                {planCard}
              </li>
            );
          }
          if (items[at + 1]?.type === "version") return null;
          return (
            <li key={item.id} className="k-thread-turn k-thread-theirs">
              <p className="k-thread-answer" data-tone="answer">
                {item.text}
              </p>
              <p className="k-plan-gone">
                {at === items.length - 1 && !busy && !held ? (
                  <Trans comment="Under a planned change that was never saved, when it is the last thing in the conversation">This change was not saved. Ask again and I’ll make it.</Trans>
                ) : (
                  <Trans comment="Under a planned change that was never saved">This change was not saved.</Trans>
                )}
              </p>
            </li>
          );
        }
        if (item.type === "agent") {
          // A question waits on the person while it is the last thing said: then its answers are buttons.
          const waits = item.tone === "question" && at === items.length - 1 && !busy;
          const choices = waits && onAnswer ? (item.options ?? []) : [];
          return (
            <li key={item.id} className="k-thread-turn k-thread-theirs" data-waits={waits || undefined}>
              <p className="k-thread-answer" data-tone={item.tone} data-refused={item.tone !== "answer" || undefined}>
                {item.tone === "question" ? <span className="k-thread-q" aria-hidden>?</span> : null}
                {item.text}
              </p>
              {choices.length ? (
                <div className="k-question">
                  <ul className="k-question-options" aria-label={t({ message: "Answers to choose from", comment: "The buttons under a question the Studio asked: each is one answer" })}>
                    {choices.map((choice) => (
                      <li key={choice}>
                        <button type="button" className="k-question-option" onClick={() => onAnswer?.(choice)}>
                          {choice}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {item.allowOther !== false ? (
                    <p className="k-question-other">
                      <Trans comment="Under the answer buttons of a question the Studio asked">Or answer in your own words below.</Trans>
                    </p>
                  ) : null}
                </div>
              ) : null}
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
                {/* A first app made (DESIGN.md §4.2): the mascot comes in, once, on its first version. */}
                {item.current && seq === 1 ? <Mascot mode="enter" size={28} className="k-card-mascot" /> : null}
                <p className="k-card-name">
                  {name}
                  {item.seq ? <span className="k-thread-seq k-card-seq">v{item.seq}</span> : null}
                </p>
                <p className="k-card-what k-thread-answer">{item.text}</p>
                {item.current && item.assumed?.length ? (
                  // What was guessed while making it (#75): a wrong guess is one tap from the sentence that fixes it.
                  <div className="k-assumed">
                    <p className="k-assumed-label">
                      {onAssumption ? (
                        <Trans comment="Above the list of guesses on a version's card; each guess is a button">I guessed these. Tap one to change it.</Trans>
                      ) : (
                        <Trans comment="Above the list of guesses on a version's card, when they cannot be tapped">I guessed these.</Trans>
                      )}
                    </p>
                    <ul className="k-assumed-list" aria-label={t({ message: "What was guessed", comment: "The list of guesses on a version's card" })}>
                      {item.assumed.map((guess) => (
                        <li key={guess}>
                          {onAssumption ? (
                            <button type="button" className="k-assumed-item" onClick={() => onAssumption(guess)}>
                              {guess}
                            </button>
                          ) : (
                            <span className="k-assumed-item">{guess}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
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
      {/* A plan whose words are not in the conversation (it could not be kept there) still waits, here. */}
      {planCard && livePlanAt < 0 ? <li className="k-thread-turn k-thread-theirs">{planCard}</li> : null}
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
          {/* A long wait (DESIGN.md §4.2): the mascot draws its stroke while the app is made; under
              reduced motion the stroke is there and a bar moves instead (mascot.tsx). */}
          <p className="k-thread-answer k-thread-working k-waiting" aria-live="polite">
            <Mascot mode="drawing" size={26} />
            <span className="k-waiting-bar" aria-hidden />
            {working || t`Working`}
          </p>
        </li>
      ) : null}
    </ol>
  );
}
