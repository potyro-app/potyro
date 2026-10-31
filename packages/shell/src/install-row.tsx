// The You panel's line about the home screen and offline use (#123). When it shows is
// install-offer.ts and offline-ready.ts; this is only what it says.
//
// Two rows, never both: "Add Potyro to your home screen" while that is on offer, and once Potyro is
// on the home screen, one about keeping it for offline use. Neither claims more than is kept: until
// the worker reports every file kept, only Home and the apps already opened work offline.

import { Glyph } from "@potyro/views";
import { Trans, useLingui } from "@lingui/react/macro";
import { acceptInstall, dismissInstall, useInstallOffer, useOnHomeScreen } from "./install-offer.js";
import { keepOffline, useOfflineState, type OfflineState } from "./offline-ready.js";

/** What works offline right now, in words that claim no more than that. */
function OfflineWords({ offline }: { offline: OfflineState }) {
  if (offline.status === "ready") return <Trans>Everything works offline.</Trans>;
  if (offline.failed) return <Trans>Not everything downloaded. Try again when you have a good connection.</Trans>;
  return <Trans>Home and the apps you have opened work offline.</Trans>;
}

/** The button that fetches the rest, while there is a rest to fetch. */
function KeepOfflineButton({ offline }: { offline: OfflineState }) {
  if (offline.status === "none" || offline.status === "ready") return null;
  const busy = offline.status === "warming";
  return (
    <button type="button" className="k-add" disabled={busy} onClick={keepOffline}>
      {busy ? (
        <Trans comment="Button, while Potyro's files download for offline use">Getting ready offline…</Trans>
      ) : (
        <Trans comment="Button: download the rest of Potyro so every app works without a connection. MB is megabytes">
          Keep Potyro ready offline (about 40 MB)
        </Trans>
      )}
    </button>
  );
}

export function InstallRow() {
  const { t } = useLingui();
  const offer = useInstallOffer();
  const onHomeScreen = useOnHomeScreen();
  const offline = useOfflineState();

  if (!offer) {
    if (!onHomeScreen || offline.status === "none") return null;
    return (
      <div className="k-identity-install" role="group" aria-label={t`Offline`}>
        <span aria-hidden>
          <Glyph icon="cloud-off" size={20} />
        </span>
        <div className="k-identity-install-text">
          <b>
            <Trans comment="Heading of the row about using Potyro without a connection">Offline</Trans>
          </b>
          <small className="k-muted" role="status">
            <OfflineWords offline={offline} />
          </small>
        </div>
        <div className="k-identity-install-actions">
          <KeepOfflineButton offline={offline} />
        </div>
      </div>
    );
  }

  return (
    <div className="k-identity-install" role="group" aria-label={t`Add Potyro to your home screen`}>
      <span aria-hidden>
        <Glyph icon="house-plus" size={20} />
      </span>
      <div className="k-identity-install-text">
        <b>
          <Trans>Add Potyro to your home screen</Trans>
        </b>
        {offer === "ios" ? (
          <small className="k-muted">
            <Trans comment="Safari on iPhone/iPad. Share and Add to Home Screen are what Safari itself calls the button and the menu entry: use the names Safari shows in your language">
              Tap Share, then “Add to Home Screen”. It opens like an app.
            </Trans>
          </small>
        ) : (
          <small className="k-muted" role="status">
            <Trans>It opens like an app.</Trans>
            {offline.status === "none" ? null : (
              <>
                {" "}
                <OfflineWords offline={offline} />
              </>
            )}
          </small>
        )}
      </div>
      <div className="k-identity-install-actions">
        {offer === "prompt" ? (
          <button type="button" className="k-add" onClick={() => void acceptInstall()}>
            <Trans comment="Button: add Potyro to the home screen">Add</Trans>
          </button>
        ) : null}
        {offer === "prompt" ? <KeepOfflineButton offline={offline} /> : null}
        <button type="button" className="k-identity-install-no" onClick={dismissInstall}>
          <Trans comment="Button: stop offering to add Potyro to the home screen on this device">No thanks</Trans>
        </button>
      </div>
    </div>
  );
}
