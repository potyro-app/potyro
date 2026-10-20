import { fileURLToPath } from "node:url";
import { catalogProblems } from "@potyro/generator/app-catalog";
import { readAppSources } from "@potyro/generator/app-sources";
// The app's shape and words, and the prices end to end against a scripted ctx: the watchlist started,
// an hour of candles, the ECB's rates, Coinbase's ticks coalesced into few writes, a point a minute,
// an alert that rings once, symbols added and removed while live, the demo.
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkReferences, checkWords, isPotyroApp, wordGaps, type Resolved } from "potyro";
import app from "../ticker.app.js";
import { addSymbol, clearDemo, DEMO_TICK_MS, DEMO_TICKS, idle, KEEP_POINTS, playDemo, removeSymbol, resetForTests, setAlert, stopWatching, watchLive, WRITE_EVERY_MS, writesSoFar } from "../feed.js";
import { COINBASE_WS } from "../prices.js";
import { fakeCtx, settle } from "./fake.js";
import { LANGUAGES } from "./say.js";

const dir = new URL("../", import.meta.url);
const source = readdirSync(dir)
  .filter((f) => f.endsWith(".ts") && f !== "vitest.config.ts")
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as unknown;
const candles = fixture("coinbase-candles-btc.json") as number[][];

/** Coinbase's candles and Frankfurter's rates, moved to now. */
function services(url: string): unknown {
  if (url.includes("/candles")) {
    const shift = Math.floor(Date.now() / 1000 / 60) * 60 - candles[0]![0]!;
    return candles.map((c) => [c[0]! + shift, ...c.slice(1)]);
  }
  if (url.includes("/latest")) {
    const u = new URL(url);
    const rates: Record<string, number> = { USD: 1.1208, PLN: 4.37, BRL: 5.6679 };
    return { amount: 1, base: u.searchParams.get("base"), date: new Date().toISOString().slice(0, 10), rates: Object.fromEntries(u.searchParams.get("symbols")!.split(",").map((s) => [s, rates[s]])) };
  }
  if (url.includes("..")) return fixture("frankfurter-history.json");
  return undefined;
}

const tick = (code: string, price: number, open = price) => JSON.stringify({ type: "ticker", product_id: code, price: String(price), open_24h: String(open), time: new Date().toISOString() });
const sym = (f: ReturnType<typeof fakeCtx>, code: string) => f.rows("symbol").find((s) => s.code === code)!;

beforeEach(() => {
  resetForTests();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  resetForTests();
  vi.useRealTimers();
});

