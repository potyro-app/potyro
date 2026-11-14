// A one-line text field that offers what was typed there before (#82): `suggest` on a `text` field.
//
// Between a fixed `enum` (a value outside the list is refused) and free `text` (nothing is offered)
// there was no control for a list that grows with the person's data — a wine's region, a shop, a
// brand. This is the text input it always was, with the values the records already hold under it:
// typing narrows them, a tap or Enter takes one, and anything else is kept as typed and offered the
// next time. Nothing is refused, and what is stored is plain text.
//
// The list sits under the input, in the form's own flow of focus: the keyboard never leaves the
// field (the ARIA combobox pattern — the active option is named by `aria-activedescendant`), and a
// finger scrolls and taps the list without closing the phone's keyboard.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLingui } from "@lingui/react/macro";
import { DISTINCT_VALUES_CAP, suggestedValues, valueKey, type PotyroRuntime } from "@potyro/runtime";
import { filterOptions } from "./enum.js";
import { Glyph } from "./glyph.js";

/** Where a field's used values are read from: the records of its own entity. */
export interface SuggestSource {
  entity: string;
  field: string;
}

export interface SuggestInputProps {
  runtime: PotyroRuntime;
  /** The app's starting values (`suggest: [...]`); `true` declares none. */
  suggest: true | readonly string[];
  /** Absent for a field with no records behind it (a list row, `ctx.ui.form`): the declared values only. */
  source?: SuggestSource;
  value: unknown;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
}

const NONE: readonly string[] = [];
const NO_ROWS: readonly Readonly<Record<string, unknown>>[] = [];

export function SuggestInput(props: SuggestInputProps) {
  // Two components, so the query hook is only ever called for a field that has records to read.
  return props.source ? <FromRecords {...props} source={props.source} /> : <SuggestBox {...props} rows={NO_ROWS} />;
}

function FromRecords(props: SuggestInputProps & { source: SuggestSource }) {
  // Every record of the entity, read by the host: the same query a filter's chips run.
  const { rows } = props.runtime.useQuery(props.source.entity);
  return <SuggestBox {...props} rows={rows} />;
}

/** The value as it is saved: no space around it, and an offered choice in the spelling it is offered in. */
export function settle(typed: string, choices: readonly string[]): string {
  const text = typed.trim();
  const key = valueKey(text);
  return choices.find((c) => valueKey(c) === key) ?? text;
}

function SuggestBox({ suggest, source, rows, value, onChange, label, placeholder }: SuggestInputProps & { rows: readonly Readonly<Record<string, unknown>>[] }) {
  const { t } = useLingui();
  const text = typeof value === "string" ? value : "";
  const declared = suggest === true ? NONE : suggest;
  const choices = useMemo(() => suggestedValues(rows, source?.field ?? "", declared), [rows, source?.field, declared]);

  const [open, setOpen] = useState(false);
  // Until something is typed the whole list is on offer: a field that already says "Barolo" must
  // not open on "Barolo" alone.
  const [narrowing, setNarrowing] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const query = narrowing ? text : "";
  const matches = useMemo(() => filterOptions(choices, query).slice(0, DISTINCT_VALUES_CAP), [choices, query]);
  const typed = text.trim();
  const known = choices.some((c) => valueKey(c) === valueKey(typed));
  // A value nobody used yet is not a mistake: say that it will be kept.
  const offersNew = narrowing && typed !== "" && !known;
  const count = matches.length + (offersNew ? 1 : 0);
  const shown = open && count > 0;

  useEffect(() => {
    if (!shown) return;
    const list = listRef.current;
    // Its own row when one is walked to, the list itself when it opens — under a phone's keyboard
    // or at the foot of a sheet it would otherwise open out of sight.
    const el = active >= 0 ? list?.children[active] : list;
    (el as HTMLElement | undefined)?.scrollIntoView?.({ block: "nearest" });
  }, [shown, active]);

  const close = (): void => {
    setOpen(false);
    setNarrowing(false);
    setActive(-1);
  };
  const take = (choice: string): void => {
    if (choice !== text) onChange(choice);
    close();
  };
  const takeAt = (i: number): void => take(i < matches.length ? matches[i]! : typed);

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const all = shown ? count : Math.min(choices.length, DISTINCT_VALUES_CAP);
      if (!all) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((at) => (at < 0 ? (step > 0 ? 0 : all - 1) : (at + step + all) % all));
      return;
    }
    if (e.key === "Escape" && shown) {
      // The list closes; the sheet the form is in stays.
      e.stopPropagation();
      e.preventDefault();
      return close();
    }
    if (e.key !== "Enter") return;
    if (shown && active >= 0) {
      e.preventDefault();
      return takeAt(active);
    }
    // "barolo" where "Barolo" is offered: Enter settles the spelling first, and saves the next time.
    const settled = settle(text, choices);
    if (settled !== text) {
      e.preventDefault();
      take(settled);
    }
  };

  return (
    <div className="k-suggest">
      <input
        className="k-input"
        type="text"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        // A tap or a click opens it; arriving with Tab does not — a list dropping over the next
        // field, or over Save, at every stop of a walk through the form is in the way. Typing and
        // the Down key open it from the keyboard.
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setOpen(true);
          setNarrowing(true);
          setActive(-1);
          onChange(e.target.value);
        }}
        onBlur={() => {
          const settled = settle(text, choices);
          if (settled !== text) onChange(settled);
          close();
        }}
        onKeyDown={onKey}
      />
      {shown ? (
        <div
          ref={listRef}
          id={listId}
          className="k-suggest-list"
          role="listbox"
          aria-label={label}
          // The field keeps the focus (and the phone its keyboard) while the list is tapped.
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.map((choice, i) => (
            <div
              key={choice}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={valueKey(choice) === valueKey(typed)}
              className="k-enum-option k-suggest-option"
              data-on={valueKey(choice) === valueKey(typed) || undefined}
              data-active={i === active || undefined}
              onClick={() => take(choice)}
            >
              <span className="k-enum-option-label">{choice}</span>
            </div>
          ))}
          {offersNew ? (
            <div
              id={`${listId}-${matches.length}`}
              role="option"
              aria-selected={false}
              className="k-enum-option k-suggest-option k-suggest-new"
              data-active={active === matches.length || undefined}
              onClick={() => take(typed)}
            >
              <Glyph icon="plus" size={16} />
              <span className="k-enum-option-label">
                {t({ message: `Add “${typed}”`, comment: "In a text field that offers the values used before: keep what was typed as a new value" })}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
