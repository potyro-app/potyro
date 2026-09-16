// Money in whole minor units (KA-26, #66).
//
// The reason is not tidiness: `0.1 + 0.2` is not `0.3`, and in a shared ledger that difference is
// written into the document and merged. Two people's copies then differ by a rounding error nobody
// can find afterwards. Integers cannot drift — and a split whose remainder is handed out by a rule
// everyone follows lands on the same cent on every device.

import { describe, expect, it } from "vitest";
import { formatMoney, minorDigits, parseMoney, shareOf, splitEvenly } from "../src/index.js";

describe("how many digits a currency has", () => {
  it("knows a euro has two and a yen none", () => {
    expect(minorDigits("EUR")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
    expect(minorDigits("NOT-A-CURRENCY")).toBe(2); // behaves like the common case rather than throwing
  });
});

describe("writing an amount", () => {
  it("formats minor units as money, per currency", () => {
    expect(formatMoney(4200, "EUR", "en-IE")).toBe("€42.00");
    expect(formatMoney(-1850, "EUR", "en-IE")).toBe("-€18.50");
    expect(formatMoney(0, "EUR", "en-IE")).toBe("€0.00");
    // A yen has no minor unit: 5 is five yen, not five sen.
    expect(formatMoney(5, "JPY", "en-US")).toBe("¥5");
  });

  it("writes it the way the reader's own place writes it", () => {
    expect(formatMoney(123456, "EUR", "de-DE")).toContain("1.234,56");
    expect(formatMoney(123456, "EUR", "en-IE")).toContain("1,234.56");
  });
});

describe("reading what someone typed", () => {
  it("takes the ways people actually write amounts", () => {
    expect(parseMoney("42", "EUR")).toBe(4200);
    expect(parseMoney("42.5", "EUR")).toBe(4250);
    expect(parseMoney("42,50", "EUR")).toBe(4250); // a comma is a decimal point to most of Europe
    expect(parseMoney("1 234.5", "EUR")).toBe(123450);
    expect(parseMoney("5", "JPY")).toBe(5);
  });

  it("rounds to the cent once, rather than carrying a float forward", () => {
    expect(parseMoney("0.1", "EUR")! + parseMoney("0.2", "EUR")!).toBe(30);
    expect(parseMoney("42.005", "EUR")).toBe(4201);
  });

  it("says null for what is not an amount", () => {
    expect(parseMoney("", "EUR")).toBeNull();
    expect(parseMoney("abc", "EUR")).toBeNull();
    expect(parseMoney("4.2.1", "EUR")).toBeNull();
  });
});

describe("splitting a bill", () => {
  it("hands out the remainder a cent each, so the parts add back up", () => {
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEvenly(1000, 3).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(splitEvenly(4200, 4)).toEqual([1050, 1050, 1050, 1050]);
    expect(splitEvenly(-1000, 3)).toEqual([-334, -333, -333]);
  });

  it("is the same on every device, because the order is the caller's", () => {
    expect(shareOf(1000, 3, 0)).toBe(334);
    expect(shareOf(1000, 3, 1)).toBe(333);
    expect(shareOf(1000, 3, 9)).toBe(0); // nobody at that index
  });

  it("refuses what is not a whole amount between whole people", () => {
    expect(splitEvenly(10.5, 3)).toEqual([]);
    expect(splitEvenly(1000, 0)).toEqual([]);
  });
});
