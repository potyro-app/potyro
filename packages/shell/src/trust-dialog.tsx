// The one trust dialog (owner, 2026-10-13: promotion is always reachable after install).
//
// Every place a sealed app can be promoted from opens THIS: the 🛡 badge of an open app, a sealed
// custom screen's "Run it as mine…", the screen that says it could not open, the card after it was
// added, its tile on your apps, and the Studio. One confirmation, one wording — a warning that reads
// differently depending on where you tapped would be a warning nobody reads.
//
// It is a dialog for mouse, touch and keyboard alike: focus starts on Cancel (the safe answer),
// Escape cancels, a tap outside cancels.
//
// Promoting needs the person to SAY so. A link is still never trusted on the way in, and a failure
// that promoting would not fix (promotion.ts) never offers this as the way out.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UserApp } from "./user-apps.js";
import { promoteAndOpen } from "./promotion.js";

export interface TrustDialogProps {
  name: string;
  /** What it declares it asks for; `null` when that cannot be read without running it; `undefined` while reading. */
  permissions: readonly string[] | null | undefined;
  /** It runs as yours already: the dialog offers to put it back in the sealed box. */
  trusted?: boolean;
  onCancel: () => void;
  onPromote: () => void;
  onRevoke?: () => void;
}

export function TrustDialog({ name, permissions, trusted, onCancel, onPromote, onRevoke }: TrustDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
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
            <h3 id="k-trustdialog-title">Trusted app</h3>
            <p className="k-muted">
              <strong>{name}</strong> runs directly on this device (not sandboxed). Revoke to run it in the isolate again.
            </p>
            <div className="k-form-actions">
              <button ref={cancelRef} type="button" className="k-add" onClick={onCancel}>Close</button>
              <button type="button" className="k-add" onClick={onRevoke}>Revoke trust</button>
            </div>
          </>
        ) : (
          <>
            <h3 id="k-trustdialog-title">Promote to trusted?</h3>
            <p className="k-muted">
              Trusted apps run <strong>directly</strong> with full access — no sandbox. Only promote an app you wrote or fully trust.{" "}
              <strong>{name}</strong> declares:
            </p>
            <ul className="k-trust-caps">
              {permissions === undefined ? (
                <li className="k-muted">…</li>
              ) : permissions === null ? (
                <li className="k-muted">what it asks for cannot be read without running it</li>
              ) : permissions.length ? (
                permissions.map((c) => <li key={c}>{c}</li>)
              ) : (
                <li className="k-muted">no special capabilities</li>
              )}
            </ul>
            <div className="k-form-actions">
              <button ref={cancelRef} type="button" className="k-add" onClick={onCancel}>Cancel</button>
              <button type="button" className="k-add k-primary-action" onClick={onPromote}>Promote to trusted</button>
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
  const [permissions, setPermissions] = useState<string[] | null | undefined>(undefined);
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
        Let it run as yours
      </button>
      {asking ? <PromoteDialog app={app} onCancel={() => setAsking(false)} /> : null}
    </>
  );
}
