// The Look panel: light or dark, and the colour the shell wears.
//
// A whole-device choice, so it lives with the device — in the launcher, beside who you are — rather
// than inside whichever app happens to be open.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { fmt } from "@potyro/i18n";
import { TILE_HUES, hueColour } from "./tile-identity.js";
import { setLook, useLook, type Appearance } from "./look.js";

const MODES: Array<{ id: Appearance; label: MessageDescriptor; detail: MessageDescriptor }> = [
  { id: "system", label: msg({ message: "System", comment: "Appearance: follow the device's light/dark setting" }), detail: msg`Follows this device` },
  { id: "light", label: msg({ message: "Light", comment: "Appearance" }), detail: msg`Always light` },
  { id: "dark", label: msg({ message: "Dark", comment: "Appearance" }), detail: msg`Always dark` },
];

export function LookPanel({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const look = useLook();
  return (
    <div className="k-modal-scrim" onClick={onClose}>
      <div className="k-modal k-look" role="dialog" aria-modal="true" aria-label={t({ message: "Look", comment: "The panel for light/dark appearance and accent colour" })} onClick={(e) => e.stopPropagation()}>
        <header className="k-identity-head">
          <h2>
            <Trans comment="The panel for light/dark appearance and accent colour">Look</Trans>
          </h2>
          <button type="button" className="k-add" aria-label={t`Close`} onClick={onClose}>
            ✕
          </button>
        </header>

        <h3 className="k-field-label">
          <Trans>Appearance</Trans>
        </h3>
        <div className="k-look-modes" role="radiogroup" aria-label={t`Appearance`}>
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="radio"
              aria-checked={look.appearance === mode.id}
              className="k-chip k-look-mode"
              data-on={look.appearance === mode.id || undefined}
              onClick={() => setLook({ ...look, appearance: mode.id })}
            >
              <strong>{t(mode.label)}</strong>
              <span className="k-muted">{t(mode.detail)}</span>
            </button>
          ))}
        </div>

        <h3 className="k-field-label">
          <Trans comment="The colour the shell wears">Accent</Trans>
        </h3>
        <div className="k-look-hues" role="radiogroup" aria-label={t`Accent colour`}>
          {/* Potyro's own gold, which is what "no choice" means — offered as a swatch so choosing it
              back is a tap rather than a thing you cannot undo. */}
          <button
            type="button"
            role="radio"
            aria-checked={look.accent === undefined}
            aria-label={t`Potyro gold`}
            className="k-look-hue k-look-hue-default"
            data-on={look.accent === undefined || undefined}
            onClick={() => setLook({ appearance: look.appearance })}
          />
          {TILE_HUES.map((hue) => {
            const degrees = fmt.number(hue);
            return (
            <button
              key={hue}
              type="button"
              role="radio"
              aria-checked={look.accent === hue}
              aria-label={t({ message: `Accent hue ${degrees}`, comment: "A colour swatch; the number is the hue on the colour wheel" })}
              className="k-look-hue"
              data-on={look.accent === hue || undefined}
              style={{ background: hueColour(hue) }}
              onClick={() => setLook({ ...look, accent: hue })}
            />
            );
          })}
        </div>
        <p className="k-muted">
          <Trans>
            Used by the launcher and the Studio, and by any app that has not been given a colour of its own — an app’s
            colour is on its tile, under <strong>Edit tile</strong>.
          </Trans>
        </p>
      </div>
    </div>
  );
}
