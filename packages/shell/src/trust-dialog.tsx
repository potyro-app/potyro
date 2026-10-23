// The one trust dialog (owner, 2026-10-13: promotion is always reachable after install).
//
// Every place a sealed app can be promoted from opens THIS: the 🛡 badge of an open app, a sealed
// custom screen's "Run it as mine", the screen that says it could not open, the card after it was
// added, its tile on your apps, and the Studio. One confirmation, one wording — a warning that reads
// differently depending on where you tapped would be a warning nobody reads.
//
// It is a dialog for mouse, touch and keyboard alike: focus starts on Cancel (the safe answer),
// Escape cancels, a tap outside cancels.
//
// Promoting needs the person to SAY so. A link is still never trusted on the way in, and a failure
// that promoting would not fix (promotion.ts) never offers this as the way out.

import { permissionWords } from "./capability-words.js";
import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UserApp } from "./user-apps.js";
import { promoteAndOpen } from "./promotion.js";

export interface TrustDialogProps {
  name: string;
  /** What it declares it asks for (its `permissions`); `null` when that cannot be read without running it; `undefined` while reading. */
  permissions: Readonly<Record<string, unknown>> | null | undefined;
  /** It runs as yours already: the dialog offers to put it back in the sealed box. */
  trusted?: boolean;
  onCancel: () => void;
  onPromote: () => void;
  onRevoke?: () => void;
}

export function TrustDialog({ name, permissions, trusted, onCancel, onPromote, onRevoke }: TrustDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  // A permission key (`camera`) is code; the list says what it means, as precisely as it was declared.
  const asks = permissions ? permissionWords(permissions) : [];
  // On the page itself: opened from inside another dialog (the Add an app card) or a menu, it must
  // not be placed — or clipped — by them.
  return createPortal(
    <div className="k-modal-scrim k-trust-scrim" onClick={onCancel}>
      <div
        className="k-modal k-trustdialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="k-trustdialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          onCancel();
        }}
      >
        {trusted ? (
          <>
            <h3 id="k-trustdialog-title">
              <Trans>It runs as yours</Trans>
            </h3>
            <p className="k-muted">
              <Trans>
                <strong>{name}</strong> runs like the apps you made, with the same reach. Put it back in the sealed box to keep it away from the rest of Potyro again.
              </Trans>
            </p>
            <div className="k-form-actions">
              <button ref={cancelRef} type="button" className="k-add" onClick={onCancel}>
                <Trans>Close</Trans>
              </button>
              <button type="button" className="k-add" onClick={onRevoke}>
                <Trans>Put it back in the sealed box</Trans>
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 id="k-trustdialog-title">
              <Trans>Let it run as yours?</Trans>
            </h3>
            <p className="k-muted">
              <Trans>
                In the sealed box it runs and draws its own screens, but reaches your data and this device only through Potyro. Letting it run as yours takes it out of the box, with the same reach as the apps you made. Only do this if you made it, or you know and trust whoever did.{" "}
                <strong>{name}</strong> asks for:
              </Trans>
            </p>
            <ul className="k-trust-caps">
              {permissions === undefined ? (
                <li className="k-muted">…</li>
              ) : permissions === null ? (
                <li className="k-muted">
                  <Trans>what it asks for cannot be read without running it</Trans>
                </li>
              ) : asks.length ? (
                asks.map((c) => <li key={c}>{c}</li>)
              ) : (
                <li className="k-muted">
                  <Trans>no special capabilities</Trans>
                </li>
              )}
            </ul>
            <div className="k-form-actions">
              <button ref={cancelRef} type="button" className="k-add" onClick={onCancel}>
                <Trans>Cancel</Trans>
              </button>
              <button type="button" className="k-add k-primary-action" onClick={onPromote}>
                <Trans>Yes, run it as yours</Trans>
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The dialog for a saved sealed app that is not running — it failed to open, it is a tile, it was
 * just added. What it asks for is read from its source; confirming promotes it and opens it as yours.
 */
export function PromoteDialog({ app, onCancel }: { app: Pick<UserApp, "id" | "name" | "source">; onCancel: () => void }) {
  const [permissions, setPermissions] = useState<Record<string, unknown> | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void import("./app-source.js")
      .then(({ declaredPermissions }) => declaredPermissions(app.source))
      .catch(() => null)
      .then((p) => alive && setPermissions(p));
    return () => {
      alive = false;
    };
  }, [app.source]);
  return <TrustDialog name={app.name} permissions={permissions} onCancel={onCancel} onPromote={() => promoteAndOpen(app.id)} />;
}

/** "Let it run as yours", and the dialog behind it. */
export function PromoteButton({ app, primary }: { app: Pick<UserApp, "id" | "name" | "source">; primary?: boolean }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button type="button" className={primary ? "k-add k-primary-action" : "k-add"} onClick={() => setAsking(true)}>
        <Trans>Let it run as yours</Trans>
      </button>
      {asking ? <PromoteDialog app={app} onCancel={() => setAsking(false)} /> : null}
    </>
  );
}
