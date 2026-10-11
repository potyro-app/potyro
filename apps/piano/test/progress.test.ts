import { describe, expect, it } from "vitest";
import planJson from "../plan.json";
import type { Plan } from "../plan.js";
import {
  currentWeek,
  cycleStart,
  dayNumber,
  daysPractised,
  defaultProgress,
  goalMet,
  isReviewDay,
  isRestDay,
  jumpTo,
  leaveModule,
  moduleWarning,
  reconcileProgress,
  repeatWeek,
  setReviewWeekday,
  setStartDate,
  startModule,
  todayBlocks,
  type Progress,
} from "../progress.js";

const plan = planJson as unknown as Plan;
// A Monday.
const START = new Date(2026, 9, 12);
const day = (n: number): Date => new Date(START.getTime() + (n - 1) * 86_400_000);
const fresh = (): Progress => defaultProgress(plan, START);

describe("the 7-day cycle", () => {
  it("counts days from the start date and rests on day 7", () => {
    const p = fresh();
    expect(dayNumber(p, day(1))).toBe(1);
    expect(dayNumber(p, day(7))).toBe(7);
    expect(dayNumber(p, day(8))).toBe(1);
    expect(isRestDay(p, day(7))).toBe(true);
    expect(isRestDay(p, day(14))).toBe(true);
    expect(isRestDay(p, day(13))).toBe(false);
  });

  it("is day 1 before the start date", () => {
    expect(dayNumber(fresh(), day(-3))).toBe(1);
  });

  it("knows where the current cycle began", () => {
    expect(cycleStart(fresh(), day(10)).getTime()).toBe(day(8).getTime());
  });

  it("uses the fixed weekday as review day", () => {
    const p = setReviewWeekday(fresh(), 5); // Friday
    expect(isReviewDay(p, day(5))).toBe(true);
    expect(isReviewDay(p, day(6))).toBe(false);
    expect(setReviewWeekday(p, 9)).toBe(p);
    expect(setStartDate(p, "not a day")).toBe(p);
    expect(setStartDate(p, "2026-10-13").startDate).toBe("2026-10-13");
  });
});

describe("today's blocks", () => {
  it("are the plan's five blocks with the week's text", () => {
    const blocks = todayBlocks(plan, fresh(), day(1));
    expect(blocks.map((b) => b.id)).toEqual(plan.blocks.map((b) => b.id));
    expect(blocks[0]!.text).toBe(plan.phases[0]!.weeks[0]!.blocks.warmup!.text);
    expect(blocks.every((b) => !b.fromModule && !b.review)).toBe(true);
  });

  it("are empty on the rest day unless asked otherwise", () => {
    expect(todayBlocks(plan, fresh(), day(7))).toEqual([]);
    expect(todayBlocks(plan, fresh(), day(7), { ignoreRest: true })).toHaveLength(5);
  });

  it("swap block 5 for the review on the review day", () => {
    const p = setReviewWeekday(fresh(), day(3).getDay());
    const blocks = todayBlocks(plan, p, day(3));
    expect(blocks[4]).toMatchObject({ review: true, label: plan.reviewDay.label, text: plan.reviewDay.text, links: [] });
    expect(blocks[3]!.review).toBe(false);
  });
});

describe("moving through the plan by goal", () => {
  it("starts on the first week", () => {
    const cur = currentWeek(plan, fresh(), day(1))!;
    expect(cur.week.id).toBe("w1");
    expect(cur.index).toBe(0);
    expect(cur.total).toBe(11);
    expect(cur.goal).toBe(plan.phases[0]!.weeks[0]!.doneWhen);
  });

  it("advances only when the goal is met, however many days pass", () => {
    const p = fresh();
    expect(currentWeek(plan, p, day(40))!.week.id).toBe("w1");
    const next = goalMet(plan, p, day(3));
    expect(next.weekId).toBe("w2");
    expect(next.history.map((h) => h.kind)).toEqual(["started", "goalMet", "started"]);
    expect(p.weekId).toBe("w1"); // the old value is untouched
  });

  it("counts repeats and restarts the week's clock", () => {
    const p = repeatWeek(plan, fresh(), day(9));
    expect(p.repeats.w1).toBe(1);
    expect(p.weekId).toBe("w1");
    expect(repeatWeek(plan, p, day(16)).repeats.w1).toBe(2);
  });

  it("tells which week of a multi-week row you are in", () => {
    let p = fresh();
    for (let i = 0; i < 4; i++) p = goalMet(plan, p, day(1));
    expect(p.weekId).toBe("w5-6");
    p = { ...p, weekStartedAt: day(1).toISOString() };
    expect(currentWeek(plan, p, day(3))!.weekOfSpan).toBe(1);
    expect(currentWeek(plan, p, day(8))!.weekOfSpan).toBe(2);
    expect(currentWeek(plan, p, day(30))!.weekOfSpan).toBe(2); // capped at the span
  });

  it("marks the plan complete after the last week's goal", () => {
    let p = fresh();
    for (let i = 0; i < 10; i++) p = goalMet(plan, p, day(1));
    expect(p.weekId).toBe("m6");
    expect(p.completed).toBe(false);
    p = goalMet(plan, p, day(1));
    expect(p.completed).toBe(true);
    expect(p.weekId).toBe("m6");
  });

  it("jumps to any week and nowhere else", () => {
    const p = jumpTo(plan, fresh(), "w9-10", day(1));
    expect(p.weekId).toBe("w9-10");
    expect(jumpTo(plan, p, "w99", day(1))).toBe(p);
    expect(jumpTo(plan, p, "w9-10", day(1))).toBe(p);
  });
});

