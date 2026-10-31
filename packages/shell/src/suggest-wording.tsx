// You → Language: "Something reads wrong? Suggest a better wording" (#300).
//
// Three plain steps, inside the Language section rather than a dialog over a dialog:
//   1. Which words? The ones on the screen behind the panel (and the panel's own) are listed first,
//      read off the page when the form opens; typing finds any other of Potyro's messages, by how it
//      reads now or by its English.
//   2. The words as they are now (and in English, when they are not English), and a box for the
//      person's own wording.
//   3. Sent, or saved on this device until Potyro can reach the team (the relay is not deployed yet,
//      wording-suggestions.ts). Nothing is sent before Send.
//
// Only Potyro's own words can be picked: an app's words are its author's, and are changed in the
// Studio.

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { catalogMessages, findMessages, messagesShown, useLocale, type CatalogMessage } from "@potyro/i18n";
import { sendSaved, type SendResult } from "./platform-requests.js";
import { screenTexts, sendWording, wordingRequest, WORDING_MAX } from "./wording-suggestions.js";
import { LegalLink } from "./legal-links.js";

/** How many of the screen's messages, or of a search's, are offered at once (the list scrolls). */
const SHOWN = 12;

type Step = { kind: "pick" } | { kind: "write"; message: CatalogMessage } | { kind: "done"; result: SendResult };

export function SuggestWording() {
  const [open, setOpen] = useState(false);

  // A suggestion kept on this device earlier goes as soon as Potyro can reach the team.
  useEffect(() => {
    void sendSaved(() => {}, { only: (p) => p.kind === "translation" }).catch(() => {});
  }, []);

  if (!open) {
    return (
      <button type="button" className="k-wording-open" onClick={() => setOpen(true)}>
        <Trans comment="Link under the language picker: report a bad translation of Potyro's own words">Something reads wrong? Suggest a better wording</Trans>
      </button>
    );
  }
  return <WordingForm onClose={() => setOpen(false)} />;
}

function WordingForm({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const locale = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [query, setQuery] = useState("");
  const [wording, setWording] = useState("");
  const [busy, setBusy] = useState(false);
  const [onScreen, setOnScreen] = useState<CatalogMessage[]>([]);

  const all = useMemo(() => catalogMessages(), [locale]);
  // The screen as it was when the form opened: the page behind the panel, then the panel.
  useEffect(() => {
    if (!globalThis.document) return;
    const panel = root.current?.closest('[role="dialog"]') ?? null;
    setOnScreen(messagesShown(screenTexts(document.body, root.current, panel), all));
  }, [all]);

  const found = query.trim() ? findMessages(query, all, SHOWN) : onScreen.slice(0, SHOWN);
  const choose = (m: CatalogMessage): void => {
    setWording(m.seen ?? (m.text.includes("…") ? "" : m.text));
    setStep({ kind: "write", message: m });
  };

  const send = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (step.kind !== "write" || !wording.trim() || busy) return;
    setBusy(true);
    try {
      setStep({ kind: "done", result: await sendWording(wordingRequest(step.message, wording, locale)) });
    } finally {
      setBusy(false);
    }
  };

  const again = (): void => {
    setQuery("");
    setWording("");
    setStep({ kind: "pick" });
  };

  return (
    <div className="k-wording" ref={root} role="group" aria-labelledby="k-wording-h">
      <div className="k-wording-head">
        <h4 id="k-wording-h">
          <Trans comment="Heading of the small form for reporting a bad translation">Suggest a better wording</Trans>
        </h4>
        <button type="button" className="k-add" onClick={onClose} aria-label={t({ message: "Close the suggestion", comment: "Closes the better-wording form" })}>
          ✕
        </button>
      </div>

      {step.kind === "pick" ? (
        <>
          <label className="k-wording-label" htmlFor="k-wording-find">
            <Trans comment="Better-wording form: the first step, choosing the words that read wrong">Which words read wrong?</Trans>
          </label>
          <input
            id="k-wording-find"
            className="k-wording-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t({ message: "Type a few of the words", comment: "Better-wording form: search box for Potyro's own words" })}
          />
          {!query.trim() && found.length ? (
            <p className="k-muted k-wording-hint">
              <Trans comment="Better-wording form: above the list of Potyro's words found on the screen">On this screen:</Trans>
            </p>
          ) : null}
          {found.length ? (
            <ul className="k-wording-list">
              {found.map((m) => (
                <li key={m.id}>
                  <button type="button" className="k-wording-pick" onClick={() => choose(m)}>
                    {m.seen ?? m.text}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="k-muted k-wording-hint">
              {query.trim() ? (
                <Trans comment="Better-wording form: a search found none of Potyro's words">None of Potyro's words match that.</Trans>
              ) : (
                <Trans comment="Better-wording form: nothing found on the screen; search instead">Type a few of the words to find them.</Trans>
              )}
            </p>
          )}
        </>
      ) : step.kind === "write" ? (
        <form onSubmit={(e) => void send(e)}>
          <p className="k-wording-label">
            <Trans comment="Better-wording form: the words as they read today">Now it says:</Trans>
          </p>
          <blockquote className="k-wording-now">{step.message.seen ?? step.message.text}</blockquote>
          {locale !== "en" && step.message.english !== step.message.text ? (
            <p className="k-muted k-wording-english">
              <Trans comment="Better-wording form: the same words in English, for comparison">In English: {step.message.english}</Trans>
            </p>
          ) : null}
          <label className="k-wording-label" htmlFor="k-wording-text">
            <Trans comment="Better-wording form: the box for the person's own wording">How should it read?</Trans>
          </label>
          <textarea
            id="k-wording-text"
            className="k-wording-input"
            rows={3}
            maxLength={WORDING_MAX}
            value={wording}
            onChange={(e) => setWording(e.target.value)}
            autoFocus
          />
          <p className="k-muted k-wording-hint">
            <Trans comment="Better-wording form: what is sent, and that it is posted publicly on GitHub">Only these words and yours go, posted publicly on GitHub. Nothing about you or your apps goes with them.</Trans>
          </p>
          <LegalLink section="requests" block>
            <Trans comment="Better-wording form: link to the privacy page's section on requests and suggestions">How suggestions are kept, and how to remove one</Trans>
          </LegalLink>
          <div className="k-wording-actions">
            <button type="button" className="k-add" onClick={again}>
              <Trans comment="Better-wording form: back to choosing the words">Back</Trans>
            </button>
            <button type="submit" className="k-add k-wording-send" disabled={busy || !wording.trim() || wording.trim() === (step.message.seen ?? step.message.text)}>
              <Trans comment="Better-wording form: send the suggestion">Send</Trans>
            </button>
          </div>
        </form>
      ) : (
        <div role="status">
          <p className="k-wording-result">
            {step.result.state === "sent" ? (
              <Trans comment="Better-wording form: the suggestion reached the Potyro team">Thank you — it is with the Potyro team.</Trans>
            ) : step.result.state === "saved" ? (
              <Trans comment="Better-wording form: could not be sent now; kept and sent later">Thank you. It is saved on this device and will be sent when Potyro can reach the team.</Trans>
            ) : (
              <Trans comment="Better-wording form: the team's inbox refused it">That could not be sent.</Trans>
            )}
          </p>
          <div className="k-wording-actions">
            <button type="button" className="k-add" onClick={again}>
              <Trans comment="Better-wording form: start again for other words">Suggest another</Trans>
            </button>
            <button type="button" className="k-add" onClick={onClose}>
              <Trans comment="Better-wording form: finish">Done</Trans>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
