// Edit a tile (#83): what THIS device calls an app, what it shows for it, and what colour it is.
//
// The author chose a name, an icon and an accent (#82); the person using the app may want
// "Mum's recipes" and a 🥘. These are launcher-level overrides on the launcher entry (#81): they
// never touch the app's source or its record, so a shared app keeps its declared identity for the
// people it is shared with, and the app's own header keeps saying what the app says. One rule, so
// it is predictable: the override is the tile's, and only the tile's.

import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Trans, useLingui } from "@lingui/react/macro";
import { updateEntry, type InstalledApp } from "./launcher-store.js";
import { TILE_HUES, hueColour, tileIdentity } from "./tile-identity.js";
import { askEnabled, setAskEnabled } from "./ask-setting.js";
import { aiStanding, setAiStanding, type AiStanding } from "./ai-setting.js";
import { formatSpend, spentIn } from "./ask-spend.js";
import { LiveConnectionsSetting, liveRows, saveLiveRows, type LiveRow } from "./live-connections-setting.js";
import { fmt } from "@potyro/i18n";

const hueNumber = (h: number): string => fmt.number(h);

/** A curated grid; free text takes anything else. No dependency, no picker to load. */
const ICONS = ["🍳", "🥘", "🛒", "🌱", "🪴", "📍", "🗺️", "🏋", "🏃", "🚴", "📚", "✏️", "💰", "🧾", "✈️", "🏡", "🐶", "🐱", "🎹", "🎵", "🎬", "📷", "☕", "🧘", "💊", "🗓️", "✅", "🎁"];

interface Props {
  app: InstalledApp;
  onClose: () => void;
}

