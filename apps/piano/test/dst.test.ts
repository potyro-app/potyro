// A week across a clock change (2026-10-25: Europe goes back an hour). Adding 24 hours to a local
// midnight then lands on 23:00 the day before, so a day computed that way repeats one date and skips
// another — the week's dots showed one day twice (two React children with one key) and the cycle's
// start could be the evening before. Days are counted on the calendar, in the person's own zone.
process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "vitest";
import { addDays, cycleStart, isoDay, sessionsInCycle, type Progress } from "../progress.js";

const progress = { startDate: "2026-10-12" } as Progress;

describe("days across a clock change", () => {
  it("the zone is one that changes its clocks", () => {
    expect(new Date(2026, 9, 26).getTime() - new Date(2026, 9, 25).getTime()).toBe(25 * 3_600_000);
  });

  it("addDays moves by calendar days", () => {
    const week = Array.from({ length: 7 }, (_, i) => isoDay(addDays(new Date(2026, 9, 19), i)));
    expect(week).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(isoDay(addDays(new Date(2026, 9, 25), 1))).toBe("2026-10-26");
  });

  it("a cycle that starts after the change starts at its own midnight", () => {
    // Started 2026-10-12; the third cycle starts 2026-10-26, the day after the change.
    const start = cycleStart(progress, new Date(2026, 9, 27, 9));
    expect(isoDay(start)).toBe("2026-10-26");
    expect(start.getHours()).toBe(0);
  });

  it("a session on the last day of a cycle across the change is in it", () => {
    const sunday = { date: new Date(2026, 9, 25, 21) };
    expect(sessionsInCycle([sunday], progress, new Date(2026, 9, 25, 9))).toHaveLength(1);
    expect(sessionsInCycle([sunday], progress, new Date(2026, 9, 26, 9))).toHaveLength(0);
  });
});
