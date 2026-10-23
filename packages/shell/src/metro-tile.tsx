// One tile on the wall (#96, owner 2026-10-15): flat, square, the app's own colour, white on it.
//
// Its plain face is the app's mark in the middle and its name bottom-left — Windows Phone's anatomy.
// A medium or wide tile whose app declares a live tile turns over now and then to its live face
// (`AppDefinition.tile`: a headline, a few lines, a picture) and back; a small one has room only for
// a count. The flip, the press tilt and the open are transforms, nothing else, and none of them
// happens under `prefers-reduced-motion` — the live face then simply shows.
//
// The marks from #87 stay: a shield on a sealed app, the sync mark on a synced one, and the
// attention badge from #86 — on a Metro tile they sit in its corners, white on the app's colour.

import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useRef } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { useLocale } from "@potyro/i18n";
import { attentionOf, describeAttention, type InstalledApp } from "./launcher-store.js";
import { tileIdentity } from "./tile-identity.js";
import { TileGlyph } from "./tile-glyph.js";
import { hueOf, tracoOf } from "./app-colour.js";
import { hasLiveFace } from "./tile-content.js";
import type { Placed, TileSize } from "./launcher-wall.js";

/** The tile's colours: the app's own (contrast-checked) and, kept for the tile editor's preview, the raw accent. */
export function tileColours(app: InstalledApp): { background: string; accent: string; identity: ReturnType<typeof tileIdentity> } {
  const identity = tileIdentity(app);
  // The app's hour on the colour clock (DESIGN.md §3.1), the same block Home's card wears: a person's
  // chosen hue, else the app's declared colour's hue, else the one its key gives. Graphite on it.
  const hue = typeof app.hue === "number" ? app.hue : (hueOf(identity.accent) ?? identity.hue);
  return { background: tracoOf(hue), accent: identity.accent, identity };
}

/** The badge's number: what wants attention (#86) first, else the live tile's own count. */
function badgeOf(app: InstalledApp, now: number): number {
  const attention = attentionOf(app.entry, now).total;
  return attention || app.face?.count || 0;
}

function Marks({ app }: { app: InstalledApp }) {
  const { t } = useLingui();
  const count = app.sync && app.people.length > 1 ? app.people.length : 0;
  const synced = count ? plural(count, { one: "Shared with # person", other: "Shared with # people" }) : t`Synced to your other devices`;
  if (app.trusted && !app.sync) return null;
  return (
    <span className="k-metro-marks">
      {!app.trusted ? (
        <span className="k-launch-shield" role="img" aria-label={t`Runs sealed`} title={t`Runs sealed`}>
          🛡
        </span>
      ) : null}
      {app.sync ? (
        <span className="k-launch-mark" data-shared={count ? "true" : undefined} role="img" aria-label={synced} title={synced}>
          ⟳
        </span>
      ) : null}
    </span>
  );
}

export interface MetroTileProps {
  app: InstalledApp;
  size: TileSize;
  place: Placed;
  now: number;
  /** The app open behind this launcher. */
  active?: boolean;
  /** Edit mode, and whether this is the tile being edited. */
  editing: boolean;
  chosen: boolean;
  /** Show the live face now (the wall turns tiles over in turn). */
  live: boolean;
  /** Roving focus: the one tile on the wall Tab reaches. */
  tabbable: boolean;
  /** Being dragged: where it rides, relative to its place. */
  drag?: { dx: number; dy: number };
  /** What a drop here would do, while another tile is dragged over it. */
  dropHint?: "onto" | "before" | "after";
  /** Turnstile: the wall is leaving for an app; this tile's delay, in ms. */
  leaving?: number;
  onActivate: (e: MouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
  pointer: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    onContextMenu: (e: MouseEvent<HTMLElement>) => void;
  };
  /** Edit mode's corner controls on the chosen tile. */
  corners?: ReactNode;
}

