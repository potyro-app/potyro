// Reordering tiles by hand (#84): pointer (mouse and touch) and keyboard, no library.
//
// A mouse drags after moving a few pixels. A finger must HOLD first (a quarter second, still), or
// every scroll over the grid would pick a tile up; once the hold is in, a non-passive touchmove
// listener keeps the page from panning under the drag. From the keyboard, Alt+arrows move the
// focused tile one step; the same callback gets the same new order either way.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { moveKey } from "./launcher-order.js";

const HOLD_MS = 220;
const SLOP_PX = 6;

interface Drag {
  key: string;
  pointerId: number;
  startX: number;
  startY: number;
  /** A finger has not held long enough yet; a mouse has not moved far enough yet. */
  armed: boolean;
  dx: number;
  dy: number;
  over: string | null;
}

export interface ReorderProps {
  /** Spread on each tile's wrapper; `key` identifies it. */
  item: (key: string) => {
    "data-key": string;
    "data-dragging"?: true;
    "data-over"?: true;
    style?: { transform: string; zIndex: number };
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  };
  /** What the last move did, for an aria-live region. */
  announcement: string;
}

/**
 * @param keys      the tiles, in their current order
 * @param names     what to call a tile when announcing a move
 * @param onReorder receives the keys in their new order
 * @param enabled   false renders inert props (the "Recent" and "A–Z" sorts are not yours to drag)
 */
export function useReorder(keys: readonly string[], names: (key: string) => string, onReorder: (keys: string[]) => void, enabled: boolean): ReorderProps {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const update = (next: Drag | null): void => {
    dragRef.current = next;
    setDrag(next);
  };
  const clearHold = (): void => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
  };

  // While a finger drags, the page must not pan: only a non-passive touchmove can say so.
  useEffect(() => {
    if (!drag || drag.armed) return;
    const block = (e: TouchEvent): void => e.preventDefault();
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, [drag]);

  const commit = (d: Drag): void => {
    if (d.over && d.over !== d.key) {
      const to = keys.indexOf(d.over);
      const next = moveKey(keys.map((key) => ({ key })), d.key, to);
      onReorder(next);
      setAnnouncement(`Moved ${names(d.key)} to position ${to + 1} of ${keys.length}.`);
    }
  };

  // The tile in hand rides under the pointer, so the topmost element there is itself; the drop
  // target is the first OTHER tile in the stack beneath the pointer.
  const tileUnder = (x: number, y: number, self: string): string | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const key = el.closest<HTMLElement>("[data-key]")?.dataset.key;
      if (key && key !== self) return key;
    }
    return null;
  };

  const item: ReorderProps["item"] = (key) => ({
    "data-key": key,
    ...(enabled && drag?.key === key && !drag.armed ? { "data-dragging": true as const, style: { transform: `translate(${drag.dx}px, ${drag.dy}px)`, zIndex: 5 } } : {}),
    ...(enabled && drag && !drag.armed && drag.over === key && drag.key !== key ? { "data-over": true as const } : {}),
    onPointerDown: (e) => {
      if (!enabled || e.button !== 0) return;
      // The menu button and anything inside a menu are not handles.
      if ((e.target as HTMLElement).closest(".k-tile-menu-host")) return;
      const d: Drag = { key, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, armed: true, dx: 0, dy: 0, over: null };
      update(d);
      if (e.pointerType === "touch" || e.pointerType === "pen") {
        clearHold();
        hold.current = setTimeout(() => {
          const cur = dragRef.current;
          if (cur && cur.pointerId === d.pointerId) {
            (e.target as HTMLElement).setPointerCapture?.(d.pointerId);
            update({ ...cur, armed: false });
          }
        }, HOLD_MS);
      }
    },
    onPointerMove: (e) => {
      const cur = dragRef.current;
      if (!cur || cur.pointerId !== e.pointerId) return;
      const dx = e.clientX - cur.startX;
      const dy = e.clientY - cur.startY;
      if (cur.armed) {
        const far = Math.hypot(dx, dy) > SLOP_PX;
        if (!far) return;
        // A finger that moved before the hold was scrolling. A mouse that moved is dragging.
        if (e.pointerType === "touch" || e.pointerType === "pen") {
          clearHold();
          update(null);
          return;
        }
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        update({ ...cur, armed: false, dx, dy, over: tileUnder(e.clientX, e.clientY, cur.key) });
        return;
      }
      e.preventDefault();
      update({ ...cur, dx, dy, over: tileUnder(e.clientX, e.clientY, cur.key) });
    },
    onPointerUp: (e) => {
      const cur = dragRef.current;
      clearHold();
      if (!cur || cur.pointerId !== e.pointerId) return;
      if (!cur.armed) {
        e.preventDefault();
        commit({ ...cur, over: tileUnder(e.clientX, e.clientY, cur.key) ?? cur.over });
      }
      update(null);
    },
    onPointerCancel: () => {
      clearHold();
      update(null);
    },
    onKeyDown: (e) => {
      if (!enabled || !e.altKey) return;
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const from = keys.indexOf(key);
      const to = from + step;
      if (to < 0 || to >= keys.length) return;
      onReorder(moveKey(keys.map((k) => ({ key: k })), key, to));
      setAnnouncement(`Moved ${names(key)} to position ${to + 1} of ${keys.length}.`);
    },
  });

  return { item, announcement };
}
