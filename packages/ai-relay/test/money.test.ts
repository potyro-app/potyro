import { describe, expect, it } from "vitest";
import { addressKey } from "../src/address.ts";
import { createBudget } from "../src/budget.ts";
import { memoryLedger, persistentLedger, type LedgerState } from "../src/ledger.ts";
import { estimateUsd, MODEL_PRICES, priceOf, readModelPrices } from "../src/prices.ts";
import { dayWindow } from "../src/window.ts";

const HOUR = 60 * 60 * 1000;

describe("whose address it is, for the limits", () => {
  it("is an IPv4 address itself, and an IPv6 address its /64", () => {
    expect(addressKey("203.0.113.7")).toBe("203.0.113.7");
    expect(addressKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(addressKey("2001:0DB8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
    expect(addressKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(addressKey("[2001:db8:1:2::1]")).toBe("2001:db8:1:2::/64");
    expect(addressKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(addressKey("::1")).toBe("0:0:0:0::/64");
  });

  it("is the IPv4 address when it comes written as IPv6, and anything else as it is", () => {
    expect(addressKey("::ffff:198.51.100.4")).toBe("198.51.100.4");
    expect(addressKey("::ffff:c633:6404")).toBe("198.51.100.4");
    expect(addressKey("unknown")).toBe("unknown");
    expect(addressKey("1:2:3:4:5:6:7:8:9")).toBe("1:2:3:4:5:6:7:8:9");
    expect(addressKey("1::2::3")).toBe("1::2::3");
  });
});

describe("a day of what one key did", () => {
  it("forgets what is a day old, and a key nobody sends again within the next sweep", () => {
    let now = 0;
    const w = dayWindow<number>(() => now);
    w.add("a", 1);
    w.add("b", 2);
    now += 23 * HOUR;
    w.add("a", 3);
    expect(w.get("a")).toEqual([1, 3]);
    now += 2 * HOUR;
    expect(w.get("a")).toEqual([3]);
    // "b" was never asked for again, and is gone after the sweep the next request brings.
    expect(w.size()).toBe(1);
  });

  it("looks at its own key only between sweeps", () => {
    let now = 0;
    const w = dayWindow<number>(() => now);
    w.add("x", 1);
    now = 23.5 * HOUR;
    w.add("y", 1); // a sweep: x is not a day old yet
    now = 24.2 * HOUR;
    // x is a day old now, but the last sweep was less than an hour ago: only the key asked about is looked at.
    w.get("y");
    expect(w.size()).toBe(2);
    expect(w.get("x")).toEqual([]);
    expect(w.size()).toBe(1);
  });

  it("holds at most maxKeys keys, letting go of the one first seen longest ago", () => {
    const w = dayWindow<number>(() => 0, { maxKeys: 2 });
    w.add("a", 1);
    w.add("b", 1);
    w.add("c", 1);
    expect(w.size()).toBe(2);
    expect(w.get("a")).toEqual([]);
    expect(w.get("c")).toEqual([1]);
  });
});

describe("what a request can cost at most", () => {
  it("is the body's characters / 4 at the input price plus max_tokens at the output price", () => {
    expect(estimateUsd({ input: 1, output: 2 }, 4_000_000, 500_000)).toBeCloseTo(2);
    // The Studio's high thinking level on DeepSeek V4 Flash, with a 100 000-character chat.
    expect(estimateUsd(MODEL_PRICES["deepseek/deepseek-v4-flash-0731"]!, 100_000, 64_000)).toBeCloseTo(0.0035 + 0.01792, 6);
  });

  it("has a price for every model the relay sends by default, and takes more or other prices from AI_MODEL_PRICES", () => {
    expect(priceOf(MODEL_PRICES, "google/gemini-2.5-flash-lite")).toEqual({ input: 0.1, output: 0.4 });
    const prices = readModelPrices('{"openai/gpt-6": {"input": 5, "output": 20}, "deepseek/deepseek-v4-flash-0731": {"input": 0.2, "output": 0.5}}');
    expect(prices["openai/gpt-6"]).toEqual({ input: 5, output: 20 });
    expect(prices["deepseek/deepseek-v4-flash-0731"]).toEqual({ input: 0.2, output: 0.5 });
    expect(prices["google/gemini-2.5-flash-lite"]).toEqual({ input: 0.1, output: 0.4 });
    expect(readModelPrices(undefined)).toBe(MODEL_PRICES);
    expect(() => priceOf(MODEL_PRICES, "openai/gpt-6")).toThrow(/AI_MODEL_PRICES/);
  });

  it("will not start on prices it cannot read", () => {
    expect(() => readModelPrices("{nope")).toThrow(/not JSON/);
    expect(() => readModelPrices("[1]")).toThrow(/not an object/);
    expect(() => readModelPrices('{"m": {"input": -1, "output": 1}}')).toThrow(/bad entry for m/);
    expect(() => readModelPrices('{"m": {"input": 1}}')).toThrow(/bad entry/);
    expect(() => readModelPrices('{"m": {"input": 1, "output": 1, "cache": 0}}')).toThrow(/bad entry/);
  });
});

describe("the service's budget", () => {
  const NOW = Date.UTC(2026, 9, 15, 12);

  it("is an eighth of the month a day by default", () => {
    expect(createBudget({ now: () => NOW, monthlyUsd: 10 }).dayUsd).toBe(1.25);
    expect(createBudget({ now: () => NOW }).monthlyUsd).toBe(10);
  });

  it("counts what is held against both caps, and spends the day's when a hold is let go", () => {
    let now = NOW;
    const ledger = memoryLedger();
    const budget = createBudget({ now: () => now, ledger, monthlyUsd: 1, dayUsd: 0.1 });
    const release = budget.hold(0.06);
    // In the way, though nothing is spent: not now, and not "used up" either.
    expect(budget.over(0.05)).toBe("busy");
    expect(budget.over(0.04)).toBeNull();
    release(0.07);
    release(0.07); // once only
    expect(budget.held()).toBe(0);
    expect(ledger.daySpent("2026-10-15")).toBeCloseTo(0.07);
    // Spent: the day really is used up for a request this size.
    expect(budget.over(0.04)).toBe("service-day");
    now += 24 * HOUR;
    expect(budget.over(0.04)).toBeNull();
    ledger.addSpend("2026-10", 0.99);
    expect(budget.over(0.02)).toBe("service-month");
  });

  it("says busy, never used up, when a cap is crossed only by what requests in flight hold", () => {
    const ledger = memoryLedger();
    const budget = createBudget({ now: () => NOW, ledger, monthlyUsd: 0.5, dayUsd: 0.41 });
    const releases = Array.from({ length: 19 }, () => budget.hold(0.02));
    // 0.38 held of a day of 0.41 and nothing spent: the twentieth fits, the twenty-first waits.
    expect(budget.over(0.02)).toBeNull();
    releases.push(budget.hold(0.02));
    expect(budget.over(0.02)).toBe("busy");
    // They settle at what they really cost, and there is room again.
    releases.forEach((r) => r(0.001));
    expect(budget.over(0.02)).toBeNull();
    // The month the same: 0.49 held of 0.50 by one large request.
    const big = createBudget({ now: () => NOW, monthlyUsd: 0.5, dayUsd: 5 });
    big.hold(0.49);
    expect(big.over(0.02)).toBe("busy");
  });

  it("lets only so many requests be out at once, whatever they hold", () => {
    const budget = createBudget({ now: () => NOW, monthlyUsd: 100, maxInFlight: 2 });
    expect(createBudget({ now: () => NOW }).maxInFlight).toBe(50);
    const a = budget.hold(0.001);
    budget.hold(0.001);
    expect(budget.inFlight()).toBe(2);
    expect(budget.over(0.001)).toBe("busy");
    a(0);
    expect(budget.inFlight()).toBe(1);
    expect(budget.over(0.001)).toBeNull();
    expect(() => createBudget({ now: () => NOW, maxInFlight: 0 })).toThrow(/AI_MAX_IN_FLIGHT/);
  });
});

describe("the ledger never moves backwards", () => {
  it("drops a write for an ended month, reads it as 0, and keeps the month that began", () => {
    const stale: number[] = [];
    const ledger = memoryLedger(null, { onStale: (n) => stale.push(n) });
    ledger.debit("2026-10", "d1", 0.3);
    ledger.debit("2026-11", "d2", 0.1);
    ledger.addCount("2026-11", "d2");
    // A request sent in October settles now.
    ledger.debit("2026-10", "d1", 0.2);
    ledger.addSpend("2026-10", 0.2);
    ledger.addCount("2026-10", "d1");
    expect(ledger.markExhausted("2026-10", "d1")).toBe(false);
    expect(ledger.spent("2026-11")).toBeCloseTo(0.1);
    expect(ledger.deviceSpent("2026-11", "d2")).toBeCloseTo(0.1);
    expect(ledger.count("2026-11", "d2")).toBe(1);
    expect(ledger.spent("2026-10")).toBe(0);
    expect(ledger.deviceSpent("2026-10", "d1")).toBe(0);
    expect(ledger.count("2026-10", "d1")).toBe(0);
    expect(ledger.stale()).toBe(3);
    expect(stale).toEqual([1, 2, 3]);
  });

  it("still counts a demand event for the month it happened in, without moving back to it", () => {
    const ledger = memoryLedger();
    ledger.addSpend("2026-11", 0.1);
    ledger.addEvent("2026-10", "visit");
    expect(ledger.events()).toEqual({ "2026-10": { visit: 1 } });
    expect(ledger.spent("2026-11")).toBeCloseTo(0.1);
  });

  it("keeps the day's spend across a restart and a new month, and drops one for an ended day", () => {
    let saved: LedgerState | null = null;
    const one = persistentLedger(null, (s) => (saved = structuredClone(s)));
    one.addDaySpend("2026-10-31", 0.5);
    one.addSpend("2026-11", 0.01);
    const two = persistentLedger(saved, () => {});
    expect(two.daySpent("2026-10-31")).toBe(0.5);
    two.addDaySpend("2026-11-01", 0.2);
    two.addDaySpend("2026-10-31", 0.3);
    expect(two.daySpent("2026-11-01")).toBeCloseTo(0.2);
    expect(two.daySpent("2026-10-31")).toBe(0);
    expect(two.stale()).toBe(1);
    expect(() => persistentLedger({ month: "2026-10", spent: 0, devices: {}, daySpent: "x" } as never, () => {})).toThrow(/not a ledger/);
  });
});
