import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addDays,
  dailySeries,
  dayKey,
  insights,
  insightText,
  jitter,
  lastDays,
  scatterGroups,
  sleepInsight,
  stats,
  tagInsight,
  toNights,
  trend,
  type CheckinRow,
} from "../insights.js";

const seed = JSON.parse(readFileSync(new URL("../seed.json", import.meta.url), "utf8")) as { checkin: CheckinRow[] };
const nights = toNights(seed.checkin);

describe("days", () => {
  it("reads a date-only value as the day written, whatever the time zone", () => {
    expect(dayKey("2026-10-11")).toBe("2026-10-11");
    expect(dayKey(new Date(2026, 9, 11, 23, 59))).toBe("2026-10-11");
  });

  it("steps across months and daylight-saving changes", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-29", -1)).toBe("2026-03-28");
  });
});

describe("check-ins → nights", () => {
  it("sorts by day, keeps the later of two rows for one day, and skips undated rows", () => {
    const got = toNights([
      { date: "2026-10-02", hours: 6, mood: 3 },
      { date: "2026-10-01", hours: 8, mood: 5 },
      { date: "2026-10-02", hours: 7, mood: 4, tags: ["nap"] },
      { date: null, hours: 9, mood: 5 },
    ]);
    expect(got.map((n) => [n.day, n.hours, n.mood, n.tags])).toEqual([
      ["2026-10-01", 8, 5, []],
      ["2026-10-02", 7, 4, ["nap"]],
    ]);
  });
});

describe("the 30-day window", () => {
  it("runs from the first check-in to the latest, one slot per calendar day, null where nothing was logged", () => {
    const w = lastDays(nights);
    expect(w.days).toHaveLength(21);
    expect(w.days.at(-1)).toBe("2026-10-11");
    expect(w.days[0]).toBe("2026-09-21");
    const s = dailySeries(w);
    expect(s.hours.at(-1)).toBe(8);
    // The seed skips Oct 3: a gap, not a zero.
    expect(s.hours[w.days.indexOf("2026-10-03")]).toBeNull();
    expect(s.mood.filter((m) => m != null)).toHaveLength(20);
  });

  it("keeps only the last 30 days of a longer log", () => {
    const long = toNights(Array.from({ length: 45 }, (_, i) => ({ date: addDays("2026-08-01", i), hours: 7, mood: 3 })));
    const w = lastDays(long);
    expect(w.days).toHaveLength(30);
    expect(w.days[0]).toBe(addDays("2026-08-01", 15));
    expect(w.nights).toHaveLength(30);
  });

  it("is empty with no check-ins", () => {
    expect(lastDays([])).toEqual({ days: [], nights: [] });
  });
});

describe("what it says", () => {
  it("compares long and short nights in the seed", () => {
    const i = sleepInsight(nights)!;
    expect(insightText(i)).toBe("On nights of 7 hours or more your mood averages 4.3. Under 6 hours, it's 2.4.");
    expect(i.strength).toBeCloseTo(1.9 / 4, 5);
  });

  it("leads with the strongest finding", () => {
    const said = insights(nights);
    expect(said[0]!.kind).toBe("sleep");
    expect(said.length).toBeGreaterThan(1);
  });

  it("finds the tag that moves things most, with enough nights on both sides", () => {
    const rows: CheckinRow[] = [];
    for (let i = 0; i < 8; i++) rows.push({ date: addDays("2026-10-01", i), hours: 7, mood: i % 2 ? 5 : 2, tags: i % 2 ? ["exercise"] : [] });
    expect(insightText(tagInsight(toNights(rows))!)).toBe("On days you exercise your mood averages 5, against 2 without.");
  });

  it("reports a sleep gap when the tag changes sleep more than mood", () => {
    const rows: CheckinRow[] = [];
    for (let i = 0; i < 8; i++) rows.push({ date: addDays("2026-10-01", i), hours: i % 2 ? 5 : 8, mood: 3, tags: i % 2 ? ["alcohol"] : [] });
    expect(insightText(tagInsight(toNights(rows))!)).toBe("After a drink you sleep 5h on average, against 8h without.");
  });

  it("says sleep is not what moves mood when the two groups are alike", () => {
    const rows: CheckinRow[] = [];
    for (let i = 0; i < 6; i++) rows.push({ date: addDays("2026-10-01", i), hours: i < 3 ? 8 : 5, mood: 3 });
    expect(insightText(sleepInsight(toNights(rows))!)).toMatch(/stays close to 3\. Sleep is not what moves it/);
  });

  it("asks for more nights rather than inventing a pattern", () => {
    expect(insightText(insights([])[0]!)).toMatch(/Log how you slept tonight/);
    const few = toNights([{ date: "2026-10-01", hours: 7, mood: 4 }, { date: "2026-10-02", hours: 5, mood: 2 }]);
    expect(insightText(insights(few)[0]!)).toBe("2 check-ins so far. A few more nights — about 4 — and a pattern starts to show.");
  });
});

describe("the numbers under it", () => {
  it("averages the seed", () => {
    const s = stats(nights);
    expect(s.nights).toBe(20);
    expect(s.avgHours).toBeCloseTo(6.7875, 4);
    expect(s.avgMood).toBeCloseTo(3.5, 5);
    expect(s.longShare).toBeCloseTo(0.5, 5);
  });
});

describe("the scatter", () => {
  it("puts a night in every tag it has, and untagged nights in their own group", () => {
    const groups = scatterGroups(nights);
    const count = (tag: string) => groups.find((g) => g.tag === tag)?.points.length ?? 0;
    expect(count("exercise")).toBe(6);
    expect(count("coffee")).toBe(6);
    expect(count("")).toBe(3);
    // Order: the known tags first, as listed, then untagged.
    expect(groups.at(-1)!.tag).toBe("");
  });

  it("jitters a point by a small, stable amount", () => {
    expect(jitter("2026-10-11")).toBe(jitter("2026-10-11"));
    for (const n of nights) expect(Math.abs(jitter(n.day))).toBeLessThanOrEqual(0.14);
  });

  it("draws a trend that climbs when more sleep means a better mood", () => {
    const t = trend(nights)!;
    expect(t.slope).toBeGreaterThan(0.5);
    expect(t.from.x).toBe(5.25);
    expect(t.to.x).toBe(8.5);
    expect(trend(nights.slice(0, 3))).toBeNull();
  });
});