export function TileEditor({ app, onClose }: Props) {
  const { t } = useLingui();
  const declaredName = app.user.name;
  const declaredIcon = app.entry.identity?.icon;
  const [name, setName] = useState(app.entry.displayName ?? "");
  const [icon, setIcon] = useState(app.entry.icon ?? "");
  const [hue, setHue] = useState<number | undefined>(app.entry.hue);
  // Ask (#213) is turned off from inside the app; this is where it comes back.
  const [ask, setAsk] = useState(() => askEnabled(app.id));
  // The app's own AI (docs/23): shown once the app has used it or been allowed to, with what it cost.
  const [ai, setAi] = useState<AiStanding | undefined>(() => aiStanding(app.id));
  const aiSpent = spentIn(app.id, "ai");
  const aiSpentWords = formatSpend(aiSpent);
  // Live connections (docs/28): shown once the app was allowed one, with a switch each.
  const [live, setLive] = useState<LiveRow[]>(() => liveRows(app.id));

  const appName = app.name;
  const preview = tileIdentity({ key: app.key, name: name.trim() || declaredName, icon: icon.trim() || declaredIcon, accent: app.accent, hue });

  const save = (): void => {
    updateEntry(app.key, {
      displayName: name.trim() || undefined,
      icon: icon.trim() || undefined,
      hue,
    });
    setAskEnabled(app.id, ask);
    if (ai !== undefined) setAiStanding(app.id, ai);
    saveLiveRows(app.id, live);
    onClose();
  };

  // On the page itself: opened from the switcher (a drawer over an open app), it must not be placed —
  // or clipped — by the drawer.
  return createPortal(
    <div className="k-modal-scrim k-tile-editor-scrim" onClick={onClose}>
      <div className="k-modal k-tile-editor" role="dialog" aria-modal="true" aria-label={t`Edit tile: ${appName}`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <header className="k-tile-editor-head">
          <div>
            <h2>
              <Trans>Edit tile</Trans>
            </h2>
            <p className="k-muted">
              <Trans>On this device only. The app itself keeps its own name and look.</Trans>
            </p>
          </div>
          <div className="k-tile-editor-preview" style={{ "--tile-accent": preview.accent } as CSSProperties} aria-hidden>
            <span className="k-launch-avatar" data-kind={preview.kind}>{preview.glyph}</span>
            <span className="k-launch-name">{name.trim() || declaredName}</span>
          </div>
        </header>

        <div className="k-tile-editor-field">
          <span className="k-field-label" id="k-tile-editor-name">
            <Trans comment="Tile editor: the name shown on the launcher tile">Name</Trans>
          </span>
          <span className="k-tile-editor-row">
            <input className="k-input" value={name} placeholder={declaredName} aria-label={t`Tile name`} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="k-add" disabled={!name} onClick={() => setName("")} aria-label={t`Reset name`} title={t`Back to the app's own name`}>
              <Trans comment="Tile editor: undo this device's override">Reset</Trans>
            </button>
          </span>
        </div>

        <div className="k-tile-editor-field">
          <span className="k-field-label" id="k-tile-editor-icon">
            <Trans comment="Tile editor: the emoji or letters shown on the tile">Icon</Trans>
          </span>
          <span className="k-tile-editor-row">
            <input className="k-input k-tile-editor-icon-input" value={icon} placeholder={declaredIcon ?? t({ message: "monogram", comment: "Tile editor placeholder: with no icon the tile shows the name's first letters" })} aria-label={t`Tile icon`} maxLength={8} onChange={(e) => setIcon(e.target.value)} />
            <button type="button" className="k-add" disabled={!icon} onClick={() => setIcon("")} aria-label={t`Reset icon`} title={t`Back to the app's own icon`}>
              <Trans comment="Tile editor: undo this device's override">Reset</Trans>
            </button>
          </span>
          <div className="k-tile-editor-icons" role="group" aria-labelledby="k-tile-editor-icon">
            {ICONS.map((i) => (
              <button key={i} type="button" className="k-tile-editor-swatch" aria-pressed={icon === i} aria-label={t`Icon ${i}`} onClick={() => setIcon(i)}>
                {i}
              </button>
            ))}
          </div>
        </div>

        <div className="k-tile-editor-field">
          <span className="k-field-label" id="k-tile-editor-colour">
            <Trans>Colour</Trans>
          </span>
          <div className="k-tile-editor-hues" role="group" aria-labelledby="k-tile-editor-colour">
            <button
              type="button"
              className="k-tile-editor-swatch k-tile-editor-hue"
              style={{ "--swatch": tileIdentity({ key: app.key, name: declaredName, accent: app.accent }).accent } as CSSProperties}
              aria-pressed={hue === undefined}
              aria-label={t`The app's own colour`}
              title={t`The app's own colour`}
              onClick={() => setHue(undefined)}
            >
              <span className="k-tile-editor-own">A</span>
            </button>
            {TILE_HUES.map((h) => (
              <button
                key={h}
                type="button"
                className="k-tile-editor-swatch k-tile-editor-hue"
                style={{ "--swatch": hueColour(h) } as CSSProperties}
                aria-pressed={hue === h}
                aria-label={t`Hue ${hueNumber(h)}`}
                onClick={() => setHue(h)}
              />
            ))}
          </div>
        </div>

        <label className="k-tile-editor-ask">
          <input type="checkbox" checked={ask} onChange={(e) => setAsk(e.target.checked)} />
          <span>
            <span className="k-field-label">
              <Trans comment="Tile editor: the AI feature called Ask">Ask</Trans>
            </span>
            <span className="k-muted">
              <Trans>Offer “Ask” in this app, to add records with AI.</Trans>
            </span>
          </span>
        </label>

        {ai !== undefined ? (
          <label className="k-tile-editor-ask">
            <input type="checkbox" checked={ai === "on"} onChange={(e) => setAi(e.target.checked ? "on" : "off")} />
            <span>
              <span className="k-field-label">
                <Trans comment="Tile editor: the app's own use of AI (ctx.caps.ai)">AI</Trans>
              </span>
              <span className="k-muted">
                <Trans>Let this app send what it asks about — a photo, some text — to an AI service.</Trans>
              </span>
              {aiSpent > 0 ? <span className="k-muted">{t`AI in this app has used ${aiSpentWords} of your OpenRouter credit on this device.`}</span> : null}
            </span>
          </label>
        ) : null}

        <LiveConnectionsSetting rows={live} onChange={setLive} />

        <div className="k-form-actions">
          <button type="button" className="k-add" onClick={onClose}>
            <Trans>Cancel</Trans>
          </button>
          <button type="button" className="k-add k-primary-action" onClick={save}>
            <Trans>Save</Trans>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
