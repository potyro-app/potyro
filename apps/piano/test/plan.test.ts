import { describe, expect, it } from "vitest";
import planJson from "../plan.json";
import { blocksForWeek, mainWeeks, resolveLink, startingWeekNumber, validatePlan, type Plan } from "../plan.js";

const plan = planJson as unknown as Plan;

const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(plan)) as Record<string, unknown>;
const errorsOf = (p: unknown): string[] => {
  const r = validatePlan(p);
  return r.ok ? [] : r.errors;
};

describe("the built-in plan", () => {
  it("is a valid plan", () => {
    expect(errorsOf(plan)).toEqual([]);
  });

  it("has the five daily blocks adding up to a 40-minute session", () => {
    expect(plan.blocks.map((b) => b.id)).toEqual(["warmup", "technique", "reading", "repertoire", "ear"]);
    expect(plan.blocks.reduce((n, b) => n + b.minutes, 0)).toBe(40);
  });

  it("covers 24 plan weeks across three phases, with blues and jazz modules", () => {
    const weeks = mainWeeks(plan);
    expect(plan.phases.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(weeks.reduce((n, w) => n + (w.week.spanWeeks ?? 1), 0)).toBe(24);
    expect(plan.modules.map((m) => m.id)).toEqual(["blues", "jazz"]);
  });

  it("numbers rows by the plan week they start on", () => {
    expect(startingWeekNumber(plan, "w1")).toBe(1);
    expect(startingWeekNumber(plan, "w5-6")).toBe(5);
    expect(startingWeekNumber(plan, "m4")).toBe(13);
    expect(startingWeekNumber(plan, "m6")).toBe(21);
  });

  it("resolves every link to a URL", () => {
    for (const { week } of mainWeeks(plan)) {
      for (const c of Object.values(week.blocks)) for (const l of c.links ?? []) expect(resolveLink(plan, l)?.url).toMatch(/^https?:\/\//);
    }
  });
});

describe("validatePlan", () => {
  it("rejects a non-object", () => {
    expect(errorsOf(null)).toEqual(["plan: must be an object"]);
  });

  it("names an unknown block id by path", () => {
    const p = clone();
    (p.phases as any)[0].weeks[1].blocks.singing = { text: "la" };
    expect(errorsOf(p)).toEqual(['phases[0].weeks[1].blocks.singing: unknown block id "singing"']);
  });

  it("names a dangling resource pointer", () => {
    const p = clone();
    (p.phases as any)[0].weeks[0].blocks.ear.links.push({ resource: "nope" });
    expect(errorsOf(p)).toEqual(['phases[0].weeks[0].blocks.ear.links[1]: unknown resource "nope"']);
  });

  it("rejects duplicate week ids, including across modules", () => {
    const p = clone();
    (p.modules as any)[0].weeks[0].id = "w1";
    expect(errorsOf(p)).toEqual(['modules[0].weeks[0].id: duplicate week id "w1"']);
  });

  it("requires the first week to say what every block does", () => {
    const p = clone();
    delete (p.phases as any)[0].weeks[0].blocks.ear;
    expect(errorsOf(p)).toEqual(["phases[0].weeks[0].blocks.ear: the first week must say what every block does"]);
  });

  it("rejects a module whose availableFrom names no week", () => {
    const p = clone();
    (p.modules as any)[1].availableFrom = "w99";
    expect(errorsOf(p)).toEqual(["modules[1].availableFrom: must name a week id"]);
  });

  it("collects several problems in one pass", () => {
    const p = clone();
    delete p.title;
    (p.blocks as any)[0].minutes = 0;
    (p.resources as any)[0].url = "ftp://x";
    expect(errorsOf(p)).toEqual(["title: required text", "blocks[0].minutes: must be a positive number", "resources[0].url: must be an http(s) URL"]);
  });
});

describe("blocksForWeek", () => {
  it("inherits a block the week does not name from the nearest earlier week", () => {
    const p = clone() as unknown as Plan;
    delete p.phases[0]!.weeks[2]!.blocks.reading;
    expect(blocksForWeek(p, "w3").reading).toEqual(p.phases[0]!.weeks[1]!.blocks.reading);
    expect(blocksForWeek(p, "w3").warmup).toEqual(p.phases[0]!.weeks[2]!.blocks.warmup);
  });

  it("stops at the week asked for", () => {
    expect(blocksForWeek(plan, "w1")).toEqual(plan.phases[0]!.weeks[0]!.blocks);
  });
});
