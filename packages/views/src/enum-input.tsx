// Choosing one of a fixed set (#98). A short list is a row of buttons you can see all of at once;
// a long one is a picker with a search field — a bottom sheet on a phone, a popover on a wide
// screen. Neither is the browser's `<select>`, which was the one unstyled control left in the form
// and which hides its options until you open it.
//
// A required field with no default starts on nothing: the first option is not an answer the person
// gave.

import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { EnumField } from "potyro";
import { Trans, useLingui } from "@lingui/react/macro";
import { enumSwatch, wantsSegmented } from "./enum.js";
import { PickList } from "./pick-list.js";

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
  const { t } = useLingui();
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
        aria-label={label ? (current ? `${label}: ${current}` : t({ message: `${label}: choose`, comment: "A choice field with nothing chosen yet; {label} is the field" })) : undefined}
        onClick={() => setOpen(true)}
      >
        {current ? <EnumPill field={field} value={current} /> : <span className="k-enum-empty"><Trans>Choose…</Trans></span>}
        <span className="k-enum-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <PickList
          title={label ?? t`Choose`}
          items={field.options.map((o) => ({ id: o, label: o, swatch: enumSwatch(field, o) }))}
          selected={new Set(current ? [current] : [])}
          anchor={btnRef}
          onToggle={(v) => onChange(v)}
          onClear={field.required ? undefined : () => onChange(null)}
          onClose={() => {
            setOpen(false);
            btnRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
