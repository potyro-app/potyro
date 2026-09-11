// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DurationInput, NumberInput, nudge, wantsStepper } from "../src/number-input.js";
import { formatDuration, formatWithUnit } from "../src/units.js";
import type { DurationField, NumberField } from "karta";

// Numbers with their unit, a stepper where a value is nudged rather than typed, the right phone
// keyboard, and durations as h : min (#99).

afterEach(cleanup);

const days: NumberField = { type: "number", unit: "days", min: 1, integer: true };
const rating: NumberField = { type: "number", min: 0, max: 5, step: 0.5 };
const price: NumberField = { type: "number", unit: "$/kg", min: 0 };

describe("formatting", () => {
  it("puts the unit after the number, integers whole, decimals trimmed", () => {
    expect(formatWithUnit(7, days)).toBe("7 days");
    expect(formatWithUnit(7.4, days)).toBe("7 days");
    expect(formatWithUnit(2.5, rating)).toBe("2.5");
    expect(formatWithUnit(3.10000001, price)).toBe("3.1 $/kg");
    expect(formatWithUnit(null, days)).toBe("");
  });

  it("reads a duration in its unit, splitting minutes and hours", () => {
    expect(formatDuration(90, { unit: "min" })).toBe("1 h 30 min");
    expect(formatDuration(120, { unit: "min" })).toBe("2 h");
    expect(formatDuration(45, { unit: "min" })).toBe("45 min");
    expect(formatDuration(1.5, { unit: "h" })).toBe("1 h 30 min");
    expect(formatDuration(1500, { unit: "ms" })).toBe("1500 ms");
    expect(formatDuration(30, { unit: "s" })).toBe("30 s");
  });
});

describe("stepper", () => {
  it("appears for stepped, integer or small-ranged fields, not for an open decimal", () => {
    expect(wantsStepper(days)).toBe(true);
    expect(wantsStepper(rating)).toBe(true);
    expect(wantsStepper({ type: "number", min: 0, max: 50 })).toBe(true);
    expect(wantsStepper(price)).toBe(false);
  });

  it("nudges by the step, clamps to the range, and starts from the minimum when empty", () => {
    expect(nudge(7, days, 1)).toBe(8);
    expect(nudge(1, days, -1)).toBe(1);
    expect(nudge(null, days, 1)).toBe(1);
    expect(nudge(2.5, rating, 1)).toBe(3);
    expect(nudge(5, rating, 1)).toBe(5);
    expect(nudge(0.1, { type: "number", step: 0.1 }, 1)).toBe(0.2); // no float dust
  });
});

describe("NumberInput", () => {
  it("shows the unit, picks the keyboard, and steps with the buttons", () => {
    const onChange = vi.fn();
    render(<NumberInput field={days} value={7} onChange={onChange} label="Watering interval" />);
    const input = screen.getByRole("spinbutton", { name: "Watering interval" }) as HTMLInputElement;
    expect(input.value).toBe("7");
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(screen.getByText("days")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Increase Watering interval" }));
    expect(onChange).toHaveBeenLastCalledWith(8);
    fireEvent.click(screen.getByRole("button", { name: "Decrease Watering interval" }));
    expect(onChange).toHaveBeenLastCalledWith(6);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("has no stepper for an open decimal, and a decimal keyboard", () => {
    render(<NumberInput field={price} value={3.1} onChange={() => {}} label="Price" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect((screen.getByRole("spinbutton", { name: "Price" }) as HTMLInputElement).getAttribute("inputmode")).toBe("decimal");
  });

  it("disables the button at the edge of the range", () => {
    render(<NumberInput field={rating} value={5} onChange={() => {}} label="Rating" />);
    expect((screen.getByRole("button", { name: "Increase Rating" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Decrease Rating" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("DurationInput", () => {
  it("enters minutes as h : min and stores the field's unit", () => {
    const onChange = vi.fn();
    const field: DurationField = { type: "duration", unit: "min" };
    render(<DurationInput field={field} value={90} onChange={onChange} label="Rest" />);
    const h = screen.getByRole("spinbutton", { name: "Rest hours" }) as HTMLInputElement;
    const m = screen.getByRole("spinbutton", { name: "Rest minutes" }) as HTMLInputElement;
    expect([h.value, m.value]).toEqual(["1", "30"]);
    fireEvent.change(m, { target: { value: "45" } });
    expect(onChange).toHaveBeenLastCalledWith(105);
    fireEvent.change(h, { target: { value: "" } });
    fireEvent.change(m, { target: { value: "" } });
  });

  it("stores hours as a fraction when the unit is hours", () => {
    const onChange = vi.fn();
    render(<DurationInput field={{ type: "duration", unit: "h" }} value={1.5} onChange={onChange} label="Nap" />);
    expect((screen.getByRole("spinbutton", { name: "Nap minutes" }) as HTMLInputElement).value).toBe("30");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Nap hours" }), { target: { value: "2" } });
    expect(onChange).toHaveBeenLastCalledWith(2.5);
  });
});
