// The You panel's one line about adding Potyro to the home screen (#123). The rule for when it shows
// is install-offer.ts; this is only what it says.

import { Glyph } from "@potyro/views";
import { Trans, useLingui } from "@lingui/react/macro";
import { acceptInstall, dismissInstall, useInstallOffer } from "./install-offer.js";

export function InstallRow() {
  const { t } = useLingui();
  const offer = useInstallOffer();
  if (!offer) return null;
  return (
    <div className="k-identity-install" role="group" aria-label={t`Add Potyro to your home screen`}>
      <span aria-hidden>
        <Glyph icon="house-plus" size={20} />
      </span>
      <div className="k-identity-install-text">
        <b>
          <Trans>Add Potyro to your home screen</Trans>
        </b>
        <small className="k-muted">
          {offer === "ios" ? (
            <Trans comment="Safari on iPhone/iPad. Share and Add to Home Screen are what Safari itself calls the button and the menu entry: use the names Safari shows in your language">
              Tap Share, then “Add to Home Screen”. It opens like an app and works offline.
            </Trans>
          ) : (
            <Trans>It opens like an app and works offline.</Trans>
          )}
        </small>
      </div>
      <div className="k-identity-install-actions">
        {offer === "prompt" ? (
          <button type="button" className="k-add" onClick={() => void acceptInstall()}>
            <Trans comment="Button: add Potyro to the home screen">Add</Trans>
          </button>
        ) : null}
        <button type="button" className="k-identity-install-no" onClick={dismissInstall}>
          <Trans comment="Button: stop offering to add Potyro to the home screen on this device">No thanks</Trans>
        </button>
      </div>
    </div>
  );
}
