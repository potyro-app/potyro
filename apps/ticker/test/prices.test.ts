// Coinbase's and Frankfurter's real answers (captured into fixtures/), and the app's sums: coalescing
// many ticks into a few writes, change, sparkline, alerts, pruning.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { candlesUrl, changePct, Coalescer, crossed, demoWalk, fxHistoryUrl, fxLatestUrl, prunePoints, quoteOf, readCandles, readError, readFxHistory, readFxLatest, readTick, sparkline, subscribeMessage, thin } from "../prices.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as unknown;
const ticker = fixture("coinbase-ticker.json") as string[];

describe("Coinbase", () => {
  it("subscribes to the ticker channel as Coinbase expects", () => {
    expect(JSON.parse(subscribeMessage(["BTC-USD", "ETH-USD"]))).toEqual({ type: "subscribe", product_ids: ["BTC-USD", "ETH-USD"], channels: ["ticker"] });
    expect(JSON.parse(subscribeMessage(["SOL-USD"], "unsubscribe")).type).toBe("unsubscribe");
  });

  it("reads its ticker messages, and skips the subscriptions reply", () => {
    expect(readTick(ticker[0]!)).toBeNull(); // {"type":"subscriptions",…}
    const ticks = ticker.map(readTick).filter(Boolean);
    expect(ticks).toHaveLength(ticker.length - 1);
    expect(ticks[0]).toEqual({ code: "ETH-USD", price: 2449.86, open24: 2427.85, time: new Date("2026-10-15T20:01:18.007302Z") });
    expect(new Set(ticks.map((t) => t!.code))).toEqual(new Set(["BTC-USD", "ETH-USD"]));
  });

  it("reads an error, ignores junk", () => {
    expect(readError(JSON.stringify({ type: "error", message: "Failed to subscribe", reason: "BOGUS-USD is not a valid product" }))).toBe("BOGUS-USD is not a valid product");
    expect(readTick("{")).toBeNull();
    expect(readTick(JSON.stringify({ type: "ticker", product_id: "BTC-USD", price: "abc" }))).toBeNull();
  });

  it("reads candles into an hour of closes, oldest first", () => {
    const closes = readCandles(fixture("coinbase-candles-btc.json"));
    expect(closes).toHaveLength(60);
    expect(closes[0]!.at.getTime()).toBeLessThan(closes[59]!.at.getTime());
    expect(closes[59]!.price).toBe(82298.55);
    expect(candlesUrl("BTC-USD")).toBe("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60");
  });
});

describe("Frankfurter (the ECB's rates)", () => {
  it("reads the latest rates and the day they are from", () => {
    expect(readFxLatest(fixture("frankfurter-latest.json"))).toEqual({ base: "EUR", date: "2026-10-15", rates: { BRL: 5.6679, PLN: 4.37, USD: 1.1208 } });
    expect(fxLatestUrl("EUR", ["USD"])).toBe("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD");
  });

  it("reads a month of working days, oldest first", () => {
    const days = readFxHistory(fixture("frankfurter-history.json"), "USD");
    expect(days.length).toBeGreaterThan(18);
    expect(days[0]!.at.toISOString()).toBe("2026-09-15T16:00:00.000Z");
    expect(days.at(-1)!.price).toBe(1.1208);
    expect(fxHistoryUrl("EUR", "USD", new Date("2026-09-01T00:00:00Z"))).toBe("https://api.frankfurter.dev/v1/2026-09-01..?base=EUR&symbols=USD");
  });

  it("knows the currency of a price", () => {
    expect(quoteOf("BTC-USD")).toBe("USD");
    expect(quoteOf("USD/BRL")).toBe("BRL");
  });
});

describe("coalescing ticks", () => {
  const t = (code: string, price: number) => ({ code, price, open24: null, time: new Date() });

  it("turns many ticks a second into at most one write per symbol every few seconds, always the newest price", () => {
    const c = new Coalescer(3000);
    let now = 1_000_000;
    const written: string[] = [];
    const run = () => {
      for (const d of c.due(now)) {
        c.wrote(d, now);
        written.push(`${d.code} ${d.price}`);
      }
    };
    // 10 ticks a second for 10 seconds, on two symbols.
    for (let i = 0; i < 100; i++) {
      c.add(t("BTC-USD", 80000 + i));
      if (i % 2) c.add(t("ETH-USD", 2400 + i));
      run();
      now += 100;
    }
    run();
    // At most one write per symbol per 3 s: 4 each over 10 s (at 0, 3, 6, 9 s).
    expect(written.filter((w) => w.startsWith("BTC")).length).toBe(4);
    expect(written.filter((w) => w.startsWith("ETH")).length).toBe(4);
    expect(written[0]).toBe("BTC-USD 80000");
    expect(written.at(-1)).toMatch(/ \d+$/);
    // Once the newest has been written, nothing more is due.
    now += 5000;
    run();
    const after = written.length;
    c.add(t("BTC-USD", 80150));
    run();
    expect(written.length).toBe(after);
    now += 3000;
    run();
    expect(written.length).toBe(after + 1);
    expect(written.at(-1)).toBe("BTC-USD 80150");
  });

  it("says when the next write is due, and nothing when nothing waits", () => {
    const c = new Coalescer(3000);
    expect(c.nextIn(0)).toBeNull();
    c.add(t("BTC-USD", 1));
    expect(c.nextIn(10_000)).toBe(0);
    c.wrote(t("BTC-USD", 1), 10_000);
    c.add(t("BTC-USD", 2));
    expect(c.nextIn(11_000)).toBe(2000);
  });
});

describe("change, sparkline, alerts, pruning", () => {
  it("works out the change", () => {
    expect(changePct(110, 100)).toBeCloseTo(10);
    expect(changePct(90, 100)).toBeCloseTo(-10);
    expect(changePct(90, null)).toBeNull();
  });

  it("draws a sparkline between the series' own low and high", () => {
    expect(sparkline([10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7])).toBe("▁▂▃▄▅▆▇█");
    expect(sparkline([5, 5, 5])).toBe("▄▄▄");
    expect(thin([1, 2, 3, 4, 5, 6, 7, 8], 4)).toEqual([2, 4, 6, 8]);
  });

  it("rings when a price reaches a line, in either direction", () => {
    expect(crossed(90_100, { above: 90_000 })).toBe("above");
    expect(crossed(79_000, { above: 90_000, below: 80_000 })).toBe("below");
    expect(crossed(85_000, { above: 90_000, below: 80_000 })).toBeNull();
    expect(crossed(85_000, {})).toBeNull();
  });

  it("keeps each symbol's newest points", () => {
    const rows = [
      ...[1, 2, 3, 4].map((m) => ({ id: `b${m}`, code: "BTC-USD", at: new Date(2026, 9, 15, 12, m) })),
      ...[1, 2].map((m) => ({ id: `e${m}`, code: "ETH-USD", at: new Date(2026, 9, 15, 12, m) })),
    ];
    expect(prunePoints(rows, 2).sort()).toEqual(["b1", "b2"]);
  });

  it("walks the demo's market the same way every time, in small steps", () => {
    const a = demoWalk(100, 50, 7);
    expect(demoWalk(100, 50, 7)).toEqual(a);
    expect(Math.max(...a.map((p, i) => Math.abs(p - (a[i - 1] ?? 100)) / (a[i - 1] ?? 100)))).toBeLessThan(0.002);
  });
});
