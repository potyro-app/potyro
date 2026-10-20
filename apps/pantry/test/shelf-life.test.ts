// The expiry arithmetic: guesses by kind and place, which printed dates to believe, how soon is soon,
// the reminder the day before (and on the day when it is too late for that), and the waste tally.
import { describe, expect, it } from "vitest";
import {
  byExpiry,
  CATEGORIES,
  daysBetween,
  finishedIn,
  freshness,
  guessExpiry,
  lastMonths,
  plausiblePrinted,
  PLACES,
  remindAt,
  SHELF_DAYS,
  toDate,
  wasteShare,
} from "../shelf-life.js";

/** Thu 15 Oct 2026, 10:00 in Warsaw (TZ pinned in vitest.config.ts). */
const NOW = new Date(2026, 9, 15, 10, 0);
const day = (m: number, d: number, y = 2026) => new Date(y, m - 1, d);

describe("days and dates", () => {
  it("counts midnights, so a clock change cannot move a day", () => {
    expect(daysBetween(NOW, day(10, 16))).toBe(1);
    expect(daysBetween(NOW, day(10, 15))).toBe(0);
    expect(daysBetween(NOW, day(10, 14))).toBe(-1);
    // Winter time starts on 25 Oct 2026 in Warsaw: that day is 25 hours long and still one day.
    expect(daysBetween(day(10, 24), day(10, 26))).toBe(2);
    expect(daysBetween(day(12, 31), day(1, 1, 2027))).toBe(1);
  });

  it("reads a date in every form it can cross in, a bare YYYY-MM-DD as a local day", () => {
    expect(toDate("2026-10-18")).toEqual(day(10, 18));
    expect(toDate(day(10, 18).toISOString())).toEqual(day(10, 18));
    expect(toDate(day(10, 18).getTime())).toEqual(day(10, 18));
    expect(toDate("not a date")).toBeNull();
    expect(toDate(null)).toBeNull();
  });
});

describe("guessing a date", () => {
  it("has a figure for every kind of food in every place, and meat and fish are short", () => {
    for (const c of CATEGORIES) for (const p of PLACES) expect(SHELF_DAYS[c][p], `${c}/${p}`).toBeGreaterThan(0);
    expect(SHELF_DAYS.fish.fridge).toBeLessThanOrEqual(SHELF_DAYS.meat.fridge);
    expect(SHELF_DAYS.meat.fridge).toBeLessThan(SHELF_DAYS.dairy.fridge);
    // The freezer keeps things longer than the fridge, always.
    for (const c of CATEGORIES) expect(SHELF_DAYS[c].freezer, c).toBeGreaterThanOrEqual(SHELF_DAYS[c].fridge);
  });

  it("counts from the day it came home, as a calendar day", () => {
    expect(guessExpiry("dairy", "fridge", NOW)).toEqual(day(10, 22));
    expect(guessExpiry("meat", "fridge", NOW)).toEqual(day(10, 17));
    expect(guessExpiry("meat", "freezer", NOW)).toEqual(day(2, 12, 2027));
  });

  it("believes a printed date a few days past, and drops one that is surely a misread", () => {
    expect(plausiblePrinted(day(10, 12), NOW)).toEqual(day(10, 12));
    expect(plausiblePrinted(day(11, 30), NOW)).toEqual(day(11, 30));
    expect(plausiblePrinted(day(7, 1), NOW)).toBeNull(); // months ago: a "packed on", not a best-before
    expect(plausiblePrinted(day(1, 1, 2034), NOW)).toBeNull(); // years ahead: a lot number
    expect(plausiblePrinted(null, NOW)).toBeNull();
  });
});

