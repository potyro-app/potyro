// Reminders, and the .ics file against RFC 5545's own rules. TZ is Europe/Warsaw (vitest.config.ts).
import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, foldLine, icsName, remindAt, utcStamp, type CalendarEvent } from "../calendar.js";

const NOW = new Date(2026, 9, 15, 10, 0);
const FRI_8PM = new Date(2026, 10, 20, 20, 0); // 19:00Z, CET

describe("when to remind", () => {
  it("is a day before by default, the chosen time before otherwise", () => {
    expect(remindAt({ start: FRI_8PM }, NOW)).toEqual(new Date(2026, 10, 19, 20, 0));
    expect(remindAt({ start: FRI_8PM, remind: "at start" }, NOW)).toEqual(FRI_8PM);
    expect(remindAt({ start: FRI_8PM, remind: "1 hour before" }, NOW)).toEqual(new Date(2026, 10, 20, 19, 0));
    expect(remindAt({ start: FRI_8PM, remind: "3 hours before" }, NOW)).toEqual(new Date(2026, 10, 20, 17, 0));
    expect(remindAt({ start: FRI_8PM, remind: "1 week before" }, NOW)).toEqual(new Date(2026, 10, 13, 20, 0));
  });

  it("counts an all-day event's reminder back from 9:00 on its day", () => {
    expect(remindAt({ start: new Date(2026, 10, 20), allDay: true, remind: "1 day before" }, NOW)).toEqual(new Date(2026, 10, 19, 9, 0));
    expect(remindAt({ start: new Date(2026, 10, 20), allDay: true, remind: "at start" }, NOW)).toEqual(new Date(2026, 10, 20, 9, 0));
  });

  it("keeps the wall time across the change of the clocks", () => {
    // Sun 25 Oct 2026, 03:00 CEST → 02:00 CET: a week before 20:00 on 31 Oct is still 20:00.
    expect(remindAt({ start: new Date(2026, 9, 31, 20, 0), remind: "1 week before" }, NOW)).toEqual(new Date(2026, 9, 24, 20, 0));
    expect(remindAt({ start: new Date(2026, 9, 25, 20, 0), remind: "1 day before" }, NOW)).toEqual(new Date(2026, 9, 24, 20, 0));
    // Hours are hours: 3 hours before 04:00 on the night the clocks go back is 02:00 CEST.
    expect(remindAt({ start: new Date("2026-10-25T03:00:00Z"), remind: "3 hours before" }, NOW)!.toISOString()).toBe("2026-10-25T00:00:00.000Z");
  });

  it("is none for 'none', for no start, for an unknown choice, and once the event is over", () => {
    expect(remindAt({ start: FRI_8PM, remind: "none" }, NOW)).toBeNull();
    expect(remindAt({ start: null }, NOW)).toBeNull();
    expect(remindAt({ start: FRI_8PM, remind: "yesterday" }, NOW)).toBeNull();
    expect(remindAt({ start: FRI_8PM }, new Date(2026, 10, 21, 0, 0))).toBeNull();
  });

  it("reads a stored ISO string as well as a Date", () => {
    expect(remindAt({ start: FRI_8PM.toISOString(), remind: "at start" }, NOW)).toEqual(FRI_8PM);
  });
});

/** Unfold (§3.1) and check what every content line must be. */
function contentLines(ics: string): string[] {
  expect(ics.endsWith("\r\n")).toBe(true);
  expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/); // no bare CR or LF anywhere
  const physical = ics.slice(0, -2).split("\r\n");
  for (const line of physical) expect(new TextEncoder().encode(line).length, line).toBeLessThanOrEqual(75);
  const unfolded = ics.slice(0, -2).replace(/\r\n[ \t]/g, "").split("\r\n");
  // name *(";" param) ":" value — names are letters, digits and dashes.
  for (const line of unfolded) expect(line, line).toMatch(/^[A-Z][A-Z0-9-]*(;[A-Z0-9-]+=[^;:]+)*:/);
  return unfolded;
}

