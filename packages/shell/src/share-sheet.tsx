// Share (docs/24 §1): two ways, said plainly, the one most people want first.
//
//   A link anyone can try — the app, running, with sample records. Nothing of yours goes with it.
//   Use it together     — an invite into the app AND its records (the existing #join= link, sync on).
import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { DEFAULT_NAME, peekIdentity } from "@potyro/identity";
import { ShareBody } from "./dialog.js";
import type { UserApp } from "./user-apps.js";
import type { MadeDemoLink } from "./demo-share.js";
import { creditLine } from "./credit-words.js";

type State = { kind: "choose" } | { kind: "making" } | { kind: "made"; made: MadeDemoLink } | { kind: "failed"; why: string };

export interface ShareSheetProps {
  app: UserApp;
  onClose: () => void;
  /** Use it together: the invite. Absent where it cannot start from here; the sheet then says where it can. */
  onInvite?: () => void;
}

export function ShareSheet({ app, onClose, onInvite }: ShareSheetProps) {
  const { t } = useLingui();
  const [state, setState] = useState<State>({ kind: "choose" });
  const me = peekIdentity();
  // A kept app is passed on as its maker's (docs/24 §6): there is no "by me" to offer for it.
  const kept = Boolean(app.credit && !app.remixOf);
  const myName = !kept && me && me.name && me.name !== DEFAULT_NAME ? me.name : undefined;
  const madeBy = kept ? creditLine(app.credit) : null;
  const [showName, setShowName] = useState(Boolean(myName));
  const name = app.name;

  const make = async (): Promise<void> => {
    setState({ kind: "making" });
    try {
      const { makeDemoLink } = await import("./demo-share.js");
      setState({ kind: "made", made: await makeDemoLink(app, { by: showName ? myName : undefined }) });
    } catch (e) {
      setState({ kind: "failed", why: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="k-modal-scrim" onClick={state.kind === "making" ? undefined : onClose}>
      <div
        className="k-modal k-share-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t({ message: `Share ${name}`, comment: "The share sheet's title" })}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && state.kind !== "making" && onClose()}
      >
        <header className="k-share-sheet-head">
          <p className="k-ask-eyebrow">
            <Trans comment="Share sheet eyebrow">Share</Trans>
          </p>
          <h2>{name}</h2>
        </header>

        <section className="k-share-way k-share-way-try" aria-labelledby="k-share-try-title">
          <h3 id="k-share-try-title">
            <Trans>A link anyone can try</Trans>
          </h3>
          <p className="k-muted">
            <Trans>It opens the app right away in any browser, with sample records. No account, nothing to install. None of your records go with it.</Trans>
          </p>
          {state.kind === "made" ? (
            <>
              {state.made.hosted ? null : (
                <p className="k-share-note">
                  <Trans>This link carries the whole app, so chats show it without a preview picture.</Trans>
                </p>
              )}
              <ShareBody link={state.made.link} onDone={onClose} onHanded={() => {}} />
            </>
          ) : (
            <>
              {madeBy ? <p className="k-share-note">{madeBy}</p> : null}
              {myName ? (
                <label className="k-share-name">
                  <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} disabled={state.kind === "making"} />
                  <span>
                    <Trans>Say it is by {myName}</Trans>
                  </span>
                </label>
              ) : null}
              {state.kind === "failed" ? (
                <p className="k-add-app-error" role="alert">
                  {state.why}
                </p>
              ) : null}
              <button type="button" className="k-add k-primary-action k-share-make" data-share="demo" disabled={state.kind === "making"} onClick={() => void make()}>
                {state.kind === "making" ? t`Making the link…` : t`Make the link`}
              </button>
            </>
          )}
        </section>

        <section className="k-share-way k-share-way-together" aria-labelledby="k-share-together-title">
          <h3 id="k-share-together-title">
            <Trans>Use it together</Trans>
          </h3>
          <p className="k-muted">
            <Trans>Invite people into this app and its records. What one of you changes, the others see.</Trans>
          </p>
          {onInvite ? (
            <button
              type="button"
              className="k-add"
              data-share="invite"
              disabled={state.kind === "making"}
              onClick={() => {
                onClose();
                onInvite();
              }}
            >
              <Trans>Invite people…</Trans>
            </button>
          ) : (
            <p className="k-muted">
              <Trans>Choose Share on its tile in your apps to invite someone: that turns on sync for it.</Trans>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
