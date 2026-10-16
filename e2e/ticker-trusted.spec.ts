import { readFileSync } from "node:fs";
import { test, expect, type Page } from "./console-guard";
import { packApp } from "./library-demos";
import { action, addPackage, allowLive, allowNetwork, connected, createFake, routeTo, tab, type FakeService } from "./live-apps";

// apps/ticker, packed as its build packs it, against local fakes of Coinbase Exchange's feed (its real
// `subscribe` / `subscriptions` / `ticker` messages, captured into apps/ticker/fixtures), Coinbase's
// candles and Frankfurter's ECB rates. The page connects to the real addresses; Playwright answers.
//
// SHARED (sealed): asked before the network and the live connection, naming Coinbase; subscribed to
// the watchlist; a hundred ticks a second shown at most every three seconds; an alert set, ringing
// once; the currency from the ECB with its day. YOURS: the demo, with nothing sent, and a symbol's chart.

const COINBASE_WS = "wss://ws-feed.exchange.coinbase.com/";
const TICKER = JSON.parse(readFileSync(new URL("../apps/ticker/fixtures/coinbase-ticker.json", import.meta.url), "utf8")) as string[];
const CANDLES = JSON.parse(readFileSync(new URL("../apps/ticker/fixtures/coinbase-candles-btc.json", import.meta.url), "utf8")) as number[][];
const FX_HISTORY = readFileSync(new URL("../apps/ticker/fixtures/frankfurter-history.json", import.meta.url), "utf8");

test.use({ locale: "en-GB", timezoneId: "Europe/Warsaw", viewport: { width: 420, height: 900 } });

const json = (body: unknown) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: typeof body === "string" ? body : JSON.stringify(body) });

/** Coinbase's candles (moved to now) and the ECB's rates through Frankfurter. */
async function routeRest(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(/^https:\/\/api\.exchange\.coinbase\.com\/products\/[^/]+\/candles/, async (route) => {
    asked.push(route.request().url());
    const shift = Math.floor(Date.now() / 60_000) * 60 - CANDLES[0]![0]!;
    const base = route.request().url().includes("ETH") ? 2449.86 / 82298.55 : 1;
    await route.fulfill(json(CANDLES.map((c) => [c[0]! + shift, ...c.slice(1, 5).map((p) => p * base), c[5]])));
  });
  await page.route(/^https:\/\/api\.frankfurter\.dev\/v1\//, async (route) => {
    asked.push(route.request().url());
    const url = route.request().url();
    await route.fulfill(json(url.includes("/latest") ? { amount: 1, base: "EUR", date: "2026-10-15", rates: { USD: 1.1208 } } : FX_HISTORY));
  });
  return asked;
}

/** Coinbase answers a subscribe with what it subscribed, as it does. */
function coinbase(): FakeService {
  const fake = createFake();
  fake.onFirst = (first, send) => {
    const sub = JSON.parse(first) as { product_ids: string[] };
    send(JSON.stringify({ type: "subscriptions", channels: [{ name: "ticker", product_ids: sub.product_ids, account_ids: null }] }));
  };
  return fake;
}

/** A real ticker message with another price. */
const tick = (code: string, price: number) => {
  const m = JSON.parse(TICKER.find((t) => t.includes(`"product_id":"${code}"`))!) as Record<string, unknown>;
  return JSON.stringify({ ...m, price: String(price), time: new Date().toISOString() });
};

const status = (page: Page) => page.locator(".k-aggregate-row").first();
const row = (page: Page, code: string) => page.getByRole("main").locator(".k-list-row", { hasText: code });

