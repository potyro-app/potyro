// How to use an app, said by the app (#80).
//
// A person describes an app, gets it, and has to experiment to learn how it works; someone who was
// sent it never saw the conversation that made it. The app carries the answer (`guide` in
// `defineApp`: a few steps, words like the rest of its words), and the shell shows it twice:
//
//   - the first time the app is opened on this device, as a card at the top of the page. It is part
//     of the page, not a dialog: it never covers a question the app or Potyro is asking (trust, a
//     permission, joining), takes no focus, and stays until it is closed. Closed once, it does not
//     come back by itself.
//   - whenever it is asked for, from the app's menu ("How to use it"), as a dialog.
//
// The steps are data, never code, and a shared app's are a stranger's words: they are drawn as text
// (React escapes it; nothing here reads markup or makes a link) after `guideSteps` has clamped them.

import { useEffect, useId, useRef } from "react";
import { Trans } from "@lingui/react/macro";

/** Whether this device has closed the guide of app `appId` (a namespace-scoped key: erase-app-data.ts removes it). */
export const guideSeenKey = (appId: string): string => `potyro:guide-seen:user:${appId}`;

export function guideSeen(appId: string, storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): boolean {
  try {
    return storage?.getItem(guideSeenKey(appId)) != null;
  } catch {
    // Storage that cannot be read cannot remember either: better never to show the card than to
    // show it on every open.
    return true;
  }
}

export function markGuideSeen(appId: string, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(guideSeenKey(appId), "1");
  } catch {
    /* it shows once more next time; nothing else depends on it */
  }
}

function Steps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="k-guide-steps" role="list">
      {steps.map((step, i) => (
        <li key={i} className="k-guide-step">
          <span className="k-guide-step-text">{step}</span>
        </li>
      ))}
    </ol>
  );
}

/** The first-open card: in the page's flow, above its content. */
export function GuideCard({ steps, onClose }: { steps: readonly string[]; onClose: () => void }) {
  const title = useId();
  if (!steps.length) return null;
  return (
    <section className="k-guide-card" aria-labelledby={title}>
      <h2 id={title} className="k-guide-title">
        <Trans comment="Heading over an app's own short guide: the steps to use it">How to use it</Trans>
      </h2>
      <Steps steps={steps} />
      <div className="k-guide-actions">
        <button type="button" className="k-add k-guide-close" onClick={onClose}>
          <Trans comment="Button that closes an app's guide for good; it stays in the app's menu">Got it</Trans>
        </button>
      </div>
    </section>
  );
}

/** The same steps, asked for from the app's menu: a dialog, closed by its button, Escape or a tap outside. */
export function GuideSheet({ name, steps, onClose }: { name: string; steps: readonly string[]; onClose: () => void }) {
  const title = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Focus goes into the dialog, and back to where it was (the menu's button) when it closes.
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, []);
  return (
    <div className="k-modal-scrim k-guide-scrim" onClick={onClose}>
      <div
        className="k-modal k-guide-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          onClose();
        }}
      >
        <h2 id={title} className="k-guide-title">
          <Trans comment="Heading over an app's own short guide: the steps to use it">How to use it</Trans>
        </h2>
        <p className="k-guide-app">{name}</p>
        <Steps steps={steps} />
        <div className="k-form-actions">
          <button ref={closeRef} type="button" className="k-add k-primary-action" onClick={onClose}>
            <Trans comment="Button that closes a dialog">Close</Trans>
          </button>
        </div>
      </div>
    </div>
  );
}
