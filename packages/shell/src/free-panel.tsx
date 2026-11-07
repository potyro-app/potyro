// The Studio when no engine can make an app (#455): no free app making here (or it is used up, or
// paused), and no key of the person's own. A disabled send button and "needs an API key" said nothing
// about what a key is or where to get one; this says it in a few lines, and offers the path that needs
// nothing at all: an app from the gallery, made your own.
//
// When it is here because free app making stopped, that comes first, in the relay's terms said as
// words (free-ai.ts `refusalText`). "I'd pay for a plan" is a count and nothing more (demand-counts.ts,
// #118): no email, nothing about the person, and nothing promised back.
//
// What the person already asked for is kept in the hidden box while the panel stands in its place
// (#488): the panel says it back, in their words, on one line, so it does not look lost.

import { useState, type MouseEvent } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { galleryUrl, openGallery } from "./gallery-link.js";
import { freeUnreachable, refusalText, type FreeAi, stoppedNow } from "./free-ai.js";
import { countOnce, countedThisMonth, wantedPlan } from "./demand-counts.js";

/**
 * Where each service hands out keys, for the engines Model settings has by name. Names are the
 * services' own. Any other server that speaks the OpenAI API goes in as an endpoint, said in a line.
 */
const KEY_PAGES: readonly { name: string; href: string }[] = [
  { name: "OpenRouter", href: "https://openrouter.ai/keys" },
  { name: "Anthropic", href: "https://console.anthropic.com/settings/keys" },
];

interface Props {
  free: FreeAi;
  /** Open Model settings, to paste a key. */
  onAddKey: () => void;
  /** A key the person already has in Model settings, by its engine's name: then the first button uses it. */
  ownKey?: { label: string; use: () => void };
  /**
   * Called as the person leaves for the gallery, in this tab (#487): keep what the page holds. `true`
   * (or nothing): go now. A promise: the Studio is asking first (something here would be lost), and
   * the page goes only when it settles `true`.
   */
  onLeave?: () => boolean | void | Promise<boolean>;
  /** What is waiting in the box, to be sent once an engine can make it. */
  request?: string;
}

/** The request as one line: what the box holds, its line breaks and runs of spaces made single spaces. */
export function askedLine(request: string | undefined): string {
  return (request ?? "").replace(/\s+/g, " ").trim();
}

export function FreePanel({ free, onAddKey, ownKey, onLeave, request }: Props) {
  const { t } = useLingui();
  const asked = askedLine(request);
  const stop = stoppedNow(free);
  const keyName = ownKey?.label ?? "";
  const leave = (e: MouseEvent<HTMLAnchorElement>): void => {
    const go = onLeave?.();
    if (!(go instanceof Promise)) return; // the link goes, as any link does
    e.preventDefault();
    void go.then((yes) => {
      if (yes) openGallery();
    });
  };
  const [plan, setPlan] = useState<string | null>(countedThisMonth("want-plan") ? t`Counted, thanks. Nothing about you was sent.` : null);

  const wantPlan = async (): Promise<void> => {
    const outcome = await countOnce("want-plan");
    setPlan(
      outcome === "sent" || outcome === "already"
        ? t`Counted, thanks. Nothing about you was sent.`
        : outcome === "off"
          ? t`Anonymous counts are off in You, so nothing was sent.`
          : t`Couldn't count it just now. Try again later.`,
    );
  };

  return (
    <section className="k-free-panel" aria-labelledby="k-free-panel-h">
      {asked ? (
        // One line, cut short with an ellipsis when long; the whole of it on hover.
        <p className="k-free-panel-asked" title={asked}>
          <Trans comment="Over the key panel: what the person typed, kept until an app can be made from it; {asked} is their own words">
            You asked for: <span className="k-free-panel-asked-words">{asked}</span>
          </Trans>
        </p>
      ) : null}
      {stop || free.health?.unknown ? (
        <p className="k-free-panel-stop" role="status">
          {stop ? refusalText(stop.code) : freeUnreachable()}
        </p>
      ) : null}
      <h2 id="k-free-panel-h" className="k-free-panel-title">
        {stop ? <Trans>Keep going with a key</Trans> : <Trans>Add a key to make apps</Trans>}
      </h2>
      <p className="k-free-panel-what">
        <Trans>A key connects Potyro to an AI service on your own account. The service charges you for what you use, usually a few cents an app.</Trans>
      </p>
      <p className="k-free-panel-get">
        <span className="k-muted">
          <Trans comment="Followed by links to the services' key pages: OpenRouter, Anthropic">Get a key from</Trans>
        </span>{" "}
        {KEY_PAGES.map((p, i) => (
          <span key={p.name}>
            {i > 0 ? ", " : null}
            <a href={p.href} target="_blank" rel="noopener noreferrer">
              {p.name}
            </a>
          </span>
        ))}
      </p>
      <p className="k-free-panel-other k-muted">
        <Trans comment="After the key links: a server of the person's own that speaks the OpenAI API also works">or any OpenAI-compatible server, in Model settings</Trans>
      </p>
      <div className="k-free-panel-actions">
        {ownKey ? (
          <button type="button" className="k-add k-primary-action" onClick={ownKey.use}>
            <Trans comment="Button: use the key already in Model settings; {keyName} is the service, e.g. OpenRouter">Use your {keyName} key</Trans>
          </button>
        ) : (
          <button type="button" className="k-add k-primary-action" onClick={onAddKey}>
            <Trans comment="Button: open Model settings to paste a key">Add a key</Trans>
          </button>
        )}
        {/* In this tab (gallery-link.ts): the gallery's Make it mine comes back to the tab with your apps. */}
        <a className="k-add k-free-panel-gallery" href={galleryUrl()} onClick={leave}>
          <Trans comment="Link: Potyro's gallery of apps, where one can be made your own with no key">Start from an app in the gallery</Trans>
        </a>
      </div>
      <p className="k-free-panel-plan">
        {free.health?.plan && wantedPlan() ? (
          // "Tell me when the plan exists" (#118): told here, where it was asked, never by mail — no address was taken.
          <a className="k-free-panel-plan-link" href={free.health.plan} target="_blank" rel="noreferrer noopener">
            <Trans comment="Link: the paid plan this person once asked for now exists; the link opens its page">The plan you asked for exists now.</Trans>
          </a>
        ) : plan ? (
          <span className="k-muted" role="status">
            {plan}
          </span>
        ) : (
          <button type="button" className="k-free-panel-plan-btn" onClick={() => void wantPlan()}>
            <Trans comment="Button: counts, anonymously, one more person who would pay for a plan; nothing is asked and nothing is promised back">I'd pay for a plan</Trans>
          </button>
        )}
      </p>
    </section>
  );
}
