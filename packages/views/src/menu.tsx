// A menu behind one button (#111): the shell's `⋯` with its tools, a detail page's "More actions",
// the phone tab bar's "More". A real menu — `role="menu"`, arrow keys, Home/End, Escape back to
// the button — rendered as a popover on a wide screen and as a bottom sheet on a phone, where a
// popover under a thumb is unreachable. Items are plain data so every caller gets the same manners.

import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  key: string;
  label: string;
  /** A glyph at the left, purely visual. */
  icon?: ReactNode;
  /** A quieter word at the right ("review", "this page"). */
  hint?: string;
  onSelect: () => void;
  /** Styled as the one thing in the menu you might regret. Put it last, after a separator. */
  danger?: boolean;
  disabled?: boolean;
  /** Extra class on the item, for a spec or a style that needs to find it. */
  className?: string;
}

export type MenuEntry = MenuItem | "separator";

export interface ActionMenuProps {
  /** The button's accessible name, and the menu's. */
  label: string;
  /** What the button shows. Default: an ellipsis. */
  trigger?: ReactNode;
  /** A heading inside the menu, for the eye (the menu already says whose it is). */
  title?: string;
  entries: MenuEntry[];
  className?: string;
  buttonClassName?: string;
  /** Something to show instead of the ellipsis while an item is busy. */
  busy?: boolean;
}

export function ActionMenu({ label, trigger, title, entries, className, buttonClassName, busy }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  // The popover hangs off the button's corner; measured when opened so it follows a scrolled page.
  useEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
  }, [open]);

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number): void => items[(i + items.length) % items.length]?.focus();
    if (e.key === "Escape") close(true);
    else if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Tab") close(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`k-menu-btn${buttonClassName ? ` ${buttonClassName}` : ""}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? "…" : (trigger ?? "⋯")}
      </button>
      {open
        ? createPortal(
            <div className="k-menu-layer" onClick={(e) => e.stopPropagation()}>
              <div className="k-menu-scrim" onClick={() => close(false)} />
              <div
                ref={menuRef}
                className={`k-menu${className ? ` ${className}` : ""}`}
                role="menu"
                aria-label={label}
                style={anchor ? { top: anchor.top, right: anchor.right } : undefined}
                onKeyDown={onMenuKey}
              >
                <div className="k-menu-grip" aria-hidden />
                {title ? (
                  <div className="k-menu-title" aria-hidden>
                    {title}
                  </div>
                ) : null}
                {entries.map((entry, i) =>
                  entry === "separator" ? (
                    <div key={`sep-${i}`} className="k-menu-sep" role="separator" />
                  ) : (
                    <button
                      key={entry.key}
                      type="button"
                      role="menuitem"
                      data-action={entry.key}
                      className={`k-menu-item${entry.danger ? " k-danger" : ""}${entry.className ? ` ${entry.className}` : ""}`}
                      disabled={entry.disabled}
                      onClick={() => {
                        setOpen(false);
                        entry.onSelect();
                      }}
                    >
                      <span className="k-menu-icon" aria-hidden>
                        {entry.icon ?? ""}
                      </span>
                      <span className="k-menu-label">{entry.label}</span>
                      {entry.hint ? (
                        <span className="k-menu-hint" aria-hidden>
                          {entry.hint}
                        </span>
                      ) : null}
                    </button>
                  ),
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export interface ChoiceItem {
  key: string;
  label: string;
  detail?: string;
  icon?: string;
  destructive?: boolean;
}

export interface ChoicePanelProps {
  /** The panel's accessible name; shown as its heading when `showTitle`. */
  title?: string;
  items: ChoiceItem[];
  /** A menu hangs under this rect on a wide screen; without one the panel is a small centred dialog. */
  anchor?: DOMRect | null;
  onChoose: (key: string) => void;
  onDismiss: () => void;
}

/**
 * `ctx.ui.sheet` and `ctx.ui.menu` (#112): the same choices as a real menu, without a button of its
 * own. On a phone it is the bottom sheet every menu is; on a wide screen it hangs under `anchor`
 * (the button that ran the action), or sits centred as a small dialog. Destructive items go last,
 * after a separator, in red — whatever order the app listed them in. Focus returns to whatever had
 * it when the panel opened.
 */
export function ChoicePanel({ title, items, anchor, onChoose, onDismiss }: ChoicePanelProps) {
  const { t } = useLingui();
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [place, setPlace] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const safe = items.filter((i) => !i.destructive);
  const risky = items.filter((i) => i.destructive);

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    if (panel && anchor) {
      const { width, height } = panel.getBoundingClientRect();
      const below = window.innerHeight - anchor.bottom - 6;
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 8 - width));
      setPlace(height <= below || below >= anchor.top ? { top: anchor.bottom + 6, left } : { bottom: Math.max(8, window.innerHeight - anchor.top + 6), left });
    }
    panel?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => opener.current?.focus?.();
  }, [anchor]);

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number): void => buttons[(i + buttons.length) % buttons.length]?.focus();
    if (e.key === "Escape") onDismiss();
    else if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(buttons.length - 1);
    else if (e.key === "Tab") e.preventDefault();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const row = (item: ChoiceItem) => (
    <button
      key={item.key}
      type="button"
      role="menuitem"
      className={`k-menu-item${item.destructive ? " k-danger" : ""}${item.detail ? " k-menu-item-2" : ""}`}
      onClick={() => onChoose(item.key)}
    >
      <span className="k-menu-icon" aria-hidden>
        {item.icon ?? ""}
      </span>
      <span className="k-menu-text">
        <span className="k-menu-label">{item.label}</span>
        {item.detail ? <span className="k-menu-detail">{item.detail}</span> : null}
      </span>
    </button>
  );

  return createPortal(
    <div className="k-menu-layer k-choice-layer" data-centred={anchor ? undefined : "true"}>
      <div className="k-menu-scrim" onClick={onDismiss} />
      <div
        ref={ref}
        className="k-menu k-choice"
        role="menu"
        aria-label={title ?? t({ message: "Choose", comment: "A list of choices with no title of its own" })}
        style={anchor ? (place ? { top: place.top, bottom: place.bottom, left: place.left, right: "auto" } : { visibility: "hidden" }) : undefined}
        onKeyDown={onKey}
      >
        <div className="k-menu-grip" aria-hidden />
        {title ? (
          <div className="k-menu-title" aria-hidden>
            {title}
          </div>
        ) : null}
        {safe.map(row)}
        {risky.length && safe.length ? <div className="k-menu-sep" role="separator" /> : null}
        {risky.map(row)}
      </div>
    </div>,
    document.body,
  );
}