export function MetroTile(p: MetroTileProps) {
  useLocale(); // the attention words are read in the active language
  const { app, size, place } = p;
  const { background, accent, identity } = tileColours(app);
  const attention = attentionOf(app.entry, p.now);
  const badge = badgeOf(app, p.now);
  const face = app.face;
  const flips = size !== "small" && hasLiveFace(face);
  const showLive = flips && p.live && !p.editing;
  const tilt = useRef<HTMLButtonElement | null>(null);

  // Windows Phone's tilt: the tile leans away from where it is pressed. Two numbers on the element,
  // the transform in CSS — a compositor-only change, and `prefers-reduced-motion` drops it there.
  const press = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const el = tilt.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--tile-tx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(2));
    el.style.setProperty("--tile-ty", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(2));
    el.dataset.pressed = "true";
  };
  const release = (): void => {
    if (tilt.current) delete tilt.current.dataset.pressed;
  };

  const style: CSSProperties = {
    gridColumn: `${place.col + 1} / span ${place.w}`,
    gridRow: `${place.row + 1} / span ${place.h}`,
    ...(p.drag ? { transform: `translate(${p.drag.dx}px, ${p.drag.dy}px)`, zIndex: 5 } : {}),
    ...(p.leaving !== undefined ? ({ "--metro-leave": `${p.leaving}ms` } as CSSProperties) : {}),
  };

  const glyph = (
    <span className="k-launch-avatar k-metro-glyph" data-kind={identity.kind} aria-hidden>
      <TileGlyph identity={identity} size={size === "small" ? 28 : 40} />
    </span>
  );
  const name = <span className={size === "small" ? "k-launch-name k-visually-hidden" : "k-launch-name k-metro-name"}>{app.name}</span>;
  const count = badge > 0 ? (
    <span className="k-launch-badge k-metro-count" aria-hidden>
      {badge > 99 ? "99+" : badge}
    </span>
  ) : null;

  return (
    <div
      className="k-launch-item k-launch-usertile k-metro-cell"
      data-key={app.key}
      data-nav={app.key}
      data-size={size}
      data-chosen={p.chosen || undefined}
      data-dragging={p.drag ? "true" : undefined}
      data-drop={p.dropHint}
      data-leaving={p.leaving !== undefined ? "true" : undefined}
      style={style}
      {...p.pointer}
    >
      <button
        ref={tilt}
        type="button"
        className="k-launch-tile k-metro-tile"
        data-size={size}
        data-active={p.active || undefined}
        data-attention={attention.total || undefined}
        data-face={showLive ? "live" : "plain"}
        aria-pressed={p.editing ? p.chosen : undefined}
        tabIndex={p.tabbable ? 0 : -1}
        style={{ "--tile-accent": accent, "--tile-bg": background } as CSSProperties}
        onClick={p.onActivate}
        onKeyDown={p.onKeyDown}
        onFocus={p.onFocus}
        onPointerDown={press}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
      >
        <span className="k-metro-flip">
          <span className="k-metro-face k-metro-face-plain">
            {glyph}
            {name}
            {count}
            <Marks app={app} />
          </span>
          {flips ? (
            <span className="k-metro-face k-metro-face-live" aria-hidden>
              {face.image ? <img className="k-metro-photo" src={face.image} alt="" draggable={false} /> : null}
              <span className="k-metro-live-text">
                {face.title ? <span className="k-metro-live-title">{face.title}</span> : null}
                {face.lines.map((line, i) => (
                  <span key={i} className="k-metro-live-line">
                    {line}
                  </span>
                ))}
              </span>
              <span className="k-metro-name">{app.name}</span>
              {badge > 0 ? (
                <span className="k-metro-count" aria-hidden>
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        {/* What the eye reads on the faces, for the ear: the badge in words, the live headline. */}
        {attention.total ? <span className="k-visually-hidden">, {describeAttention(attention)}</span> : null}
        {flips && face.title ? <span className="k-visually-hidden">, {face.title}</span> : null}
      </button>
      {p.corners}
    </div>
  );
}
