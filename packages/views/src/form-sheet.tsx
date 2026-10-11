// The surface a form opens in (#101). On a phone it is a full-screen sheet that slides up, with
// the title and a Close at the top and the actions in a footer that stays put while the fields
// scroll between them — the primary action of every form used to be off-screen for any entity
// with more than six fields. On a wide screen it is the centred modal, capped at 90vh with the
// same fixed footer.
//
// It owns the dialog's manners: the first field takes the focus on open and the opener gets it
// back on close; Tab stays inside; Escape, the scrim, a swipe down on the header and the Close
// button all close it — asking first when the form has edits. Rendered through a portal so a
// nested form (a relation creating its target inline) is a second sheet stacked on the first,
// not a form inside a form.

import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePortalRoot } from "./portal-root.js";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const SWIPE_CLOSE_PX = 80;

export interface FormSheetProps {
  /** The dialog's accessible name — the form's title. */
  title: string;
  /** Asked to close by any means: the answer decides. */
  onClose: () => void;
  /** A second sheet over a first one: a relation's inline create. */
  stacked?: boolean;
  /** False while the form is still loading its record: the first field is focused once it is there. */
  ready?: boolean;
  className?: string;
  children: ReactNode;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden]") && el.offsetParent !== null);
}

export function FormSheet({ title, onClose, stacked, className, ready = true, children }: FormSheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const swipe = useRef<{ id: number; y: number } | null>(null);
  const portalRoot = usePortalRoot();

  // Focus: the opener gets it back on close, whatever happened in between.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  // The first field, once the fields are there. Layout effect so it is focused before the browser
  // paints the sheet with nothing focused.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!ready || !root) return;
    const body = root.querySelector<HTMLElement>(".k-form-body") ?? root;
    (focusables(body)[0] ?? root).focus();
  }, [ready]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Handled here and no further: a stacked sheet's Escape must not also close the one under it,
    // and its Tab must cycle its own controls, not the outer form's.
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    e.stopPropagation();
    const items = focusables(ref.current);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // A swipe down on the header closes the sheet — the same gesture as the switcher's grip. The
  // header is whatever the child renders as `.k-form-head`, so the sheet listens and only counts
  // a gesture that began there; a pointer that starts on a button is a click, not a swipe.
  const swipeHandlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || e.pointerType === "mouse") return;
      const target = e.target as HTMLElement;
      if (!target.closest(".k-form-head") || target.closest("button, a, input")) return;
      swipe.current = { id: e.pointerId, y: e.clientY };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (swipe.current?.id !== e.pointerId) return;
      setDragY(Math.max(0, e.clientY - swipe.current.y));
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      if (swipe.current?.id !== e.pointerId) return;
      const dy = e.clientY - swipe.current.y;
      swipe.current = null;
      setDragY(0);
      if (dy > SWIPE_CLOSE_PX) onClose();
    },
    onPointerCancel: () => {
      swipe.current = null;
      setDragY(0);
    },
  };

  return createPortal(
    <div
      className={`k-modal-scrim k-sheet-scrim${stacked ? " k-sheet-scrim-stacked" : ""}`}
      onClick={(e) => {
        // A click that bubbles up from a stacked sheet's scrim must not close the sheet under it.
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`k-modal k-sheet${stacked ? " k-sheet-stacked" : ""}${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Record data like any built-in view (a relation's chosen record, a list's rows); its field
        // labels are tagged `data-k-field` for edit mode.
        data-k-view
        tabIndex={-1}
        data-dragging={dragY > 0 ? "true" : undefined}
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={swipeHandlers.onPointerDown}
        onPointerMove={swipeHandlers.onPointerMove}
        onPointerUp={swipeHandlers.onPointerUp}
        onPointerCancel={swipeHandlers.onPointerCancel}
      >
        {children}
      </div>
    </div>,
    portalRoot,
  );
}
