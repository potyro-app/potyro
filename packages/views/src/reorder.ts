// Putting things in the order you want, by hand: pointer (mouse and touch) and keyboard, no
// library. Written for the launcher's tiles (#84) and reused by a form's nested rows (#104), which
// is why it lives here rather than in the shell.
//
// A mouse drags after moving a few pixels. A finger must HOLD first (a quarter second, still), or
// every scroll over the grid would pick something up; once the hold is in, a non-passive touchmove
// listener keeps the page from panning under the drag. From the keyboard the same callback gets the
// same new order.
//
// Two callers, two shapes: a tile is dragged from anywhere on itself, a row card only by its
// handle. `handle` says which, and `ignore` keeps a menu button from starting a drag.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

const HOLD_MS = 220;
const SLOP_PX = 6;
/** How long after a drop a click is still the drop's own echo rather than a new tap. */
const CLICK_AFTER_DROP_MS = 300;

/** The list with `key` moved to index `to`, clamped. Pure, and the only place order changes. */
export function moveKey(list: readonly { key: string }[], key: string, to: number): string[] {
  const keys = list.map((a) => a.key);
  const from = keys.indexOf(key);
  if (from < 0) return keys;
  const target = Math.max(0, Math.min(keys.length - 1, to));
  if (target === from) return keys;
  keys.splice(from, 1);
  keys.splice(target, 0, key);
  return keys;
}

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
  /** Spread on each item's wrapper; `key` identifies it. */
  item: (key: string) => {
    "data-key": string;
    "data-dragging"?: true;
    "data-over"?: true;
    style?: { transform: string; zIndex: number };
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    onClickCapture: (e: ReactMouseEvent<HTMLElement>) => void;
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  };
  /** What the last move did, for an aria-live region. */
  announcement: string;
}

export interface ReorderOptions {
  /** The items, in their current order. */
  keys: readonly string[];
  /** What to call an item when announcing a move. */
  names: (key: string) => string;
  /** Receives the keys in their new order. */
  onReorder: (keys: string[]) => void;
  /**
   * Handle the drop yourself, given what was dragged and what it landed on, instead of receiving a
   * reordered list. For lists that are not ONE sequence: the checklist's rows live in groups, and
   * where a row landed decides which group it joins, which no flat array of keys can say.
   */
  onDrop?: (key: string, over: string) => void;
  /** false renders inert props (the "Recent" and "A–Z" sorts are not yours to drag). */
  enabled: boolean;
  /** CSS selector a drag must start inside — a grip. Omitted, the whole item is the handle. */
  handle?: string;
  /** CSS selector that never starts a drag, whatever else is true (a menu button). */
  ignore?: string;
  /**
   * Keyboard: `"alt"` needs Alt+arrows (a focusable tile in a grid, where bare arrows move focus),
   * `"plain"` takes bare arrows (a grip button, which has no other use for them).
   */
  keyboard?: "alt" | "plain";
}

export function useReorder({ keys, names, onReorder, onDrop, enabled, handle, ignore, keyboard = "alt" }: ReorderOptions): ReorderProps {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropped = useRef(0);
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
      if (onDrop) {
        onDrop(d.key, d.over);
        setAnnouncement(`Moved ${names(d.key)} to ${names(d.over)}.`);
        return;
      }
      const to = keys.indexOf(d.over);
      const next = moveKey(keys.map((key) => ({ key })), d.key, to);
      onReorder(next);
      setAnnouncement(`Moved ${names(d.key)} to position ${to + 1} of ${keys.length}.`);
    }
  };

  // The item in hand rides under the pointer, so the topmost element there is itself; the drop
  // target is the first OTHER item in the stack beneath the pointer.
  const under = (x: number, y: number, self: string): string | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const key = el.closest<HTMLElement>("[data-key]")?.dataset.key;
      if (key && key !== self) return key;
    }
    return null;
  };

  const step = (key: string, by: number): void => {
    const from = keys.indexOf(key);
    const to = from + by;
    if (to < 0 || to >= keys.length) return;
    // The keyboard drops onto the neighbour, so a grouped list moves by keyboard exactly as it
    // moves by finger — including across a group boundary.
    if (onDrop) {
      onDrop(key, keys[to]!);
      setAnnouncement(`Moved ${names(key)} to ${names(keys[to]!)}.`);
      return;
    }
    onReorder(moveKey(keys.map((k) => ({ key: k })), key, to));
    setAnnouncement(`Moved ${names(key)} to position ${to + 1} of ${keys.length}.`);
  };

  const item: ReorderProps["item"] = (key) => ({
    "data-key": key,
    ...(enabled && drag?.key === key && !drag.armed ? { "data-dragging": true as const, style: { transform: `translate(${drag.dx}px, ${drag.dy}px)`, zIndex: 5 } } : {}),
    ...(enabled && drag && !drag.armed && drag.over === key && drag.key !== key ? { "data-over": true as const } : {}),
    onPointerDown: (e) => {
      if (!enabled || e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (ignore && target.closest(ignore)) return;
      if (handle && !target.closest(handle)) return;
      const d: Drag = { key, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, armed: true, dx: 0, dy: 0, over: null };
      update(d);
      if (e.pointerType === "touch" || e.pointerType === "pen") {
        clearHold();
        hold.current = setTimeout(() => {
          const cur = dragRef.current;
          if (cur && cur.pointerId === d.pointerId) {
            target.setPointerCapture?.(d.pointerId);
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
        update({ ...cur, armed: false, dx, dy, over: under(e.clientX, e.clientY, cur.key) });
        return;
      }
      e.preventDefault();
      update({ ...cur, dx, dy, over: under(e.clientX, e.clientY, cur.key) });
    },
    onPointerUp: (e) => {
      const cur = dragRef.current;
      clearHold();
      if (!cur || cur.pointerId !== e.pointerId) return;
      if (!cur.armed) {
        e.preventDefault();
        // The browser still sends a click after the drag, to whatever the pointer came to rest on.
        // Left alone it opens the thing that was just dragged — the row you moved starts renaming
        // itself. `preventDefault` on pointerup does not stop it; only swallowing the click does.
        dropped.current = Date.now();
        commit({ ...cur, over: under(e.clientX, e.clientY, cur.key) ?? cur.over });
      }
      update(null);
    },
    onClickCapture: (e) => {
      if (Date.now() - dropped.current > CLICK_AFTER_DROP_MS) return;
      e.preventDefault();
      e.stopPropagation();
    },
    onPointerCancel: () => {
      clearHold();
      update(null);
    },
    onKeyDown: (e) => {
      if (!enabled) return;
      if (keyboard === "alt" && !e.altKey) return;
      const by = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!by) return;
      e.preventDefault();
      step(key, by);
    },
  });

  return { item, announcement };
}
