// The Look panel: light or dark, and the colour the shell wears.
//
// A whole-device choice, so it lives with the device — in the launcher, beside who you are — rather
// than inside whichever app happens to be open.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { fmt } from "@potyro/i18n";
import { HORAS } from "@potyro/design";
import { tracoOf } from "./app-colour.js";
import { setLook, useLook, type Appearance, type LauncherStyle } from "./look.js";
import { useEffect, useState } from "react";

const HOURS = HORAS.filter((h) => h.hora !== 12).map((h) => h.hue);

const MODES: Array<{ id: Appearance; label: MessageDescriptor; detail: MessageDescriptor }> = [
  { id: "system", label: msg({ message: "System", comment: "Appearance: follow the device's light/dark setting" }), detail: msg`Follows this device` },
  { id: "light", label: msg({ message: "Light", comment: "Appearance" }), detail: msg`Always light` },
  { id: "dark", label: msg({ message: "Dark", comment: "Appearance" }), detail: msg`Always dark` },
];

const STYLES: Array<{ id: LauncherStyle; label: MessageDescriptor; detail: MessageDescriptor }> = [
  { id: "classic", label: msg({ message: "Classic", comment: "Home screen style: Potyro's list of app cards" }), detail: msg`Your apps as cards, with a pinned row` },
  { id: "start", label: msg({ message: "Tiles", comment: "Home screen style: a wall of coloured tiles you arrange, like Windows Phone's Start" }), detail: msg`A wall of coloured tiles you arrange` },
];

/** Shown once, the first time Look opens after the Tiles style arrived: a line, never a dialog. */
const HINT_KEY = "potyro:look:tiles-hint";
function hintSeen(): boolean {
  try {
    return Boolean(localStorage.getItem(HINT_KEY));
  } catch {
    return true;
  }
}
function markHintSeen(): void {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    /* it shows again next time, which is harmless */
  }
}

/** A small picture of each style, drawn with boxes, so the choice is seen before it is made. */
function StylePreview({ style }: { style: LauncherStyle }) {
  if (style === "classic") {
    return (
      <span className="k-look-preview" data-style="classic" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="k-look-preview-card">
            <span className="k-look-preview-dot" />
            <span className="k-look-preview-line" />
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="k-look-preview" data-style="start" aria-hidden>
      {["wide", "medium", "small", "small", "small", "small"].map((size, i) => (
        <span key={i} className="k-look-preview-tile" data-size={size} data-n={i} />
      ))}
    </span>
  );
}

export function LookPanel({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const look = useLook();
  // Read while rendering, written after: React may render twice, and a write on the first render
  // would hide the hint from the second.
  const [hint] = useState(() => (look.launcher ?? "classic") === "classic" && !hintSeen());
  useEffect(() => markHintSeen(), []);
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
          <Trans comment="Which style the home screen has">Home screen</Trans>
        </h3>
        {hint ? (
          <p className="k-look-hint">
            <Trans>New: try Tiles — your apps as a wall of coloured tiles you size and group. You can come back to Classic any time.</Trans>
          </p>
        ) : null}
        <div className="k-look-styles" role="radiogroup" aria-label={t`Home screen`}>
          {STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              role="radio"
              aria-checked={(look.launcher ?? "classic") === style.id}
              className="k-chip k-look-mode k-look-style"
              data-style={style.id}
              data-on={(look.launcher ?? "classic") === style.id || undefined}
              onClick={() => setLook({ ...look, launcher: style.id })}
            >
              <StylePreview style={style.id} />
              <strong>{t(style.label)}</strong>
              <span className="k-muted">{t(style.detail)}</span>
            </button>
          ))}
        </div>

        <h3 className="k-field-label">
          <Trans comment="The colour the shell wears">Accent</Trans>
        </h3>
        <div className="k-look-hues" role="radiogroup" aria-label={t`Accent colour`}>
          {/* Potyro's own rosa, which is what "no choice" means — offered as a swatch so choosing it
              back is a tap rather than a thing you cannot undo. */}
          <button
            type="button"
            role="radio"
            aria-checked={look.accent === undefined}
            aria-label={t`Potyro pink`}
            className="k-look-hue k-look-hue-default"
            data-on={look.accent === undefined || undefined}
            onClick={() => setLook({ ...look, accent: undefined })}
          />
          {/* The eleven hours of the clock (DESIGN.md §10); 12 o'clock is Potyro's own, the swatch above. */}
          {HOURS.map((hue) => {
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
              style={{ background: tracoOf(hue) }}
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