describe("modules", () => {
  it("swap blocks 2 and 4 for the module's and keep the rest", () => {
    const p = startModule(plan, fresh(), "blues", 3, day(1));
    expect(p.module).toMatchObject({ id: "blues", weeksTotal: 3, weekIndex: 0 });
    const blocks = todayBlocks(plan, p, day(1));
    expect(blocks.map((b) => b.fromModule)).toEqual([false, true, false, true, false]);
    expect(blocks[1]!.text).toBe(plan.modules[0]!.weeks[0]!.blocks.technique!.text);
    expect(blocks[0]!.text).toBe(plan.phases[0]!.weeks[0]!.blocks.warmup!.text);
    expect(currentWeek(plan, p, day(1))!.goal).toBe(plan.modules[0]!.weeks[0]!.doneWhen);
  });

  it("advance by goal and return to the main plan where you left it", () => {
    let p = goalMet(plan, fresh(), day(1)); // on w2
    p = startModule(plan, p, "blues", 2, day(1));
    p = goalMet(plan, p, day(1));
    expect(p.module?.weekIndex).toBe(1);
    expect(p.weekId).toBe("w2");
    p = goalMet(plan, p, day(1));
    expect(p.module).toBeNull();
    expect(p.weekId).toBe("w2");
    expect(p.history.at(-1)!.kind).toBe("moduleFinished");
  });

  it("repeat the last defined week when you asked for more weeks than it has", () => {
    let p = startModule(plan, fresh(), "blues", 5, day(1));
    for (let i = 0; i < 4; i++) p = goalMet(plan, p, day(1));
    expect(p.module?.weekIndex).toBe(4);
    expect(currentWeek(plan, p, day(1))!.moduleWeek!.id).toBe("blues-3");
  });

  it("can be left early, and a jump leaves them too", () => {
    const p = startModule(plan, fresh(), "jazz", 4, day(1));
    expect(leaveModule(plan, p, day(2)).module).toBeNull();
    expect(jumpTo(plan, p, "w4", day(2)).module).toBeNull();
    const none = fresh();
    expect(leaveModule(plan, none, day(2))).toBe(none);
  });

  it("warn when started before the plan suggests", () => {
    const blues = plan.modules[0]!;
    expect(moduleWarning(plan, fresh(), blues)).toMatch(/Weeks 9–10/);
    expect(moduleWarning(plan, jumpTo(plan, fresh(), "w9-10", day(1)), blues)).toBeNull();
    expect(moduleWarning(plan, jumpTo(plan, fresh(), "m6", day(1)), blues)).toBeNull();
  });

  it("refuse an unknown module or a silly length", () => {
    const base = fresh();
    expect(startModule(plan, base, "polka", 2, day(1))).toBe(base);
    expect(startModule(plan, base, "blues", 0, day(1))).toBe(base);
  });
});

describe("a replaced plan", () => {
  it("keeps progress that still applies and falls back to the first week otherwise", () => {
    const p = { ...jumpTo(plan, fresh(), "w4", day(1)), module: { id: "blues", weeksTotal: 2, weekIndex: 0, startedAt: "", weekStartedAt: "" } };
    expect(reconcileProgress(plan, p, day(1))).toBe(p);
    const smaller: Plan = { ...plan, phases: [{ ...plan.phases[0]!, weeks: plan.phases[0]!.weeks.slice(0, 2) }], modules: [] };
    const r = reconcileProgress(smaller, p, day(1));
    expect(r.weekId).toBe("w1");
    expect(r.module).toBeNull();
    expect(r.repeats).toBe(p.repeats);
  });
});

describe("what the sessions say", () => {
  it("counts days with a block done in this cycle, not rest days or other weeks", () => {
    const p = fresh();
    const sessions = [
      { date: day(1), blocksDone: ["warmup"] },
      { date: day(1), blocksDone: ["reading"] }, // same day twice still one day
      { date: day(2), blocksDone: [] },
      { date: day(7), blocksDone: [], rest: true },
      { date: day(8), blocksDone: ["warmup"] }, // next cycle
    ];
    expect(daysPractised(sessions, p, day(5))).toBe(1);
    expect(daysPractised(sessions, p, day(9))).toBe(1);
  });
});
