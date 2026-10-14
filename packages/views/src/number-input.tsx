// Number and duration inputs (#99). A number field declares `unit`, `min`, `max`, `step` and
// `integer`; the input used to pass three of those to the browser and drop the unit on the floor,
// so "3 sets" was typed into a full-width box with no unit, no stepper and the wrong keyboard.
//
// Now: the unit sits inside the field as a suffix; a stepper (− / +, 44px, long-press repeats)
// appears when the field is stepped, integer or small-ranged; `inputmode` picks the phone's
// numeric or decimal keyboard; a duration in hours or minutes is entered as `h : min`.

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { ShownDurationField as DurationField, ShownNumberField as NumberField } from "./shown.js";

const HOLD_MS = 400;
const REPEAT_MS = 80;

/** A stepper earns its place when the value is meant to be nudged, not typed. */
export function wantsStepper(field: NumberField): boolean {
  if (field.step !== undefined) return true;
  if (field.integer) return true;
  return field.min !== undefined && field.max !== undefined && field.max - field.min <= 100;
}

/** How far one press moves: the declared step, else 1. */
export const stepOf = (field: Pick<NumberField, "step" | "integer">): number => field.step ?? 1;

/** The value after a nudge, kept inside the range and free of float dust. */
export function nudge(value: number | null | undefined, field: NumberField, direction: 1 | -1): number {
  const step = stepOf(field);
  const base = typeof value === "number" && Number.isFinite(value) ? value : (field.min ?? 0) - (direction > 0 ? step : 0);
  let next = base + direction * step;
  if (field.min !== undefined) next = Math.max(field.min, next);
  if (field.max !== undefined) next = Math.min(field.max, next);
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Number(next.toFixed(decimals));
}

/** Hold a button and it keeps going. */
function useRepeat(fire: () => void): { onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void; onPointerUp: () => void; onPointerLeave: () => void; onPointerCancel: () => void } {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = (): void => {
    if (timer.current) clearTimeout(timer.current);
    if (interval.current) clearInterval(interval.current);
    timer.current = null;
    interval.current = null;
  };
  useEffect(() => stop, []);
  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      stop();
      timer.current = setTimeout(() => {
        interval.current = setInterval(fire, REPEAT_MS);
      }, HOLD_MS);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
  };
}

export interface NumberInputProps {
  field: NumberField | (DurationField & { unit?: string });
  value: unknown;
  onChange: (v: number | null) => void;
  /** Names the input when the surrounding row does not (a list column). */
  label?: string;
}

export function NumberInput({ field, value, onChange, label }: NumberInputProps) {
  const num = field.type === "number" ? field : ({ type: "number", min: 0 } as NumberField);
  const integer = field.type === "number" ? Boolean(field.integer) : field.unit !== undefined && field.unit !== "h";
  const stepper = field.type === "number" ? wantsStepper(num) : false;
  const current = typeof value === "number" && Number.isFinite(value) ? value : null;
  const down = (): void => onChange(nudge(current, num, -1));
  const up = (): void => onChange(nudge(current, num, 1));
  const holdDown = useRepeat(down);
  const holdUp = useRepeat(up);
  const atMin = current !== null && num.min !== undefined && current <= num.min;
  const atMax = current !== null && num.max !== undefined && current >= num.max;
  return (
    <span className="k-number" data-stepper={stepper}>
      {stepper ? (
        <button type="button" className="k-number-step" aria-label={`Decrease${label ? ` ${label}` : ""}`} disabled={atMin} onClick={down} {...holdDown}>
          −
        </button>
      ) : null}
      <span className="k-number-field">
        <input
          className="k-input k-number-input"
          type="number"
          inputMode={integer ? "numeric" : "decimal"}
          aria-label={label}
          placeholder={field.placeholder}
          value={current === null ? "" : String(current)}
          min={num.min}
          max={num.max}
          step={field.type === "number" ? (field.step ?? (field.integer ? 1 : "any")) : "any"}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
        {field.unit ? (
          <span className="k-number-unit" aria-hidden>
            {field.unit}
          </span>
        ) : null}
      </span>
      {stepper ? (
        <button type="button" className="k-number-step" aria-label={`Increase${label ? ` ${label}` : ""}`} disabled={atMax} onClick={up} {...holdUp}>
          +
        </button>
      ) : null}
    </span>
  );
}

/** A duration in hours or minutes, entered as `h : min` and stored in the field's unit. */
export function DurationInput({ field, value, onChange, label }: { field: DurationField; value: unknown; onChange: (v: number | null) => void; label?: string }) {
  const total = typeof value === "number" && Number.isFinite(value) ? value : null;
  const inMinutes = field.unit === "h" ? (total === null ? null : Math.round(total * 60)) : total;
  const hours = inMinutes === null ? "" : String(Math.floor(inMinutes / 60));
  const minutes = inMinutes === null ? "" : String(inMinutes % 60);
  const emit = (h: string, m: string): void => {
    if (h === "" && m === "") return onChange(null);
    const mins = (Number(h) || 0) * 60 + (Number(m) || 0);
    onChange(field.unit === "h" ? Number((mins / 60).toFixed(4)) : mins);
  };
  return (
    <span className="k-number k-duration" role="group" aria-label={label}>
      <span className="k-number-field">
        <input className="k-input k-number-input" type="number" inputMode="numeric" min={0} aria-label={`${label ? `${label} ` : ""}hours`} value={hours} onChange={(e) => emit(e.target.value, minutes)} />
        <span className="k-number-unit" aria-hidden>h</span>
      </span>
      <span className="k-duration-colon" aria-hidden>:</span>
      <span className="k-number-field">
        <input className="k-input k-number-input" type="number" inputMode="numeric" min={0} max={59} aria-label={`${label ? `${label} ` : ""}minutes`} value={minutes} onChange={(e) => emit(hours, e.target.value)} />
        <span className="k-number-unit" aria-hidden>min</span>
      </span>
    </span>
  );
}
