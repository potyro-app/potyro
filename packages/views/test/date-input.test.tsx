// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DateTimeField } from "karta";
import { DateInput } from "../src/date-input.js";
import { formatDateAbsolute, formatDateForInput, formatDateRelative, parseTypedDay, relativeDay, startOfDay } from "../src/dates.js";

// A date is a day unless the field asks for the minute (#103): the box says it in words, the
// chips set the common answers, the picker is a month grid, and typing still works.

afterEach(cleanup);

const now = new Date(2026, 8, 12, 15, 30); // Sat 12 Sep 2026, 15:30
const day: DateTimeField = { type: "datetime" };
const minute: DateTimeField = { type: "datetime", precision: "minute" };

describe("words for a date", () => {
  it("names the near days and counts the rest", () => {
    expect(relativeDay(new Date(2026, 8, 12, 1), now)).toBe("today");
    expect(relativeDay(new Date(2026, 8, 13), now)).toBe("tomorrow");
    expect(relativeDay(new Date(2026, 8, 11, 23), now)).toBe("yesterday");
    expect(relativeDay(new Date(2026, 8, 15), now)).toBe("in 3 days");
    expect(relativeDay(new Date(2026, 8, 9), now)).toBe("3 days ago");
    expect(relativeDay(new Date(2026, 8, 30), now)).toBeNull();
  });

  it("shows a day without a time, and a minute field with one", () => {
    const d = new Date(2026, 8, 12, 18, 30);
    // Day and month order, and the clock, are the locale's; the words and the absence of a time
    // are ours. `clock` is whatever this machine's locale calls 18:30 ("18:30" or "06:30 PM").
    const clock = (x: Date): string => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(x);
    expect(formatDateForInput(d, "day", now)).toMatch(/^Today, (12 Sep|Sep 12)$/);
    expect(formatDateForInput(d, "minute", now)).toBe(`${formatDateForInput(d, "day", now)} · ${clock(d)}`);
    expect(formatDateAbsolute(d, "day")).not.toContain(clock(d));
    expect(formatDateAbsolute(d, "minute")).toContain(clock(d));
    const tomorrowMorning = new Date(2026, 8, 13, 9);
    expect(formatDateRelative(tomorrowMorning, "day", now)).toBe("tomorrow");
    expect(formatDateRelative(tomorrowMorning, "minute", now)).toBe(`tomorrow ${clock(tomorrowMorning)}`);
    expect(formatDateRelative(new Date(2026, 9, 3), "day", now)).toMatch(/^(3 Oct|Oct 3)$/);
    expect(formatDateRelative(new Date(2027, 0, 3), "day", now)).toMatch(/2027/);
  });
});

describe("typing a date", () => {
  it("reads ISO, day/month/year, a month name, and the words", () => {
    expect(parseTypedDay("2026-09-12", now)).toEqual(new Date(2026, 8, 12));
    expect(parseTypedDay("12/9/2026", now)).toEqual(new Date(2026, 8, 12));
    expect(parseTypedDay("12.09.26", now)).toEqual(new Date(2026, 8, 12));
    expect(parseTypedDay("12 sep", now)).toEqual(new Date(2026, 8, 12));
    expect(parseTypedDay("Sep 12, 2027", now)).toEqual(new Date(2027, 8, 12));
    expect(parseTypedDay("tomorrow", now)).toEqual(new Date(2026, 8, 13));
    expect(parseTypedDay("yesterday", now)).toEqual(new Date(2026, 8, 11));
    expect(parseTypedDay("today", now)).toEqual(startOfDay(now));
    expect(parseTypedDay("soonish", now)).toBeNull();
    expect(parseTypedDay("", now)).toBeNull();
  });
});

describe("DateInput", () => {
  it("reads as a day, the chips set a day at midnight, and Clear empties it", () => {
    const onChange = vi.fn();
    render(<DateInput field={day} value={new Date()} onChange={onChange} label="Watered" />);
    const box = screen.getByRole("textbox", { name: "Watered" }) as HTMLInputElement;
    expect(box.value).toMatch(/^Today, /);
    expect(box.value).not.toMatch(/\d:\d\d/);
    expect(screen.queryByLabelText("Watered time")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    const picked = onChange.mock.calls[0]![0] as Date;
    expect(picked.getHours()).toBe(0);
    expect(picked.getDate()).toBe(new Date(Date.now() + 86_400_000).getDate());
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("takes a typed day on blur and keeps the box as it was on a typo", () => {
    const onChange = vi.fn();
    render(<DateInput field={day} value={null} onChange={onChange} label="Due" />);
    const box = screen.getByRole("textbox", { name: "Due" }) as HTMLInputElement;
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "2026-12-24" } });
    fireEvent.blur(box);
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 11, 24));
    onChange.mockClear();
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "whenever" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(box.value).toBe("");
  });

  it("a minute field keeps an hour box and carries the time onto a new day", () => {
    const onChange = vi.fn();
    render(<DateInput field={minute} value={new Date(2026, 8, 12, 18, 30)} onChange={onChange} label="Start" />);
    const time = screen.getByLabelText("Start time") as HTMLInputElement;
    expect(time.value).toBe("18:30");
    fireEvent.change(time, { target: { value: "07:15" } });
    expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 8, 12, 7, 15));
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    const picked = onChange.mock.calls.at(-1)![0] as Date;
    expect(`${picked.getHours()}:${picked.getMinutes()}`).toBe("18:30");
  });

  it("the calendar button opens a month grid; a day in it is picked and the dialog closes", () => {
    const onChange = vi.fn();
    render(<DateInput field={day} value={new Date(2026, 8, 12)} onChange={onChange} label="Due" />);
    fireEvent.click(screen.getByRole("button", { name: "Pick Due" }));
    const dialog = screen.getByRole("dialog", { name: "Due" });
    expect(dialog.querySelector(".k-date-day[data-selected]")?.textContent).toBe("12");
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: new Date(2026, 9, 3).toDateString() }));
    expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 9, 3));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
