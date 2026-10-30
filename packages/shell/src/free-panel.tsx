// The Studio when no engine can make an app (#455): no free app making here (or it is used up, or
// paused), and no key of the person's own. A disabled send button and "needs an API key" said nothing
// about what a key is or where to get one; this says it in a few lines, and offers the path that needs
// nothing at all: an app from the gallery, made your own.
//
// When it is here because free app making stopped, that comes first, in the relay's terms said as
// words (free-ai.ts `refusalText`). "Tell me when there is a paid plan" is a count and nothing more
// (demand-counts.ts, #118): no email, nothing about the person.

import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { galleryUrl } from "./gallery-link.js";
import { freeUnreachable, refusalText, type FreeAi, stoppedNow } from "./free-ai.js";
import { countOnce, countedThisMonth } from "./demand-counts.js";

/** Where each service hands out keys. Names are the services' own. */
const KEY_PAGES: readonly { name: string; href: string }[] = [
  { name: "OpenRouter", href: "https://openrouter.ai/keys" },
  { name: "Anthropic", href: "https://console.anthropic.com/settings/keys" },
  { name: "OpenAI", href: "https://platform.openai.com/api-keys" },
];

interface Props {
  free: FreeAi;
  /** Open Model settings, to paste a key. */
  onAddKey: () => void;
  /** A key the person already has in Model settings, by its engine's name: then the first button uses it. */
  ownKey?: { label: string; use: () => void };
}

export function FreePanel({ free, onAddKey, ownKey }: Props) {
  const { t } = useLingui();
  const stop = stoppedNow(free);
  const keyName = ownKey?.label ?? "";
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
          <Trans comment="Followed by links to the services' key pages: OpenRouter, Anthropic, OpenAI">Get a key from</Trans>
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
        <a className="k-add k-free-panel-gallery" href={galleryUrl()} target="_blank" rel="noopener">
          <Trans comment="Link: Potyro's gallery of apps, where one can be made your own with no key">Start from an app in the gallery</Trans>
        </a>
      </div>
      <p className="k-free-panel-plan">
        {plan ? (
          <span className="k-muted" role="status">
            {plan}
          </span>
        ) : (
          <button type="button" className="k-free-panel-plan-btn" onClick={() => void wantPlan()}>
            <Trans comment="Button: count one more person who wants a paid plan; no email is asked">Tell me when there is a paid plan</Trans>
          </button>
        )}
      </p>
    </section>
  );
}
