// What a poster says → when the event is. TZ is Europe/Warsaw (vitest.config.ts): CEST until
// 25 Oct 2026, CET after it.
import { describe, expect, it } from "vitest";
import {
  endsAt,
  inferYear,
  isOver,
  normaliseLink,
  parseClock,
  parseClockRange,
  printedWeekday,
  toDraft,
  zoneOffset,
  type PosterReading,
} from "../dates.js";

/** Thu 15 Oct 2026, 10:00 in Warsaw. */
const TODAY = new Date(2026, 9, 15, 10, 0);

const reading = (r: Partial<PosterReading>): PosterReading => ({
  title: "Night Tram Quartet",
  dateText: null,
  date: null,
  endDate: null,
  yearPrinted: true,
  start: null,
  end: null,
  doors: null,
  timezone: null,
  venue: null,
  address: null,
  price: null,
  link: null,
  description: null,
  ...r,
});

describe("times as posters print them", () => {
  it.each([
    ["20:00", 20, 0],
    ["20.30", 20, 30],
    ["20h", 20, 0],
    ["20h30", 20, 30],
    ["8pm", 20, 0],
    ["8:30 p.m.", 20, 30],
    ["7 PM", 19, 0],
    ["12am", 0, 0],
    ["12pm", 12, 0],
    ["20 Uhr", 20, 0],
    ["24:00", 0, 0],
    ["noon", 12, 0],
    ["Mitternacht", 0, 0],
    ["Doors 7pm", 19, 0],
    ["2 sets from 8pm", 20, 0],
  ])("%s → %i:%i", (text, h, m) => {
    expect(parseClock(text)).toEqual({ h, m });
  });

  it("is no time when the number is a count, a price or out of range", () => {
    for (const text of ["8", "12 €", "25:00", "20:75", "", null, undefined]) expect(parseClock(text), String(text)).toBeNull();
  });

  it("reads both ends of a range, and lends the end's pm to the start", () => {
    expect(parseClockRange("20:00–23:00")).toEqual({ start: { h: 20, m: 0 }, end: { h: 23, m: 0 } });
    expect(parseClockRange("19:00 - 01:00")).toEqual({ start: { h: 19, m: 0 }, end: { h: 1, m: 0 } });
    expect(parseClockRange("8-11pm")).toEqual({ start: { h: 20, m: 0 }, end: { h: 23, m: 0 } });
    expect(parseClockRange("20:00 bis 23:00")).toEqual({ start: { h: 20, m: 0 }, end: { h: 23, m: 0 } });
    expect(parseClockRange("11am to 2pm")).toEqual({ start: { h: 11, m: 0 }, end: { h: 14, m: 0 } });
    // A word that merely ends in "a" is not "a" meaning "to".
    expect(parseClockRange("pizza 20:00")).toEqual({ start: { h: 20, m: 0 }, end: null });
  });
});

describe("the year of a date printed without one", () => {
  it("reads the weekday a date starts with, in the six languages", () => {
    expect(printedWeekday("Fri 20 Nov")).toBe(5);
    expect(printedWeekday("Sábado, 21 de novembro")).toBe(6);
    expect(printedWeekday("pt. 20.11")).toBe(5);
    expect(printedWeekday("Mittwoch 18.11.")).toBe(3);
    expect(printedWeekday("Domenica 22 novembre")).toBe(0);
    expect(printedWeekday("20 Nov")).toBeNull();
    // "Mar" is March as often as it is martes: never taken for a weekday.
    expect(printedWeekday("Mar 3")).toBeNull();
  });

  it("takes this year or the next, whichever is still to come", () => {
    expect(inferYear(11, 20, null, TODAY)).toBe(2026);
    expect(inferYear(3, 1, null, TODAY)).toBe(2027);
    expect(inferYear(10, 1, null, TODAY)).toBe(2027);
  });

  it("keeps a date of the last few days in this year: the poster is for something just gone", () => {
    expect(inferYear(10, 10, null, TODAY)).toBe(2026);
  });

  it("lets the printed weekday choose between the two years", () => {
    // 20 Nov 2026 is a Friday, 20 Nov 2027 a Saturday.
    expect(inferYear(11, 20, 5, TODAY)).toBe(2026);
    expect(inferYear(11, 20, 6, TODAY)).toBe(2027);
    // Neither year matches: the next one to come.
    expect(inferYear(11, 20, 1, TODAY)).toBe(2026);
  });
});

describe("timezones a poster prints", () => {
  const jul = { y: 2026, m: 7, d: 1 };
  const dec = { y: 2026, m: 12, d: 1 };
  it("reads abbreviations and offsets as minutes east of UTC", () => {
    expect(zoneOffset("CET", jul)).toBe(60);
    expect(zoneOffset("CEST", jul)).toBe(120);
    expect(zoneOffset("UTC+2", jul)).toBe(120);
    expect(zoneOffset("GMT-03:00", jul)).toBe(-180);
    expect(zoneOffset("+0530", jul)).toBe(330);
    expect(zoneOffset("(PST)", jul)).toBe(-480);
  });

  it("follows US daylight time for the generic zones", () => {
    expect(zoneOffset("ET", jul)).toBe(-240);
    expect(zoneOffset("ET", dec)).toBe(-300);
    expect(zoneOffset("PT", { y: 2026, m: 3, d: 8 })).toBe(-420); // the second Sunday of March: daylight time
    expect(zoneOffset("PT", { y: 2026, m: 3, d: 7 })).toBe(-480);
  });

  it("is the device's own zone for anything else", () => {
    for (const z of ["local time", "IST", "UTC+15", "", null]) expect(zoneOffset(z, jul), String(z)).toBeNull();
  });
});