const prop = (lines: string[], name: string) => lines.filter((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

function balanced(lines: string[]) {
  const stack: string[] = [];
  for (const l of lines) {
    if (l.startsWith("BEGIN:")) stack.push(l.slice(6));
    if (l.startsWith("END:")) expect(stack.pop()).toBe(l.slice(4));
  }
  expect(stack).toEqual([]);
}

const base: CalendarEvent = {
  uid: "e1@poster-to-calendar.potyro",
  title: "Night Tram Quartet",
  start: FRI_8PM,
  end: new Date(2026, 10, 20, 23, 0),
  allDay: false,
  venue: "The Lantern Room",
  address: "12 Harbour Lane",
  description: "Live jazz.\nDoors 19:00",
  link: "https://lanternroom.example/tickets",
  alarm: new Date(2026, 10, 19, 20, 0),
  alarmText: "Night Tram Quartet · The Lantern Room",
};

describe("the .ics file", () => {
  it("is one VCALENDAR with one VEVENT and its alarm, with every required property", () => {
    const lines = contentLines(buildIcs(base, NOW));
    balanced(lines);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.at(-1)).toBe("END:VCALENDAR");
    expect(prop(lines, "VERSION")).toEqual(["VERSION:2.0"]);
    expect(prop(lines, "PRODID")).toHaveLength(1);
    expect(prop(lines, "UID")).toEqual(["UID:e1@poster-to-calendar.potyro"]);
    expect(prop(lines, "DTSTAMP")).toEqual([`DTSTAMP:${utcStamp(NOW)}`]);
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines.filter((l) => l === "BEGIN:VALARM")).toHaveLength(1);
  });

  it("writes times in UTC, so the event is at the same moment in every calendar and zone", () => {
    const lines = contentLines(buildIcs(base, NOW));
    expect(prop(lines, "DTSTART")).toEqual(["DTSTART:20261120T190000Z"]);
    expect(prop(lines, "DTEND")).toEqual(["DTEND:20261120T220000Z"]);
    expect(lines).toContain("TRIGGER;VALUE=DATE-TIME:20261119T190000Z");
    // A summer date is two hours off UTC, not one.
    const summer = contentLines(buildIcs({ ...base, start: new Date(2027, 6, 2, 20, 0), end: null, alarm: null }, NOW));
    expect(prop(summer, "DTSTART")).toEqual(["DTSTART:20270702T180000Z"]);
  });

  it("leaves DTEND out when the poster gave no end, rather than inventing one", () => {
    const lines = contentLines(buildIcs({ ...base, end: null }, NOW));
    expect(prop(lines, "DTEND")).toEqual([]);
  });

  it("writes an all-day event as dates, its end the day after its last day", () => {
    const one = contentLines(buildIcs({ ...base, allDay: true, start: new Date(2026, 10, 20), end: null }, NOW));
    expect(prop(one, "DTSTART")).toEqual(["DTSTART;VALUE=DATE:20261120"]);
    expect(prop(one, "DTEND")).toEqual(["DTEND;VALUE=DATE:20261121"]);
    const festival = contentLines(buildIcs({ ...base, allDay: true, start: new Date(2026, 11, 30), end: new Date(2027, 0, 1) }, NOW));
    expect(prop(festival, "DTSTART")).toEqual(["DTSTART;VALUE=DATE:20261230"]);
    expect(prop(festival, "DTEND")).toEqual(["DTEND;VALUE=DATE:20270102"]);
  });

  it("escapes text: commas, semicolons, backslashes and new lines", () => {
    expect(escapeText("a, b; c\\d\ne")).toBe("a\\, b\\; c\\\\d\\ne");
    const lines = contentLines(buildIcs({ ...base, title: "Rock; Roll, and more" }, NOW));
    expect(prop(lines, "SUMMARY")).toEqual(["SUMMARY:Rock\\; Roll\\, and more"]);
    expect(prop(lines, "LOCATION")).toEqual(["LOCATION:The Lantern Room\\, 12 Harbour Lane"]);
    expect(prop(lines, "DESCRIPTION")[0]).toBe("DESCRIPTION:Live jazz.\\nDoors 19:00");
    expect(prop(lines, "URL")).toEqual(["URL:https://lanternroom.example/tickets"]);
  });

  it("folds long lines at 75 octets without splitting a character, and unfolds to the same text", () => {
    const long = "Koncert w Łodzi: Żółta Łódź i przyjaciele — wieczór pełen muzyki, śpiewu i tańca aż do białego rana";
    const folded = foldLine(`SUMMARY:${long}`);
    for (const piece of folded.split("\r\n")) expect(new TextEncoder().encode(piece).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${long}`);
    const lines = contentLines(buildIcs({ ...base, title: long }, NOW));
    expect(prop(lines, "SUMMARY")).toEqual([`SUMMARY:${escapeText(long)}`]);
  });

  it("has no alarm when there is no reminder", () => {
    const lines = contentLines(buildIcs({ ...base, alarm: null }, NOW));
    expect(lines.filter((l) => l.startsWith("BEGIN:VALARM"))).toEqual([]);
  });
});

describe("the file's name", () => {
  it("is the title in plain letters and the day", () => {
    expect(icsName("Night Tram Quartet", FRI_8PM)).toBe("night-tram-quartet-20261120.ics");
    expect(icsName("Żółta Łódź!", FRI_8PM)).toBe("zolta-lodz-20261120.ics");
    expect(icsName("🎉🎉", FRI_8PM)).toBe("event-20261120.ics");
  });
});
