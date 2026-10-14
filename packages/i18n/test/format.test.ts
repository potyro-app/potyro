import { describe, expect, it } from "vitest";
import { formatDate, formatList, formatNumber, formatRelativeTime } from "../src/format.js";
import { PSEUDO_LOCALE } from "../src/locale.js";

const day = new Date(Date.UTC(2026, 9, 13, 12, 0, 0));
const utc: Intl.DateTimeFormatOptions = { dateStyle: "long", timeZone: "UTC" };

describe("format helpers", () => {
  it("formats dates in the language asked for", () => {
    expect(formatDate("en", day, utc)).toBe("October 13, 2026");
    expect(formatDate("pl", day, utc)).toBe("13 października 2026");
    expect(formatDate("de", day, utc)).toBe("13. Oktober 2026");
    expect(formatDate("pt-BR", day, utc)).toBe("13 de outubro de 2026");
  });

  it("returns nothing for a date that is not one", () => {
    expect(formatDate("en", "not a date")).toBe("");
  });

  it("formats numbers with the language's separators", () => {
    expect(formatNumber("en", 1234.5)).toBe("1,234.5");
    expect(formatNumber("de", 1234.5)).toBe("1.234,5");
    expect(formatNumber("pl", 12345.5).replace(/\s/g, " ")).toBe("12 345,5");
    expect(formatNumber("it", 0.25, { style: "percent" })).toBe("25%");
  });

  it("says relative times in the largest unit that fits", () => {
    const now = day.getTime();
    expect(formatRelativeTime("en", now - 3 * 24 * 3600_000, now)).toBe("3 days ago");
    expect(formatRelativeTime("en", now - 24 * 3600_000, now)).toBe("yesterday");
    expect(formatRelativeTime("en", now + 2 * 3600_000, now)).toBe("in 2 hours");
    expect(formatRelativeTime("en", now, now)).toBe("now");
    expect(formatRelativeTime("pl", now - 5 * 60_000, now)).toBe("5 minut temu");
    expect(formatRelativeTime("es", now + 24 * 3600_000, now)).toBe("mañana");
  });

  it("joins lists the way each language does", () => {
    expect(formatList("en", ["a", "b", "c"])).toBe("a, b, and c");
    expect(formatList("pl", ["a", "b", "c"])).toBe("a, b i c");
    expect(formatList("de", ["a", "b"], { type: "disjunction" })).toBe("a oder b");
  });

  it("formats the pseudo-language as English", () => {
    expect(formatNumber(PSEUDO_LOCALE, 1234.5)).toBe("1,234.5");
    expect(formatList(PSEUDO_LOCALE, ["a", "b"])).toBe("a and b");
  });
});