describe("a reading → the draft the person checks", () => {
  it("doors at 19:00, start at 20:00, no year: this Friday's wall time in the device's zone", () => {
    const d = toDraft(reading({ dateText: "Fri 20 Nov", date: "2027-11-20", yearPrinted: false, start: "20:00", doors: "19:00" }), TODAY);
    expect(d.start).toEqual(new Date(2026, 10, 20, 20, 0));
    expect(d.start!.toISOString()).toBe("2026-11-20T19:00:00.000Z"); // CET
    expect(d.doors).toBe("19:00");
    expect(d.allDay).toBe(false);
    expect(d.end).toBeNull();
  });

  it("starts at the doors when doors are all the poster gives", () => {
    const d = toDraft(reading({ date: "2026-11-20", doors: "7pm" }), TODAY);
    expect(d.start).toEqual(new Date(2026, 10, 20, 19, 0));
    expect(d.doors).toBeNull();
  });

  it("puts an end past midnight on the next day", () => {
    const d = toDraft(reading({ date: "2026-11-20", start: "22:00", end: "02:00" }), TODAY);
    expect(d.end).toEqual(new Date(2026, 10, 21, 2, 0));
  });

  it("reads an end out of a range in the start", () => {
    const d = toDraft(reading({ date: "2026-11-20", start: "20:00–23:00" }), TODAY);
    expect(d.start).toEqual(new Date(2026, 10, 20, 20, 0));
    expect(d.end).toEqual(new Date(2026, 10, 20, 23, 0));
  });

  it("makes a festival with no times an all-day event over its days", () => {
    const d = toDraft(reading({ date: "2027-06-12", endDate: "2027-06-14" }), TODAY);
    expect(d).toMatchObject({ allDay: true, start: new Date(2027, 5, 12), end: new Date(2027, 5, 14) });
  });

  it("carries a range over New Year into the next year", () => {
    const d = toDraft(reading({ dateText: "28.12 – 2.01", date: "2026-12-28", endDate: "2026-01-02", yearPrinted: false }), TODAY);
    expect(d.start).toEqual(new Date(2026, 11, 28));
    expect(d.end).toEqual(new Date(2027, 0, 2));
  });

  it("places a printed timezone's wall time, whatever the device's", () => {
    const d = toDraft(reading({ date: "2026-11-20", start: "8pm", timezone: "ET" }), TODAY);
    expect(d.start!.toISOString()).toBe("2026-11-21T01:00:00.000Z");
  });

  it("knows the clocks change: 20:00 is 18:00 UTC before the 25th of October and 19:00 after", () => {
    expect(toDraft(reading({ date: "2026-10-24", start: "20:00" }), TODAY).start!.toISOString()).toBe("2026-10-24T18:00:00.000Z");
    expect(toDraft(reading({ date: "2026-10-26", start: "20:00" }), TODAY).start!.toISOString()).toBe("2026-10-26T19:00:00.000Z");
  });

  it("keeps everything else and leaves the date empty when there is none", () => {
    const d = toDraft(reading({ title: "  Open   mic ", venue: "Pardon, To Tu", price: "Free", date: null, start: "20:00" }), TODAY);
    expect(d).toMatchObject({ title: "Open mic", venue: "Pardon, To Tu", price: "Free", start: null, end: null });
  });

  it("refuses a date that is not one", () => {
    expect(toDraft(reading({ date: "2026-02-30", start: "20:00" }), TODAY).start).toBeNull();
  });
});

describe("links off a poster", () => {
  it("adds https to an address printed without it, and refuses what is not a web link", () => {
    expect(normaliseLink("lanternroom.example/tickets")).toBe("https://lanternroom.example/tickets");
    expect(normaliseLink("https://tix.example/e/42,")).toBe("https://tix.example/e/42");
    expect(normaliseLink("scan the QR code")).toBeNull();
    expect(normaliseLink("javascript:alert(1)")).toBeNull();
    expect(normaliseLink("mailto:a@b.example")).toBeNull();
  });
});

describe("when an event is over", () => {
  const now = new Date(2026, 10, 20, 22, 0);
  it("is three hours after a start with no end", () => {
    expect(endsAt({ start: new Date(2026, 10, 20, 20, 0) })).toEqual(new Date(2026, 10, 20, 23, 0));
    expect(isOver({ start: new Date(2026, 10, 20, 20, 0) }, now)).toBe(false);
    expect(isOver({ start: new Date(2026, 10, 20, 18, 0) }, now)).toBe(true);
  });

  it("is the end of the last day for an all-day event", () => {
    expect(endsAt({ start: "2026-11-20T00:00:00", allDay: true })).toEqual(new Date(2026, 10, 21));
    expect(endsAt({ start: new Date(2027, 5, 12), end: new Date(2027, 5, 14), allDay: true })).toEqual(new Date(2027, 5, 15));
  });

  it("is never for an event without a start", () => {
    expect(isOver({ start: null }, now)).toBe(false);
  });
});
