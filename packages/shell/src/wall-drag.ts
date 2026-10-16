// Holding and dragging on the tile wall (#96): the Windows Phone gestures, on pointer events.
//
//   - On the wall as it is, a press opens. A HOLD (half a second, still) is edit mode, with the held
//     tile chosen — and a finger that keeps moving after the hold carries the tile. A right click is
//     the same as a hold. A mouse that drags a tile is in edit mode at once, carrying it.
//   - In edit mode a tap chooses a tile; a finger holds a moment before it carries one (so a swipe
//     still scrolls the wall), a mouse carries one as soon as it moves.
//   - Where a carried tile lands is read from what is under the pointer: the middle of another tile
//     makes a group (or joins that tile's group), either side of it puts it before or after, a group's
//     own area puts it in that group, the bare wall puts it at the end, out of every group.
//
// A group's header drags the same way, carrying the whole group; it lands before or after the wall
// item it is dropped on. Keyboard equivalents live with the wall, not here.

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Drop } from "./launcher-wall.js";

const HOLD_TO_EDIT_MS = 500;
const HOLD_TO_DRAG_MS = 200;
const SLOP_PX = 8;
const CLICK_AFTER_MS = 350;

export interface Carried {
  /** A tile's app key, or `group:<id>` for a group. */
  key: string;
  dx: number;
  dy: number;
  drop: Drop | null;
}

interface Press {
  key: string;
  pointerId: number;
  x: number;
  y: number;
  touch: boolean;
  /** The hold has fired (edit mode entered, or the drag allowed). */
  held: boolean;
  carrying: boolean;
}

export interface WallDragOptions {
  editing: boolean;
  /** A hold or a right click on `key`: edit mode with it chosen. */
  onHold: (key: string) => void;
  onDrop: (key: string, drop: Drop) => void;
}

/** What is under the pointer, as a drop for `self`. */
export function dropUnder(x: number, y: number, self: string): Drop | null {
  if (typeof document.elementsFromPoint !== "function") return null;
  for (const el of document.elementsFromPoint(x, y)) {
    const cell = el.closest<HTMLElement>(".k-metro-cell[data-key]");
    if (cell) {
      const target = cell.dataset.key!;
      if (target === self) continue;
      const r = cell.getBoundingClientRect();
      const fx = (x - r.left) / r.width;
      const fy = (y - r.top) / r.height;
      // A group cannot be put inside another, so a carried group only ever lands beside.
      if (!self.startsWith("group:") && fx > 0.25 && fx < 0.75 && fy > 0.2 && fy < 0.8) return { kind: "onto", target };
      return { kind: "beside", target, after: fx >= 0.5 };
    }
    const folder = el.closest<HTMLElement>("[data-group-id]");
    if (folder) {
      const group = folder.dataset.groupId!;
      if (self === `group:${group}`) continue;
      if (self.startsWith("group:")) {
        const r = folder.getBoundingClientRect();
        return { kind: "beside", target: `group:${group}`, after: (y - r.top) / r.height >= 0.5 };
      }
      return { kind: "into", group };
    }
    if (el.closest(".k-metro-wall")) return { kind: "end" };
  }
  return null;
}

export function useWallDrag({ editing, onHold, onDrop }: WallDragOptions) {
  const press = useRef<Press | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swallowUntil = useRef(0);
  const [carried, setCarried] = useState<Carried | null>(null);
  const carriedRef = useRef<Carried | null>(null);
  const set = (c: Carried | null): void => {
    carriedRef.current = c;
    setCarried(c);
  };
  const clear = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const editingRef = useRef(editing);
  editingRef.current = editing;

  // While a finger carries a tile the wall must not scroll under it; only a non-passive listener can
  // say so — and it has to be there when the touch STARTS, or the browser has already decided the
  // gesture is a scroll it need not ask about. So it is always there, and blocks only while carrying.
  useEffect(() => {
    const block = (e: TouchEvent): void => {
      if (press.current?.held && e.cancelable) e.preventDefault();
    };
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, []);
  useEffect(() => clear, []);

  const bind = (key: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".k-metro-corner")) return;
      const touch = e.pointerType === "touch" || e.pointerType === "pen";
      press.current = { key, pointerId: e.pointerId, x: e.clientX, y: e.clientY, touch, held: false, carrying: false };
      clear();
      const wait = editingRef.current ? (touch ? HOLD_TO_DRAG_MS : 0) : HOLD_TO_EDIT_MS;
      if (!wait) {
        press.current.held = true;
        return;
      }
      timer.current = setTimeout(() => {
        const p = press.current;
        if (!p || p.pointerId !== e.pointerId) return;
        p.held = true;
        if (!editingRef.current) {
          onHold(key);
          swallowUntil.current = Date.now() + 10_000; // the release that ends this hold is not a tap
        }
        // A held finger is carrying, even before it moves: the wall stops scrolling under it now.
        if (p.touch) {
          p.carrying = true;
          set({ key, dx: 0, dy: 0, drop: null });
        }
        try {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        } catch {
          /* the drag works without capture */
        }
      }, wait);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.pointerId !== e.pointerId) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (!p.carrying) {
        if (Math.hypot(dx, dy) <= SLOP_PX) return;
        // A finger that moves before its hold is scrolling: let it.
        if (p.touch && !p.held) {
          clear();
          press.current = null;
          return;
        }
        // A mouse that drags is arranging: edit mode, carrying this tile.
        if (!editingRef.current) onHold(p.key);
        clear();
        p.held = true;
        p.carrying = true;
        try {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        } catch {
          /* fine */
        }
      }
      e.preventDefault();
      set({ key: p.key, dx, dy, drop: dropUnder(e.clientX, e.clientY, p.key) });
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const p = press.current;
      clear();
      press.current = null;
      if (!p || p.pointerId !== e.pointerId) return;
      const c = carriedRef.current;
      set(null);
      if (p.carrying) {
        swallowUntil.current = Date.now() + CLICK_AFTER_MS;
        const drop = dropUnder(e.clientX, e.clientY, p.key) ?? c?.drop;
        if (drop && (Math.abs(e.clientX - p.x) > SLOP_PX || Math.abs(e.clientY - p.y) > SLOP_PX)) onDrop(p.key, drop);
      } else if (p.held && swallowUntil.current > Date.now()) {
        // The hold opened edit mode; letting go is not a tap on the tile.
        swallowUntil.current = Date.now() + CLICK_AFTER_MS;
      }
    },
    onPointerCancel: () => {
      clear();
      press.current = null;
      set(null);
    },
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      // A right click, or a long press the browser reports as one: edit mode, never the page's menu.
      e.preventDefault();
      if (!editingRef.current) onHold(key);
    },
  });

  /** Whether a click that just arrived is the echo of a hold or a drop, to be ignored. */
  const swallowClick = (): boolean => {
    if (swallowUntil.current > Date.now()) {
      swallowUntil.current = 0;
      return true;
    }
    return false;
  };

  return { bind, carried, swallowClick };
}
