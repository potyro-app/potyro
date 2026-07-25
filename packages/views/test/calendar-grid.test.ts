import { describe, expect, it } from "vitest";
import { buildMonthGrid, sameDay } from "../src/calendar.js";

// Pure date-grid logic for the calendar view (issue #17). No React — this is the part with real
// edge cases (month boundaries, leading/trailing days, leap years).

describe("buildMonthGrid", () => {
  it("always returns a 6-week (42-cell) grid starting on Sunday", () => {
    const grid = buildMonthGrid(new Date(2026, 6, 1)); // July 2026
    expect(grid).toHaveLength(42);
    expect(grid[0]!.date.getDay()).toBe(0); // first cell is a Sunday
    expect(grid[41]!.date.getDay()).toBe(6); // last cell is a Saturday
  });

  it("marks in-month vs adjacent-month days", () => {
    // July 2026: the 1st is a Wednesday, so the grid leads with Jun 28–30 (out of month).
    const grid = buildMonthGrid(new Date(2026, 6, 1));
    expect(grid[0]).toMatchObject({ inMonth: false }); // Sun Jun 28
    expect(grid[0]!.date.getMonth()).toBe(5); // June
    const firstOfJuly = grid.find((c) => c.inMonth && c.date.getDate() === 1)!;
    expect(firstOfJuly.date.getDay()).toBe(3); // Wednesday
    expect(grid.filter((c) => c.inMonth)).toHaveLength(31); // July has 31 days
  });

  it("handles a leap-year February", () => {
    const grid = buildMonthGrid(new Date(2024, 1, 15)); // Feb 2024 (leap)
    expect(grid.filter((c) => c.inMonth)).toHaveLength(29);
  });

  it("handles a non-leap February", () => {
    const grid = buildMonthGrid(new Date(2026, 1, 10)); // Feb 2026
    expect(grid.filter((c) => c.inMonth)).toHaveLength(28);
  });

  it("uses the month of the given date regardless of day-of-month", () => {
    const fromFirst = buildMonthGrid(new Date(2026, 2, 1));
    const fromLast = buildMonthGrid(new Date(2026, 2, 31));
    expect(fromFirst.map((c) => c.date.getTime())).toEqual(fromLast.map((c) => c.date.getTime()));
  });
});

describe("sameDay", () => {
  it("ignores time-of-day", () => {
    expect(sameDay(new Date(2026, 6, 20, 9, 0), new Date(2026, 6, 20, 23, 59))).toBe(true);
  });
  it("distinguishes different days", () => {
    expect(sameDay(new Date(2026, 6, 20), new Date(2026, 6, 21))).toBe(false);
    expect(sameDay(new Date(2026, 6, 20), new Date(2026, 7, 20))).toBe(false);
  });
});
