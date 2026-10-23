// One searchable list for every "choose from these" in a form: a long enum (#98) and a relation
// to other records. A popover under its trigger on a wide screen, a bottom sheet on a phone.
//
// Single choice picks and closes. Several choices toggle and stay open until Done, because
// closing after every tick would make choosing four things four trips. A relation can also offer
// to create what the search did not find, named with what was typed.

import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { usePhone } from "./media.js";
import { filterOptions, type Swatch } from "./enum.js";
import { placeUnder, type Placement } from "./popover.js";

export interface PickItem {
  id: string;
  label: string;
  /** A colour dot beside the label — an enum value's tint. */
  swatch?: Swatch;
}

export interface PickListProps {
  title: string;
  items: readonly PickItem[];
  selected: ReadonlySet<string>;
  /** Several may be chosen: items toggle and the list stays open until Done. */
  multi?: boolean;
  anchor: React.RefObject<HTMLElement | null>;
  onToggle: (id: string) => void;
  /** Offer a Clear for an optional single choice that has one. */
  onClear?: () => void;
  /** Offer to make a new one, named by the search when there is one. */
  onCreate?: (query: string) => void;
  /** "ingredient" → "＋ New ingredient". */
  createNoun?: string;
  onClose: () => void;
}

export function PickList({ title, items, selected, multi = false, anchor, onToggle, onClear, onCreate, createNoun, onClose }: PickListProps) {
  const { t } = useLingui();
  const phone = usePhone();
  const [query, setQuery] = useState("");
  const headingId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<(Placement & { width: number }) | null>(null);

  useLayoutEffect(() => {
    const r = anchor.current?.getBoundingClientRect();
    const panel = ref.current?.getBoundingClientRect();
    // Measured after the list is laid out, so a trigger near the bottom of the window flips the
    // panel above it instead of running off the screen.
    if (r && panel) setPos({ ...placeUnder(r, panel), width: Math.max(r.width, 220) });
  }, [anchor, phone]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const byLabel = new Map(items.map((i) => [i.label, i]));
  const shown = filterOptions(items.map((i) => i.label), query).map((l) => byLabel.get(l)!);
  const trimmed = query.trim();

  const choose = (id: string): void => {
    onToggle(id);
    if (!multi) onClose();
  };
  const create = (): void => {
    if (!onCreate) return;
    onCreate(trimmed);
    onClose();
  };

  // Down/Up walk the list; Enter takes the first match, or makes the new one when nothing matches.
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      return onClose();
    }
    if (e.key === "Enter" && document.activeElement === searchRef.current) {
      e.preventDefault();
      if (shown[0]) choose(shown[0].id);
      else if (trimmed && onCreate) create();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const rows = [...(ref.current?.querySelectorAll<HTMLButtonElement>(".k-enum-option, .k-pick-create") ?? [])];
    if (!rows.length) return;
    const at = rows.findIndex((b) => b === document.activeElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    const next = at < 0 ? rows[0] : rows[(at + step + rows.length) % rows.length];
    next?.focus();
  };

  const noun = createNoun ?? title;

  return createPortal(
    <div className="k-menu-layer">
      <div className="k-menu-scrim" onClick={onClose} />
      <div
        ref={ref}
        className={`k-enum-list${phone ? " k-enum-list-sheet" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        style={phone ? undefined : pos ? { top: pos.top, bottom: pos.bottom, left: pos.left, minWidth: pos.width } : { visibility: "hidden" }}
        onKeyDown={onKey}
      >
        <div className="k-menu-grip" aria-hidden />
        <h4 id={headingId} className="k-enum-list-title">
          {title}
        </h4>
        <input
          ref={searchRef}
          className="k-input k-enum-search"
          type="search"
          placeholder={t({ message: "Search", comment: "The search box at the top of a list to pick from" })}
          aria-label={t`Search ${title}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="k-enum-options" role="listbox" aria-label={title} aria-multiselectable={multi || undefined}>
          {shown.map((item) => {
            const on = selected.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={on}
                className="k-enum-option"
                data-on={on || undefined}
                onClick={() => choose(item.id)}
              >
                {item.swatch ? <span className="k-enum-dot" aria-hidden {...item.swatch} /> : null}
                <span className="k-enum-option-label">{item.label}</span>
              </button>
            );
          })}
          {shown.length === 0 && !onCreate ? <p className="k-enum-none">
              <Trans>Nothing matches “{query}”.</Trans>
            </p> : null}
        </div>
        {onCreate ? (
          <button type="button" className="k-pick-create" onClick={create}>
            ＋ {trimmed ? t({ message: `Add: ${noun} “${trimmed}”`, comment: "Make a new record named with what was typed; noun is the app's word for it" }) : t({ message: `Add: ${noun}`, comment: "Make a new record; noun is the app's word for it" })}
          </button>
        ) : null}
        {multi ? (
          <button type="button" className="k-add k-primary-action k-enum-clear" onClick={onClose}>
            <Trans comment="Close a list where several can be picked">Done</Trans>
          </button>
        ) : onClear && selected.size ? (
          <button
            type="button"
            className="k-add k-enum-clear"
            onClick={() => {
              onClear();
              onClose();
            }}
          >
            <Trans comment="Take the chosen value off">Clear</Trans>
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