describe("Ticker — the app", () => {
  it("is a valid app that reaches Coinbase and the ECB's rates only through ctx", () => {
    expect(isPotyroApp(app)).toBe(true);
    expect(checkReferences(app)).toEqual([]);
    expect(app.permissions).toEqual({ network: { hosts: ["ws-feed.exchange.coinbase.com", "api.exchange.coinbase.com", "api.frankfurter.dev"] }, notifications: true, haptics: true });
    expect(source).not.toMatch(/\bfetch\(["'`]|new WebSocket|navigator\.|document\.|window\./);
  });

  it("uses only built-in views", () => {
    for (const p of app.pages) for (const v of p.layout ? p.layout.items.map((i) => i.view) : [p.view]) expect(v.type, p.id).not.toBe("custom");
    expect(app.quickActions).toEqual([]);
  });

  it("carries a catalog for each other language, in step with its code, every word translated, every placeholder kept (docs/30)", async () => {
    // Its source and the modules of its own it imports: their words are the app's.
    const { source: code, modules } = readAppSources(fileURLToPath(new URL("../ticker.app.ts", import.meta.url)));
    const read = (l: string): string | undefined => {
      try {
        return readFileSync(new URL(`../locales/${l}.po`, import.meta.url), "utf8");
      } catch {
        return undefined;
      }
    };
    const catalogs = Object.fromEntries(["pt-BR", "de", "es", "pl", "it"].map((l) => [l, read(l)]));
    expect(await catalogProblems({ source: code, modules, catalogs, same: /^(\S{1,5}|Ticker|Bitcoin|Ether|Coinbase)$/ })).toEqual([]);
  });
});

describe("live prices", () => {
  it("starts a watchlist, fills an hour in from candles and a month of rates, then subscribes to Coinbase", async () => {
    const f = fakeCtx({ fetch: services });
    await watchLive(f.ctx);
    await idle();
    await settle();
    expect(f.rows("symbol").map((s) => s.code)).toEqual(["BTC-USD", "ETH-USD", "EUR/USD"]);
    expect(f.opened).toEqual([COINBASE_WS]);
    expect(JSON.parse(f.sockets[0]!.sent[0]!)).toEqual({ type: "subscribe", product_ids: ["BTC-USD", "ETH-USD"], channels: ["ticker"] });
    expect(f.rows("point").filter((p) => p.code === "BTC-USD")).toHaveLength(KEEP_POINTS);
    expect(sym(f, "BTC-USD")).toMatchObject({ price: 82298.55 });
    expect(String(sym(f, "BTC-USD").spark)).toMatch(/^[▁▂▃▄▅▆▇█]{16}$/);
    // The ECB: the latest rate, its change since the working day before, its month behind it.
    expect(sym(f, "EUR/USD")).toMatchObject({ price: 1.1208, trend: expect.any(String) });
    expect(f.rows("point").filter((p) => p.code === "EUR/USD").length).toBeGreaterThan(18);
    expect(f.rows("feed")[0]).toMatchObject({ state: "live", fxOk: true });
  });

  it("coalesces: a hundred ticks a second become one write per symbol every three seconds, the newest price", async () => {
    const f = fakeCtx({ fetch: services });
    await watchLive(f.ctx);
    await idle();
    await settle();
    const before = writesSoFar();
    for (let ms = 0; ms < 9000; ms += 10) {
      f.sockets[0]!.push(tick("BTC-USD", 82000 + ms / 10, 81000));
      if (ms % 50 === 0) await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(WRITE_EVERY_MS);
    await settle();
    // 900 ticks over ~9 s: about four writes, not 900.
    expect(writesSoFar() - before).toBeGreaterThanOrEqual(3);
    expect(writesSoFar() - before).toBeLessThanOrEqual(5);
    expect(sym(f, "BTC-USD")).toMatchObject({ price: 82899, base: 81000, trend: "up" });
    expect(Number(sym(f, "BTC-USD").change)).toBeCloseTo(2.34, 1);
    // A point a minute, never more than an hour of them.
    expect(f.rows("point").filter((p) => p.code === "BTC-USD").length).toBeLessThanOrEqual(KEEP_POINTS);
  });

  it("an alert rings once when the price crosses its line, and is then cleared", async () => {
    const f = fakeCtx({ fetch: services });
    await watchLive(f.ctx);
    await idle();
    await settle();
    f.form = { above: 83000, below: null };
    await setAlert(sym(f, "BTC-USD") as Resolved, f.ctx);
    expect(sym(f, "BTC-USD")).toMatchObject({ above: 83000, below: null });
    f.sockets[0]!.push(tick("BTC-USD", 83010));
    await vi.advanceTimersByTimeAsync(WRITE_EVERY_MS);
    await settle();
    f.sockets[0]!.push(tick("BTC-USD", 83500));
    await vi.advanceTimersByTimeAsync(WRITE_EVERY_MS);
    await settle();
    expect(f.rows("alert")).toHaveLength(1);
    expect(f.rows("alert")[0]).toMatchObject({ code: "BTC-USD", direction: "above", level: 83000, price: 83010 });
    expect(f.toasts.filter((t) => t.startsWith("🔔"))).toEqual(["🔔 BTC-USD went above US$83,000.00 — US$83,010.00"]);
    expect(sym(f, "BTC-USD").above).toBeNull();
  });

  it("a symbol added while live is subscribed at once; one removed is unsubscribed, its points gone", async () => {
    const f = fakeCtx({ fetch: services });
    await watchLive(f.ctx);
    await idle();
    await settle();
    (f.ctx.ui as unknown as { sheet: () => Promise<string> }).sheet = async () => "SOL-USD";
    await addSymbol(f.ctx);
    await idle();
    expect(JSON.parse(f.sockets[0]!.sent.at(-1)!)).toEqual({ type: "subscribe", product_ids: ["SOL-USD"], channels: ["ticker"] });
    (f.ctx.ui as unknown as { confirm: () => Promise<boolean> }).confirm = async () => true;
    (f.ctx as unknown as { navigate: () => void }).navigate = () => {};
    await removeSymbol(sym(f, "BTC-USD") as Resolved, f.ctx);
    await idle();
    expect(JSON.parse(f.sockets[0]!.sent.at(-1)!).type).toBe("unsubscribe");
    expect(f.rows("point").filter((p) => p.code === "BTC-USD")).toHaveLength(0);
    expect(f.rows("symbol").map((s) => s.code)).not.toContain("BTC-USD");
  });

  it("currencies alone stream nothing: fetched now, and said so", async () => {
    const f = fakeCtx({ fetch: services });
    await f.ctx.create("symbol", { code: "EUR/PLN", kind: "fx", name: "Euro → Polish złoty" });
    await watchLive(f.ctx);
    await idle();
    expect(f.opened).toEqual([]);
    expect(f.toasts.at(-1)).toMatch(/^Currencies updated/);
  });

  it("stop closes the stream", async () => {
    const f = fakeCtx({ fetch: services });
    await watchLive(f.ctx);
    await idle();
    await settle();
    await stopWatching(f.ctx);
    expect(f.sockets[0]!.readyState).toBe("closed");
    expect(f.rows("feed")[0]).toMatchObject({ state: "off" });
  });
});

describe("the demo", () => {
  it("an hour of made-up history, then a made-up market through the same reading and coalescing — nothing sent", async () => {
    const f = fakeCtx();
    await playDemo(f.ctx);
    await idle();
    expect(f.rows("point").filter((p) => p.code === "BTC-USD")).toHaveLength(KEEP_POINTS);
    const first = sym(f, "BTC-USD").price;
    await vi.advanceTimersByTimeAsync(DEMO_TICK_MS * 60);
    await settle();
    expect(sym(f, "BTC-USD").price).not.toBe(first);
    // Many ticks, few writes.
    expect(writesSoFar()).toBeLessThan(10);
    await vi.advanceTimersByTimeAsync(DEMO_TICK_MS * DEMO_TICKS + WRITE_EVERY_MS);
    await settle();
    expect(f.rows("feed")[0]).toMatchObject({ state: "demo-done" });
    expect(f.opened).toEqual([]);
    expect(f.fetched).toEqual([]);
    await clearDemo(f.ctx);
    await idle();
    expect(f.rows("point")).toHaveLength(0);
    expect(f.rows("symbol").map((s) => [s.code, s.price ?? null])).toEqual([["BTC-USD", null], ["ETH-USD", null], ["EUR/USD", null]]);
  });
});

describe("a demo link (docs/04 §Demo)", () => {
  it("declares its demo: the replay the Demo button plays, started by the shell when a link opens", () => {
    expect(app.demo).toBe(playDemo);
  });
});
