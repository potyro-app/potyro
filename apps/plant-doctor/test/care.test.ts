// The care plan's arithmetic: watering intervals and when water is due, what a finding means for the
// plant's health, when the next check-up photo is, and when each reminder comes.
import { describe, expect, it } from "vitest";
import {
  CHECK_DAYS,
  checkRemindAt,
  checkupDue,
  healthOf,
  isSerious,
  nextCheckup,
  nextWatering,
  needsWater,
  WATER_DAYS,
  waterEvery,
  waterIn,
  waterRemindAt,
} from "../care.js";

/** Thu 15 Oct 2026, 10:00 in Warsaw (TZ pinned in vitest.config.ts). */
const NOW = new Date(2026, 9, 15, 10, 0);
const day = (m: number, d: number, y = 2026) => new Date(y, m - 1, d);

describe("watering", () => {
  it("takes a suggested interval in whole days, within 1–30, else the light's default", () => {
    expect(waterEvery(6.6, "medium")).toBe(7);
    expect(waterEvery(0.2, "medium")).toBe(1);
    expect(waterEvery(90, "medium")).toBe(30);
    expect(waterEvery(null, "sun")).toBe(WATER_DAYS.sun);
    expect(waterEvery("not a number", "low")).toBe(WATER_DAYS.low);
    expect(waterEvery(-3, "bright")).toBe(WATER_DAYS.bright);
    // More light, more thirst.
    expect(WATER_DAYS.sun).toBeLessThan(WATER_DAYS.bright);
    expect(WATER_DAYS.bright).toBeLessThan(WATER_DAYS.medium);
    expect(WATER_DAYS.medium).toBeLessThan(WATER_DAYS.low);
  });

  it("is due the interval after the last watering, as a calendar day", () => {
    const plant = { lastWatered: day(10, 12), waterEvery: 5, light: "bright" };
    expect(nextWatering(plant, NOW)).toEqual(day(10, 17));
    expect(waterIn(plant, NOW)).toBe(2);
    expect(needsWater(plant, NOW)).toBe(false);
    expect(waterIn({ lastWatered: day(10, 1), waterEvery: 7 }, NOW)).toBe(-7);
    expect(needsWater({ lastWatered: day(10, 1), waterEvery: 7 }, NOW)).toBe(true);
  });

  it("never watered (or not remembered) is due today, not long overdue", () => {
    expect(waterIn({ waterEvery: 7 }, NOW)).toBe(0);
    expect(needsWater({ waterEvery: 7 }, NOW)).toBe(true);
  });

  it("reminds at 9:00 on the day it is due, never in the past, never for a plant with no watering yet", () => {
    expect(waterRemindAt({ lastWatered: day(10, 12), waterEvery: 5 }, NOW)).toEqual(new Date(2026, 9, 17, 9));
    // Due today, but 9:00 has gone: the in-app "Water today" says it instead.
    expect(waterRemindAt({ lastWatered: day(10, 8), waterEvery: 7 }, NOW)).toBeNull();
    expect(waterRemindAt({ lastWatered: day(10, 8), waterEvery: 7 }, new Date(2026, 9, 15, 7))).toEqual(new Date(2026, 9, 15, 9));
    expect(waterRemindAt({ waterEvery: 7 }, NOW)).toBeNull();
  });

  it("keeps 9:00 local across the change to winter time", () => {
    const at = waterRemindAt({ lastWatered: day(10, 20), waterEvery: 6 }, NOW)!;
    expect([at.getMonth(), at.getDate(), at.getHours()]).toEqual([9, 26, 9]);
  });
});

describe("health and check-ups", () => {
  it("reads a finding as health, never forgetting what the model called serious", () => {
    expect(healthOf("none", "high", false)).toBe("thriving");
    expect(healthOf("none", "low", false)).toBe("okay");
    expect(healthOf("unsure", "low", false)).toBe("okay");
    expect(healthOf("overwatering", "medium", false)).toBe("struggling");
    expect(healthOf("overwatering", "medium", false, "better")).toBe("okay");
    expect(healthOf("pests", "low", true)).toBe("serious");
  });

  it("treats a disease as serious whatever the model said: it can spread", () => {
    expect(isSerious("disease", false)).toBe(true);
    expect(isSerious("overwatering", false)).toBe(false);
    expect(isSerious("pests", true)).toBe(true);
  });

  it("looks again sooner the worse it is: 3 days, a week, two weeks, a month", () => {
    expect([CHECK_DAYS.serious, CHECK_DAYS.struggling, CHECK_DAYS.okay, CHECK_DAYS.thriving]).toEqual([3, 7, 14, 30]);
    expect(nextCheckup("serious", NOW)).toEqual(day(10, 18));
    expect(nextCheckup("struggling", NOW)).toEqual(day(10, 22));
    expect(nextCheckup("thriving", NOW)).toEqual(day(11, 14));
  });

  it("reminds about the check-up at 9:00 on its day, and counts it due from then", () => {
    expect(checkRemindAt({ nextCheck: day(10, 22) }, NOW)).toEqual(new Date(2026, 9, 22, 9));
    expect(checkRemindAt({ nextCheck: day(10, 15) }, NOW)).toBeNull();
    expect(checkRemindAt({}, NOW)).toBeNull();
    expect(checkupDue({ nextCheck: day(10, 15) }, NOW)).toBe(true);
    expect(checkupDue({ nextCheck: day(10, 16) }, NOW)).toBe(false);
    expect(checkupDue({}, NOW)).toBe(false);
  });
});
