// Edit a tile (#83): what THIS device calls an app, what it shows for it, and what colour it is.
//
// The author chose a name, an icon and an accent (#82); the person using the app may want
// "Mum's recipes" and a 🥘. These are launcher-level overrides on the launcher entry (#81): they
// never touch the app's source or its record, so a shared app keeps its declared identity for the
// people it is shared with, and the app's own header keeps saying what the app says. One rule, so
// it is predictable: the override is the tile's, and only the tile's.

import { useState, type CSSProperties } from "react";
import { updateEntry, type InstalledApp } from "./launcher-store.js";
import { TILE_HUES, hueColour, tileIdentity } from "./tile-identity.js";

/** A curated grid; free text takes anything else. No dependency, no picker to load. */
const ICONS = ["🍳", "🥘", "🛒", "🌱", "🪴", "📍", "🗺️", "🏋", "🏃", "🚴", "📚", "✏️", "💰", "🧾", "✈️", "🏡", "🐶", "🐱", "🎹", "🎵", "🎬", "📷", "☕", "🧘", "💊", "🗓️", "✅", "🎁"];

interface Props {
  app: InstalledApp;
  onClose: () => void;
}

export function TileEditor({ app, onClose }: Props) {
  const declaredName = app.user.name;
  const declaredIcon = app.entry.identity?.icon;
  const [name, setName] = useState(app.entry.displayName ?? "");
  const [icon, setIcon] = useState(app.entry.icon ?? "");
  const [hue, setHue] = useState<number | undefined>(app.entry.hue);

  const preview = tileIdentity({ key: app.key, name: name.trim() || declaredName, icon: icon.trim() || declaredIcon, accent: app.accent, hue });

  const save = (): void => {
    updateEntry(app.key, {
      displayName: name.trim() || undefined,
      icon: icon.trim() || undefined,
      hue,
    });
    onClose();
  };

  return (
    <div className="k-modal-scrim" onClick={onClose}>
      <div className="k-modal k-tile-editor" role="dialog" aria-modal="true" aria-label={`Edit tile: ${app.name}`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <header className="k-tile-editor-head">
          <div>
            <h2>Edit tile</h2>
            <p className="k-muted">On this device only. The app itself keeps its own name and look.</p>
          </div>
          <div className="k-tile-editor-preview" style={{ "--tile-accent": preview.accent } as CSSProperties} aria-hidden>
            <span className="k-launch-avatar" data-kind={preview.kind}>{preview.glyph}</span>
            <span className="k-launch-name">{name.trim() || declaredName}</span>
          </div>
        </header>

        <div className="k-tile-editor-field">
          <span className="k-field-label" id="k-tile-editor-name">Name</span>
          <span className="k-tile-editor-row">
            <input className="k-input" value={name} placeholder={declaredName} aria-label="Tile name" onChange={(e) => setName(e.target.value)} />
            <button type="button" className="k-add" disabled={!name} onClick={() => setName("")} aria-label="Reset name" title="Back to the app's own name">
              Reset
            </button>
          </span>
        </div>

        <div className="k-tile-editor-field">
          <span className="k-field-label" id="k-tile-editor-icon">Icon</span>
          <span className="k-tile-editor-row">
            <input className="k-input k-tile-editor-icon-input" value={icon} placeholder={declaredIcon ?? "monogram"} aria-label="Tile icon" maxLength={8} onChange={(e) => setIcon(e.target.value)} />
            <button type="button" className="k-add" disabled={!icon} onClick={() => setIcon("")} aria-label="Reset icon" title="Back to the app's own icon">
              Reset
            </button>
          </span>
          <div className="k-tile-editor-icons" role="group" aria-labelledby="k-tile-editor-icon">
            {ICONS.map((i) => (
              <button key={i} type="button" className="k-tile-editor-swatch" aria-pressed={icon === i} aria-label={`Icon ${i}`} onClick={() => setIcon(i)}>
                {i}
              </button>
            ))}
          </div>
        </div>

        <div className="k-tile-editor-field">
          <span className="k-field-label" id="k-tile-editor-colour">Colour</span>
          <div className="k-tile-editor-hues" role="group" aria-labelledby="k-tile-editor-colour">
            <button
              type="button"
              className="k-tile-editor-swatch k-tile-editor-hue"
              style={{ "--swatch": tileIdentity({ key: app.key, name: declaredName, accent: app.accent }).accent } as CSSProperties}
              aria-pressed={hue === undefined}
              aria-label="The app's own colour"
              title="The app's own colour"
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
                aria-label={`Hue ${h}`}
                onClick={() => setHue(h)}
              />
            ))}
          </div>
        </div>

        <div className="k-form-actions">
          <button type="button" className="k-add" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="k-add k-primary-action" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
