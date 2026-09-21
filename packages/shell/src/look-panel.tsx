// The Look panel: light or dark, and the colour the shell wears.
//
// A whole-device choice, so it lives with the device — in the launcher, beside who you are — rather
// than inside whichever app happens to be open.

import { TILE_HUES, hueColour } from "./tile-identity.js";
import { setLook, useLook, type Appearance } from "./look.js";

const MODES: Array<{ id: Appearance; label: string; detail: string }> = [
  { id: "system", label: "System", detail: "Follows this device" },
  { id: "light", label: "Light", detail: "Always light" },
  { id: "dark", label: "Dark", detail: "Always dark" },
];

export function LookPanel({ onClose }: { onClose: () => void }) {
  const look = useLook();
  return (
    <div className="k-modal-scrim" onClick={onClose}>
      <div className="k-modal k-look" role="dialog" aria-modal="true" aria-label="Look" onClick={(e) => e.stopPropagation()}>
        <header className="k-identity-head">
          <h2>Look</h2>
          <button type="button" className="k-add" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <h3 className="k-field-label">Appearance</h3>
        <div className="k-look-modes" role="radiogroup" aria-label="Appearance">
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
              <strong>{mode.label}</strong>
              <span className="k-muted">{mode.detail}</span>
            </button>
          ))}
        </div>

        <h3 className="k-field-label">Accent</h3>
        <div className="k-look-hues" role="radiogroup" aria-label="Accent colour">
          {/* Karta's own gold, which is what "no choice" means — offered as a swatch so choosing it
              back is a tap rather than a thing you cannot undo. */}
          <button
            type="button"
            role="radio"
            aria-checked={look.accent === undefined}
            aria-label="Karta gold"
            className="k-look-hue k-look-hue-default"
            data-on={look.accent === undefined || undefined}
            onClick={() => setLook({ appearance: look.appearance })}
          />
          {TILE_HUES.map((hue) => (
            <button
              key={hue}
              type="button"
              role="radio"
              aria-checked={look.accent === hue}
              aria-label={`Accent hue ${hue}`}
              className="k-look-hue"
              data-on={look.accent === hue || undefined}
              style={{ background: hueColour(hue) }}
              onClick={() => setLook({ ...look, accent: hue })}
            />
          ))}
        </div>
        <p className="k-muted">
          Used by the launcher and the Studio, and by any app that has not been given a colour of its own — an app’s
          colour is on its tile, under <strong>Edit tile</strong>.
        </p>
      </div>
    </div>
  );
}