test("a shared copy: asked first, subscribed, a hundred ticks a second shown every few seconds, an alert that rings once", async ({ page }) => {
  test.setTimeout(120_000);
  const feed = coinbase();
  const asked = await routeRest(page);
  await routeTo(page, COINBASE_WS, feed);
  await addPackage(page, "ticker", packApp("ticker", "ticker.app.ts"), false);
  await expect(status(page)).toContainText("Not live");

  await action(page, "Watch live").click();
  await allowNetwork(page, "Ticker");
  await allowLive(page, "“Ticker” wants a live connection to ws-feed.exchange.coinbase.com.");
  await connected(feed);
  await expect.poll(() => feed.received.length).toBeGreaterThan(0);
  expect(JSON.parse(feed.received[0]!)).toEqual({ type: "subscribe", product_ids: ["BTC-USD", "ETH-USD"], channels: ["ticker"] });
  await expect(status(page)).toContainText("● Live");
  // The hour behind it came from Coinbase's candles; the euro from the ECB, with its day.
  expect(asked.filter((u) => u.includes("/candles"))).toHaveLength(2);
  await expect(row(page, "BTC-USD")).toContainText("US$82,298.55");
  await expect(row(page, "EUR/USD")).toContainText("1.1208");
  await expect(row(page, "EUR/USD")).toContainText("ECB 15 Oct");

  // A hundred ticks a second for four seconds: what the list shows changes at most every three.
  const shown = new Set<string>();
  const watch = setInterval(() => void row(page, "BTC-USD").innerText().then((t) => shown.add(t.split("\n")[0]!)).catch(() => {}), 50);
  for (let i = 0; i < 40; i++) {
    for (let k = 0; k < 10; k++) feed.push(tick("BTC-USD", 82_400 + i * 10 + k));
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(3500);
  clearInterval(watch);
  await expect(row(page, "BTC-USD")).toContainText("US$82,799.00");
  expect(shown.size).toBeGreaterThanOrEqual(2);
  expect(shown.size).toBeLessThanOrEqual(4);

  // An alert above the price: set on the symbol's page, it rings once when crossed, then it is gone.
  await row(page, "BTC-USD").click();
  await page.getByRole("button", { name: "Set an alert" }).click();
  const form = page.getByRole("dialog", { name: "Alert for BTC-USD" });
  await form.getByRole("spinbutton", { name: /goes above/ }).fill("83000");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Alert set. It rings once, while the app is open.")).toBeVisible();
  feed.push(tick("BTC-USD", 83_050));
  await expect(page.getByText("🔔 BTC-USD went above US$83,000.00 — US$83,050.00")).toBeVisible({ timeout: 10_000 });
  await tab(page, "Alerts").click();
  await expect(page.getByRole("main").locator(".k-list-row", { hasText: "BTC-USD · US$83,000.00" })).toContainText("Went above");
  await expect(page.getByText("No alerts waiting.")).toBeVisible();

  await page.goBack();
  await page.goBack();
  await page.goBack();
  await expect.poll(() => feed.open(), { timeout: 10_000 }).toBe(0);
});

test("your own copy: the demo ticks with nothing sent, and a symbol opens on its chart", async ({ page }) => {
  const outside: string[] = [];
  page.on("request", (r) => {
    if (/coinbase|frankfurter/.test(r.url())) outside.push(r.url());
  });
  page.on("websocket", (ws) => {
    if (!ws.url().startsWith("ws://localhost")) outside.push(ws.url());
  });
  await addPackage(page, "ticker", packApp("ticker", "ticker.app.ts"), true);
  await action(page, "Demo").click();
  await expect(status(page)).toContainText("Demo — made-up prices");
  await expect(row(page, "BTC-USD")).toContainText(/US\$8\d,\d{3}\.\d\d/, { timeout: 15_000 });
  await expect(row(page, "BTC-USD")).toContainText(/[▁▂▃▄▅▆▇█]{16}/);
  await row(page, "ETH-USD").click();
  await expect(page.locator(".k-field", { hasText: /^Now/ })).toContainText("US$");
  await expect(page.locator(".k-chart-bar, .k-chart rect, [data-k-chart] rect").first()).toBeVisible();
  expect(outside).toEqual([]);
});
