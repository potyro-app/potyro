// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { addSpend, formatSpend, spentIn } from "../src/ask-spend.js";

// What Ask has cost (#213): the person's own key pays for every request, so each one says what it
// cost, and each app keeps a running total on this device.

beforeEach(() => localStorage.clear());

describe("ask spend", () => {
  it("adds up per app", () => {
    addSpend("places", 0.021);
    addSpend("places", 0.004);
    addSpend("books", 0.001);
    expect(spentIn("places")).toBeCloseTo(0.025, 6);
    expect(spentIn("books")).toBeCloseTo(0.001, 6);
    expect(spentIn("other")).toBe(0);
  });

  it("ignores what is not a cost", () => {
    addSpend("places", Number.NaN);
    addSpend("places", -1);
    addSpend("places", undefined);
    expect(spentIn("places")).toBe(0);
  });

  it("reads as a person would say it", () => {
    expect(formatSpend(0.0004)).toBe("under 1¢");
    expect(formatSpend(0.021)).toBe("2.1¢");
    expect(formatSpend(0.35)).toBe("35¢");
    expect(formatSpend(1.234)).toBe("$1.23");
  });
});
