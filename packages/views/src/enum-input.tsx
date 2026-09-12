// Choosing one of a fixed set (#98). A short list is a row of buttons you can see all of at once;
// a long one is a picker with a search field — a bottom sheet on a phone, a popover on a wide
// screen. Neither is the browser's `<select>`, which was the one unstyled control left in the form
// and which hides its options until you open it.
//
// A required field with no default starts on nothing: the first option is not an answer the person
// gave.

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { EnumField } from "karta";
import { usePhone } from "./media.js";
import { enumSwatch, filterOptions, wantsSegmented } from "./enum.js";
import { placeUnder } from "./popover.js";

export interface EnumInputProps {
  field: EnumField;
  value: unknown;
  onChange: (v: string | null) => void;
  /** Names the group or the picker button; the options say what they are themselves. */
  label?: string;
}

export function EnumInput({ field, value, onChange, label }: EnumInputProps) {
  const current = typeof value === "string" && value ? value : null;
  return wantsSegmented(field) ? (
    <EnumSegments field={field} current={current} onChange={onChange} label={label} />
  ) : (
    <EnumPicker field={field} current={current} onChange={onChange} label={label} />
  );
}

/** The value as it reads everywhere else: the word, tinted by its colour. */
export function EnumPill({ field, value }: { field?: Pick<EnumField, "colors">; value: string }) {
  return (
    <span className="k-enum-pill" {...enumSwatch(field, value)}>
      {value}
    </span>
  );
}

/** Up to five options: all of them, in a row, one tap. */
function EnumSegments({ field, current, onChange, label }: { field: EnumField; current: string | null; onChange: (v: string | null) => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  // Arrow keys move within the group, as a set of radio buttons does; tab moves past it.
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = buttons.findIndex((b) => b === document.activeElement);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const next = buttons[(at + step + buttons.length) % buttons.length];
    next?.focus();
    next?.click();
  };

  return (
    <div ref={ref} className="k-enum-segments" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {field.options.map((o) => {
        const on = current === o;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={on}
            className="k-enum-segment"
            data-on={on || undefined}
            // Tapping the chosen one again clears it, unless the field must have an answer.
            onClick={() => onChange(on && !field.required ? null : o)}
            tabIndex={on || (!current && field.options[0] === o) ? 0 : -1}
            {...enumSwatch(field, o)}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

/** Six or more options: a button showing the choice, and a searchable list behind it. */
function EnumPicker({ field, current, onChange, label }: { field: EnumField; current: string | null; onChange: (v: string | null) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="k-enum">
      <button
        ref={btnRef}
        type="button"
        className="k-enum-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label ? (current ? `${label}: ${current}` : `${label}: choose`) : undefined}
        onClick={() => setOpen(true)}
      >
        {current ? <EnumPill field={field} value={current} /> : <span className="k-enum-empty">Choose…</span>}
        <span className="k-enum-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <OptionList
          field={field}
          current={current}
          title={label ?? "Choose"}
          anchor={btnRef}
          onPick={(v) => onChange(v)}
          onClose={() => {
            setOpen(false);
            btnRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

function OptionList({
  field,
  current,
  title,
  anchor,
  onPick,
  onClose,
}: {
  field: EnumField;
  current: string | null;
  title: string;
  anchor: React.RefObject<HTMLButtonElement | null>;
  onPick: (v: string | null) => void;
  onClose: () => void;
}) {
  const phone = usePhone();
  const [query, setQuery] = useState("");
  const headingId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

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

  const shown = filterOptions(field.options, query);
  const pick = (v: string | null): void => {
    onPick(v);
    onClose();
  };

  // Down/Up walk the list, Enter takes the first match, Escape gives up.
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      return onClose();
    }
    if (e.key === "Enter" && document.activeElement === searchRef.current) {
      e.preventDefault();
      if (shown[0]) pick(shown[0]);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>(".k-enum-option") ?? [])];
    if (!items.length) return;
    const at = items.findIndex((b) => b === document.activeElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    const next = at < 0 ? items[0] : items[(at + step + items.length) % items.length];
    next?.focus();
  };

  return createPortal(
    <div className="k-menu-layer">
      <div className="k-menu-scrim" onClick={onClose} />
      <div
        ref={ref}
        className={`k-enum-list${phone ? " k-enum-list-sheet" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        style={phone ? undefined : pos ? { top: pos.top, left: pos.left, minWidth: pos.width } : { visibility: "hidden" }}
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
          placeholder="Search"
          aria-label={`Search ${title}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="k-enum-options" role="listbox" aria-label={title}>
          {shown.map((o) => (
            <button
              key={o}
              type="button"
              role="option"
              aria-selected={current === o}
              className="k-enum-option"
              data-on={current === o || undefined}
              onClick={() => pick(o)}
            >
              <span className="k-enum-dot" aria-hidden {...enumSwatch(field, o)} />
              <span className="k-enum-option-label">{o}</span>
            </button>
          ))}
          {shown.length === 0 ? <p className="k-enum-none">Nothing matches “{query}”.</p> : null}
        </div>
        {current && !field.required ? (
          <button type="button" className="k-add k-enum-clear" onClick={() => pick(null)}>
            Clear
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
