// "Potyro can't do this yet" — a request to the Potyro team, on the Studio's conversation (#263).
//
// The agent wrote it in the person's words. The card shows it, and offers to send it. Sending is
// two taps on purpose: the first shows EXACTLY what will be sent — the request, and the app's
// structure with its code shown as markers, never its entries — and only the second sends it.
// After that the card says what came of it: sent, or kept on this device to send later.

import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PlatformRequestPayload } from "@potyro/platform-requests";
import type { PlatformAsk, SentRequest } from "./studio-chat.js";

export interface PlatformRequestCardProps {
  ask: PlatformAsk;
  /** What came of sending it, when it was sent or saved. */
  sent?: SentRequest;
  /** What will be sent, built from the app as it is now. */
  review: () => Promise<PlatformRequestPayload>;
  onSend: (payload: PlatformRequestPayload) => Promise<void>;
}

type Step = { kind: "idle" } | { kind: "loading" } | { kind: "review"; payload: PlatformRequestPayload } | { kind: "sending" };

export function PlatformRequestCard({ ask, sent, review, onSend }: PlatformRequestCardProps) {
  const { t } = useLingui();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const open = async (): Promise<void> => {
    setStep({ kind: "loading" });
    try {
      setStep({ kind: "review", payload: await review() });
    } catch {
      setStep({ kind: "idle" });
    }
  };
  const send = async (payload: PlatformRequestPayload): Promise<void> => {
    setStep({ kind: "sending" });
    try {
      await onSend(payload);
    } finally {
      setStep({ kind: "idle" });
    }
  };
  const done = sent?.state === "sent";

  return (
    <article className="k-ask-card" aria-label={t`Potyro can't do this yet`} data-sent={sent?.state}>
      <p className="k-ask-card-head">
        <Trans comment="Studio: a card offering to send what the person asked for to the people who make Potyro">Potyro can't do this yet</Trans>
      </p>
      <p className="k-ask-card-lede">
        <Trans>What you asked for, as a request to the people who make Potyro:</Trans>
      </p>
      <blockquote className="k-ask-card-request">
        <p className="k-ask-card-title">{ask.title}</p>
        <p>{ask.body}</p>
      </blockquote>

      {step.kind === "review" ? (
        <div className="k-ask-card-review" role="group" aria-label={t`What will be sent`}>
          <p className="k-ask-card-lede">
            <Trans>This is exactly what will be sent: the request above, and how your app is put together.</Trans>
          </p>
          <details className="k-ask-card-structure">
            <summary>
              <Trans>How your app is put together</Trans>
            </summary>
            <p>
              <Trans>Its lists, fields and pages. None of your entries are in it, and its code is left out — each piece shows as “(a function)”.</Trans>
            </p>
            <pre>{step.payload.structure || t`(nothing could be read from the app)`}</pre>
          </details>
          <p className="k-ask-card-note">
            <Trans>It goes on a public list of requests the Potyro team reads, without your name. No account needed.</Trans>
          </p>
          <div className="k-card-actions">
            <button type="button" className="k-card-open" onClick={() => void send(step.payload)}>
              <Trans>Send</Trans>
            </button>
            <button type="button" className="k-card-back" onClick={() => setStep({ kind: "idle" })}>
              <Trans>Not now</Trans>
            </button>
          </div>
        </div>
      ) : done ? (
        <p className="k-ask-card-state" role="status">
          <Trans>Sent to the Potyro team. If they add it, you'll hear about it here.</Trans>{" "}
          {sent?.url ? (
            <a href={sent.url} target="_blank" rel="noreferrer noopener">
              <Trans>See the request</Trans>
            </a>
          ) : null}
        </p>
      ) : (
        <>
          {sent?.state === "saved" ? (
            <p className="k-ask-card-state" role="status">
              <Trans>Couldn't send it yet. It's saved on this device and will be sent later.</Trans>
            </p>
          ) : null}
          <div className="k-card-actions">
            <button type="button" className="k-card-open" disabled={step.kind !== "idle"} onClick={() => void open()}>
              {step.kind === "sending" ? t`Sending` : sent?.state === "saved" ? t`Try sending again` : t`Send to the Potyro team`}
            </button>
          </div>
        </>
      )}
    </article>
  );
}
