// The date field's control (#103). A day, not a moment: the box says "Today, 12 Sep", the chips
// under it set the common answers in one tap, and the calendar button opens a month grid — a
// sheet on a phone, a popover on a wide screen. Only a field that asks for `precision: "minute"`
// gets an hour box beside the date; the rest never show a time. Typing into the box still works:
// `2026-09-12`, `12/9/2026`, `12 sep`, or "tomorrow".

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { DateTimeField } from "potyro";
import { buildMonthGrid, sameDay } from "./calendar.js";
import { usePhone } from "./media.js";
import { addDays, formatDateForInput, parseTypedDay, precisionOf, startOfDay, toDate, toIsoTime, withTime } from "./dates.js";
import { placeUnder, type Placement } from "./popover.js";

export interface DateInputProps {
  field: DateTimeField;
  value: unknown;
  onChange: (v: Date | null) => void;
  /** Names the box; the chips and the picker say what they are themselves. */
  label?: string;
}

// Sunday-first, like `buildMonthGrid` and the calendar view — one week shape across the app.
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

export function DateInput({ field, value, onChange, label }: DateInputProps) {
  const precision = precisionOf(field);
  const current = toDate(value);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);

  /** Set a day, keeping the time a minute field already had. */
  const pickDay = (day: Date | null): void => {
    if (!day) return onChange(null);
    const time = current && precision === "minute" ? toIsoTime(current) : "";
    onChange(precision === "minute" ? withTime(day, time || toIsoTime(new Date())) : startOfDay(day));
  };

  const commitTyped = (): void => {
    if (editing === null) return;
    const typed = editing.trim();
    setEditing(null);
    if (!typed) return onChange(null);
    const day = parseTypedDay(typed);
    if (day) pickDay(day);
    // Anything else: the box goes back to what it said; nothing is written by a typo.
  };
  const onBoxKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitTyped();
      boxRef.current?.blur();
    } else if (e.key === "Escape") {
      // Abandon what was typed; the box goes back to the day it holds.
      setEditing(null);
      boxRef.current?.blur();
    }
  };

  const today = startOfDay(new Date());
  const chip = (text: string, day: Date | null, on: boolean) => (
    <button key={text} type="button" className="k-date-chip" data-on={on || undefined} onClick={() => pickDay(day)}>
      {text}
    </button>
  );
  const isDay = (d: Date | null): boolean => Boolean(current && d && sameDay(current, d));

  return (
    <div className="k-date">
      <div className="k-date-row">
        <input
          ref={boxRef}
          className="k-input k-date-box"
          type="text"
          inputMode="numeric"
          aria-label={label}
          placeholder="Pick a day"
          // The box holds the day. A minute field's hour lives in the time box beside it, so it is
          // not repeated here — repeating it overflowed the box on a phone and read as two answers.
          value={editing ?? (current ? formatDateForInput(current, "day") : "")}
          // Focus selects what is there rather than rewriting it: swapping the friendly text for a
          // raw date under the caret moves the caret and makes typing land in the middle of it.
          // Selected text means the first keystroke replaces the day, which is what typing means here.
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={commitTyped}
          onKeyDown={onBoxKey}
        />
        {precision === "minute" ? (
          <input
            className="k-input k-date-time"
            type="time"
            aria-label={label ? `${label} time` : "Time"}
            value={current ? toIsoTime(current) : ""}
            onChange={(e) => onChange(withTime(current ?? today, e.target.value))}
          />
        ) : null}
        <button ref={openRef} type="button" className="k-date-open" aria-label={label ? `Pick ${label}` : "Pick a date"} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
          📅
        </button>
      </div>
      <div className="k-date-chips" role="group" aria-label={label ? `${label} shortcuts` : "Shortcuts"}>
        {chip("Today", today, isDay(today))}
        {chip("Yesterday", addDays(today, -1), isDay(addDays(today, -1)))}
        {chip("Tomorrow", addDays(today, 1), isDay(addDays(today, 1)))}
        {current ? chip("Clear", null, false) : null}
      </div>
      {open ? (
        <DatePicker
          title={label ?? "Date"}
          value={current}
          anchor={boxRef}
          onPick={(d) => pickDay(d)}
          onClose={() => {
            setOpen(false);
            // Back to the button that opened it, not into the box: focusing the box would put it
            // in typing mode holding the value from before the pick, and blank what was just set.
            openRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

/** The month grid: a sheet on a phone, a popover under the box on a wide screen. */
function DatePicker({ title, value, anchor, onPick, onClose }: { title: string; value: Date | null; anchor: React.RefObject<HTMLInputElement | null>; onPick: (d: Date | null) => void; onClose: () => void }) {
  const phone = usePhone();
  const today = startOfDay(new Date());
  const [month, setMonth] = useState<Date>(() => new Date((value ?? today).getFullYear(), (value ?? today).getMonth(), 1));
  const ref = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const [pos, setPos] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const r = anchor.current?.getBoundingClientRect();
    const panel = ref.current?.getBoundingClientRect();
    // Placed once the grid is laid out: a field near the bottom of the window gets the month above
    // the box rather than half of it below the fold.
    if (r && panel) setPos(placeUnder(r, panel));
  }, [anchor, phone, month]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("[data-selected], [data-today]")?.focus();
  }, []);

  const grid = buildMonthGrid(month);

  const pick = (d: Date): void => {
    onPick(d);
    onClose();
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };
  const chip = (text: string, d: Date) => (
    <button key={text} type="button" className="k-date-chip" data-on={value && sameDay(value, d) ? "true" : undefined} onClick={() => pick(d)}>
      {text}
    </button>
  );

  return createPortal(
    <div className="k-menu-layer">
      <div className="k-menu-scrim" onClick={onClose} />
      <div
        ref={ref}
        className={`k-date-picker${phone ? " k-date-picker-sheet" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        style={phone ? undefined : pos ? { top: pos.top, bottom: pos.bottom, left: pos.left } : { visibility: "hidden" }}
        onKeyDown={onKey}
      >
        <div className="k-menu-grip" aria-hidden />
        <h4 id={headingId} className="k-date-picker-title">
          {title}
        </h4>
        <div className="k-date-chips">
          {chip("Today", today)}
          {chip("Yesterday", addDays(today, -1))}
          {chip("Tomorrow", addDays(today, 1))}
          {chip("+1 week", addDays(today, 7))}
        </div>
        <div className="k-date-month">
          <button type="button" className="k-date-nav" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            ‹
          </button>
          <strong aria-live="polite">{MONTH.format(month)}</strong>
          <button type="button" className="k-date-nav" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            ›
          </button>
        </div>
        <div className="k-date-grid" role="grid" aria-label={MONTH.format(month)}>
          {WEEKDAYS.map((w) => (
            <span key={w} className="k-date-weekday" aria-hidden>
              {w}
            </span>
          ))}
          {grid.map((cell) => (
            <button
              key={cell.date.toISOString()}
              type="button"
              className="k-date-day"
              data-out={!cell.inMonth || undefined}
              data-today={sameDay(cell.date, today) || undefined}
              data-selected={value && sameDay(cell.date, value) ? "true" : undefined}
              aria-label={cell.date.toDateString()}
              aria-pressed={value ? sameDay(cell.date, value) : undefined}
              onClick={() => pick(cell.date)}
            >
              {cell.date.getDate()}
            </button>
          ))}
        </div>
        <div className="k-date-picker-actions">
          <button
            type="button"
            className="k-add"
            onClick={() => {
              onPick(null);
              onClose();
            }}
          >
            Clear
          </button>
          <button type="button" className="k-add k-primary-action" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
