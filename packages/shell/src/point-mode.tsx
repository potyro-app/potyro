// Point mode (#284): in the Studio's preview, tap a part of the app to talk about it.
//
// While it is on, the app does not work — that is the point of the mode, and why it can never be
// mistaken for using the app. A layer lies over the app's screen and takes every tap: nothing under
// it is pressed, typed into or opened. What a tap would point at is outlined and the rest of the
// screen dims around it, with its name on the outline. A tap chooses it; the tray then offers what it
// is inside (a button, its view, the page), so a wider meaning is one more tap, not a bigger target.
//
// It works the same with a finger and a mouse. A mouse outlines what is under it before the click;
// a finger has no hover, so a tap chooses and the outline shows what was chosen — and a drag scrolls
// the app, so a long page can still be pointed at all the way down. A wheel scrolls it too.

import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AppDefinition } from "potyro";
import { boxOf, currentPageIn, describePoint, elementFor, pointsAt, type Pointed } from "./point-target.js";

export interface PointModeProps {
  /** The app's screen: what is pointed into, and what the outline is drawn against. */
  screen: HTMLElement;
  def: Pick<AppDefinition, "pages" | "entities">;
  onPick: (pointed: Pointed) => void;
  onCancel: () => void;
}

/** A finger that moves this far is scrolling, not tapping. */
const DRAG = 8;

interface Found {
  levels: Pointed[];
  /** Which of `levels` is meant. */
  at: number;
  /** What was under the pointer — the outline is re-measured from it as the app scrolls. */
  from: Element;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function scrollerOf(el: Element | null, screen: HTMLElement): HTMLElement | null {
  for (let at = el; at && at !== screen; at = at.parentElement) {
    if (!(at instanceof HTMLElement)) continue;
    const style = getComputedStyle(at);
    if (/(auto|scroll)/.test(style.overflowY) && at.scrollHeight > at.clientHeight) return at;
  }
  return screen.querySelector<HTMLElement>(".k-preview-scroll");
}

/**
 * Where the outline's name goes: on its top edge; above or below it when the outline is too small to
 * carry it; inside when it is at the top of the screen.
 */
function tagPlace(box: Box): "edge" | "above" | "below" | "inside" {
  if (box.width >= 180) return box.top < 14 ? "inside" : "edge";
  return box.top < 36 ? "below" : "above";
}

export function PointMode({ screen, def, onPick, onCancel }: PointModeProps) {
  const { t } = useLingui();
  const layer = useRef<HTMLDivElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Found | null>(null);
  const [chosen, setChosen] = useState<Found | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [trayTop, setTrayTop] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; lastY: number; moved: boolean; scroller: HTMLElement | null } | null>(null);

  /** The app element under a point — the layer and its tray are skipped, they are not the app. */
  const appAt = useCallback(
    (x: number, y: number): Element | null => {
      for (const el of document.elementsFromPoint(x, y)) {
        if (layer.current?.contains(el)) continue;
        return screen.contains(el) && el !== screen ? el : null;
      }
      return null;
    },
    [screen],
  );

  const find = useCallback(
    (x: number, y: number): Found | null => {
      const el = appAt(x, y);
      if (!el) return null;
      const levels = pointsAt(el, currentPageIn(screen)).map((ref) => describePoint(ref, def));
      return levels.length ? { levels, at: 0, from: el } : null;
    },
    [appAt, def, screen],
  );

  const shown = chosen ?? hover;

  // The outline, measured against the screen: again whenever the app scrolls or the screen resizes.
  const measure = useCallback(() => {
    if (!shown) return setBox(null);
    const el = elementFor(shown.levels[shown.at]!.ref, shown.from, screen);
    if (!el || !el.isConnected) return setBox(null);
    const r = boxOf(el);
    const s = screen.getBoundingClientRect();
    const pad = 8;
    const top = Math.max(r.top - s.top - pad, 2);
    const left = Math.max(r.left - s.left - pad, 2);
    const bottom = Math.min(r.bottom - s.top + pad, s.height - 2);
    const right = Math.min(r.right - s.left + pad, s.width - 2);
    setBox({ top, left, width: Math.max(right - left, 8), height: Math.max(bottom - top, 8) });
  }, [shown, screen]);
  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    screen.addEventListener("scroll", measure, true);
    addEventListener("resize", measure);
    return () => {
      screen.removeEventListener("scroll", measure, true);
      removeEventListener("resize", measure);
    };
  }, [measure, screen]);

  // The tray sits at the bottom, where a thumb is — unless what was chosen is down there.
  useLayoutEffect(() => {
    if (!chosen || !box) return;
    const h = tray.current?.offsetHeight ?? 0;
    setTrayTop(box.top + box.height > screen.clientHeight - h - 24 && box.top > h + 24);
  }, [chosen, box, screen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (chosen) setChosen(null);
      else onCancel();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [chosen, onCancel]);

  const inTray = (e: { target: EventTarget | null }): boolean => !!tray.current?.contains(e.target as Node);

  const down = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (inTray(e)) return;
    e.preventDefault();
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lastY: e.clientY, moved: false, scroller: scrollerOf(appAt(e.clientX, e.clientY), screen) };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d && d.id === e.pointerId && e.pointerType !== "mouse") {
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG) d.moved = true;
      if (d.moved && d.scroller) d.scroller.scrollTop -= e.clientY - d.lastY;
      d.lastY = e.clientY;
      return;
    }
    if (e.pointerType === "mouse" && !inTray(e)) setHover(find(e.clientX, e.clientY));
  };

  const up = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || d.moved || inTray(e)) return;
    const found = find(e.clientX, e.clientY);
    setChosen(found);
    setHover(null);
  };

  const levels = chosen?.levels ?? [];
  const current = shown?.levels[shown.at];

  return (
    <div
      ref={layer}
      className="k-point-layer"
      data-k-noedit
      data-state={chosen ? "chosen" : shown ? "hover" : "idle"}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => (drag.current = null)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
      onWheel={(e) => {
        if (inTray(e)) return;
        scrollerOf(appAt(e.clientX, e.clientY), screen)?.scrollBy({ top: e.deltaY, left: e.deltaX });
      }}
      onClick={(e) => !inTray(e) && e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {box && current ? (
        <div className="k-point-ring" style={{ transform: `translate(${box.left}px, ${box.top}px)`, width: box.width, height: box.height }} aria-hidden>
          <span className="k-point-tag" data-place={tagPlace(box)}>
            {current.label}
          </span>
        </div>
      ) : null}

      {chosen ? (
        <div ref={tray} className="k-point-tray" data-top={trayTop || undefined} role="group" aria-label={t`What you are pointing at`}>
          <p className="k-point-tray-head">
            <Trans>Pointing at</Trans>
          </p>
          <div className="k-point-levels" role="radiogroup" aria-label={t`Which part`}>
            {levels.map((l, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={i === chosen.at}
                className="k-point-level"
                onClick={() => setChosen({ ...chosen, at: i })}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="k-point-actions">
            <button type="button" className="k-point-again" onClick={() => setChosen(null)}>
              <Trans>Point again</Trans>
            </button>
            <button type="button" className="k-point-ask" onClick={() => onPick(levels[chosen.at]!)}>
              <Trans>Ask about this</Trans> <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A finger on a target: point mode's mark, in the bar and on its button. */
export function PointGlyph() {
  return (
    <svg className="k-point-glyph" viewBox="0 0 20 20" width="16" height="16" aria-hidden focusable="false">
      <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="2.2" fill="currentColor" />
      <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
