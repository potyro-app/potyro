// Summary figures: the one shape the built-in views could not express. `computed` is per-record and
// every view renders rows, so a number over the WHOLE set had nowhere to go — which is why three of
// the generator's own corpus prompts (`expenses`, `subscriptions`, `guests`) had no answer.
//
// The arithmetic is tested here, away from rendering. Two properties matter beyond "it adds up":
// an empty set must not report a confident zero where zero is a lie, and a `value` function is app
// code that must never be able to take the page down with it.

import { describe, expect, it, vi } from "vitest";
import type { Ctx, Resolved, SummaryValue } from "karta";
import { computeFigure, computeSummary, formatFigure } from "../src/summary.js";

const rows = (...values: Record<string, unknown>[]): Resolved[] =>
  values.map((v, i) => ({ id: `r${i}`, createdAt: "", updatedAt: "", ...v }) as Resolved);

const ctx = { today: () => new Date("2026-08-15T00:00:00Z"), now: () => new Date("2026-08-15T12:00:00Z") } as unknown as Ctx;
const text = async (spec: SummaryValue, rs: Resolved[], unit?: string): Promise<string | null> =>
  (await computeFigure(spec, rs, ctx, unit)).text;

describe("declarative aggregation", () => {
  const expenses = rows({ amount: 3.4 }, { amount: 380 }, { amount: 29.5 });

  it("sums a field", async () => {
    expect(await text({ label: "Total", field: "amount", op: "sum" }, expenses)).toBe("412.9");
  });

  it("counts rows without needing a field", async () => {
    expect(await text({ label: "Entries", op: "count" }, expenses)).toBe("3");
  });

  it("averages and maxes", async () => {
    expect(await text({ label: "Avg", field: "amount", op: "avg" }, expenses)).toBe("137.63");
    expect(await text({ label: "Biggest", field: "amount", op: "max" }, expenses)).toBe("380");
  });

  it("aggregates a computed field just like a stored one", async () => {
    // This is what makes the declarative form cover `guests` and `subscriptions`: push the per-record
    // arithmetic into `computed`, and the summary stays declarative (so it stays editable + portable).
    const guests = rows({ seats: 1 }, { seats: 3 }, { seats: 2 });
    expect(await text({ label: "Head count", field: "seats", op: "sum" }, guests)).toBe("6");
  });

  it("skips non-numeric values rather than producing NaN", async () => {
    const messy = rows({ amount: 10 }, { amount: null }, { amount: "n/a" }, {}, { amount: 5 });
    expect(await text({ label: "Total", field: "amount", op: "sum" }, messy)).toBe("15");
    expect(await text({ label: "Avg", field: "amount", op: "avg" }, messy)).toBe("7.5");
  });

  it("appends the field's unit when it declares one", async () => {
    expect(await text({ label: "Distance", field: "km", op: "sum" }, rows({ km: 12 }), "km")).toBe("12 km");
  });
});

describe("an empty set", () => {
  it("sums to zero — nothing spent really is zero", async () => {
    expect(await text({ label: "Total", field: "amount", op: "sum" }, [])).toBe("0");
    expect(await text({ label: "Entries", op: "count" }, [])).toBe("0");
  });

  it("has no average or maximum, and says so instead of claiming zero", async () => {
    // A filter that matches nothing showing "Avg 0" is a wrong answer, not an empty one.
    expect(await text({ label: "Avg", field: "amount", op: "avg" }, [])).toBe("–");
    expect(await text({ label: "Biggest", field: "amount", op: "max" }, [])).toBe("–");
  });
});

describe("value functions", () => {
  it("receives the filtered rows and ctx", async () => {
    // `expenses`' "monthly total" is the case the declarative form cannot reach: it needs a date
    // window, so it needs a function.
    const all = rows(
      { amount: 10, date: new Date("2026-08-02") },
      { amount: 99, date: new Date("2026-07-30") },
      { amount: 5, date: new Date("2026-08-14") },
    );
    const spec: SummaryValue = {
      label: "This month",
      value: (rs, c) =>
        rs
          .filter((r) => (r.date as Date).getMonth() === c.today().getMonth())
          .reduce((n, r) => n + (r.amount as number), 0),
    };
    expect(await text(spec, all)).toBe("15");
  });

  it("may return a string to control its own formatting", async () => {
    expect(await text({ label: "Total", value: () => "€412.90" }, [])).toBe("€412.90");
  });

  it("gets a copy of the rows, so it cannot corrupt the page's data", async () => {
    const original = rows({ amount: 1 }, { amount: 2 });
    await computeFigure({ label: "x", value: (rs) => rs.sort(() => -1).length }, original, ctx);
    expect(original.map((r) => r.amount)).toEqual([1, 2]);
  });

  it("is contained when it throws — one bad summary must not blank the page", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const figure = await computeFigure({ label: "Boom", value: () => { throw new Error("nope"); } }, [], ctx);
    expect(figure).toMatchObject({ label: "Boom", text: null, error: "nope" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not stop the figures beside it from computing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const figures = await computeSummary(
      [
        { label: "Boom", value: () => { throw new Error("nope"); } },
        { label: "Count", op: "count" },
      ],
      rows({}, {}),
      ctx,
    );
    expect(figures.map((f) => f.text)).toEqual([null, "2"]);
    warn.mockRestore();
  });
});

describe("formatting", () => {
  it("trims the long decimals that summing money produces", async () => {
    expect(formatFigure(0.1 + 0.2)).toBe("0.3");
    expect(formatFigure(412.9000000000001)).toBe("412.9");
  });

  it("leaves integers alone", async () => {
    expect(formatFigure(42)).toBe("42");
  });

  it("shows a dash for nothing, rather than an empty gap", async () => {
    expect(formatFigure(null)).toBe("–");
    expect(formatFigure(undefined)).toBe("–");
    expect(formatFigure(Number.NaN)).toBe("–");
  });
});