describe("how soon", () => {
  it("puts every date under one heading", () => {
    expect(freshness(day(10, 13), NOW)).toBe("expired");
    expect(freshness(day(10, 15), NOW)).toBe("today");
    expect(freshness(day(10, 16), NOW)).toBe("soon");
    expect(freshness(day(10, 18), NOW)).toBe("soon");
    expect(freshness(day(10, 19), NOW)).toBe("week");
    expect(freshness(day(10, 22), NOW)).toBe("week");
    expect(freshness(day(10, 23), NOW)).toBe("later");
    expect(freshness(null, NOW)).toBe("none");
  });

  it("sorts what goes first to the top, and things without a date last", () => {
    const rows = [
      { name: "Rice", expires: null },
      { name: "Milk", expires: day(10, 18) },
      { name: "Chicken", expires: day(10, 16) },
      { name: "Apples", expires: null },
      { name: "Yogurt", expires: day(10, 18) },
    ];
    expect([...rows].sort(byExpiry).map((r) => r.name)).toEqual(["Chicken", "Milk", "Yogurt", "Apples", "Rice"]);
  });
});

describe("the reminder", () => {
  it("comes at 9:00 the day before", () => {
    expect(remindAt({ expires: day(10, 20), status: "in" }, NOW)).toEqual(new Date(2026, 9, 19, 9));
  });

  it("comes on the morning of the day when the day before has gone, and not at all once that has too", () => {
    // Expires tomorrow: today's 9:00 has passed at 10:00, so tomorrow at 9:00.
    expect(remindAt({ expires: day(10, 16) }, NOW)).toEqual(new Date(2026, 9, 16, 9));
    // Expires today, after 9:00: nothing left to remind about.
    expect(remindAt({ expires: day(10, 15) }, NOW)).toBeNull();
    // Expires today, before 9:00: that morning.
    expect(remindAt({ expires: day(10, 15) }, new Date(2026, 9, 15, 7))).toEqual(new Date(2026, 9, 15, 9));
  });

  it("is a local 9:00 across the change to winter time", () => {
    const at = remindAt({ expires: day(10, 26) }, NOW)!;
    expect([at.getDate(), at.getHours()]).toEqual([25, 9]);
  });

  it("is never for something used, thrown away, past its date or without one", () => {
    expect(remindAt({ expires: day(10, 20), status: "used" }, NOW)).toBeNull();
    expect(remindAt({ expires: day(10, 20), status: "wasted" }, NOW)).toBeNull();
    expect(remindAt({ expires: day(10, 1) }, NOW)).toBeNull();
    expect(remindAt({ expires: null }, NOW)).toBeNull();
  });
});

describe("the waste tally", () => {
  const rows = [
    { status: "wasted", finished: day(10, 2) },
    { status: "wasted", finished: day(10, 14) },
    { status: "used", finished: day(10, 10) },
    { status: "used", finished: day(10, 11) },
    { status: "used", finished: day(10, 12) },
    { status: "wasted", finished: day(9, 20) },
    { status: "used", finished: day(8, 1) },
    { status: "in", finished: null },
  ];

  it("counts what was thrown away and used in a month, and in the one before", () => {
    expect(finishedIn(rows, "wasted", NOW)).toBe(2);
    expect(finishedIn(rows, "wasted", NOW, 1)).toBe(1);
    expect(finishedIn(rows, "used", NOW)).toBe(3);
    expect(finishedIn(rows, "used", NOW, 2)).toBe(1);
  });

  it("gives the share thrown away over the last 30 days, and nothing to say with nothing finished", () => {
    // 16 Sep onwards: wasted 2 Oct, 14 Oct, 20 Sep; used 10, 11, 12 Oct → 3 of 6.
    expect(wasteShare(rows, NOW)).toBe(0.5);
    expect(wasteShare([{ status: "in" }], NOW)).toBeNull();
  });

  it("has a bar per month, oldest first, ending this month", () => {
    expect(lastMonths(NOW, 3)).toEqual([day(8, 1), day(9, 1), day(10, 1)]);
    expect(lastMonths(new Date(2026, 0, 10), 2)).toEqual([day(12, 1, 2025), day(1, 1)]);
  });
});
