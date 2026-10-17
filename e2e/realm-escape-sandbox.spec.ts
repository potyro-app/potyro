import { test, expect, type Page } from "./console-guard";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installShared, startGapMeter, startProbe, type Probe } from "./realm.js";

// The escape suite (#272, docs/22 §3) as a product spec: an adversarial shared app, opened the way a
// person opens one, tries every way out of the browser realm from its logic. The evidence is not its
// report but what reached the probe server, and the shell's own URL and storage afterwards. Then the
// watchdog: logic that never yields, and logic that returns and THEN spins, are stopped without the
// shell's own thread noticing, and the app answers again afterwards.
//
// Runs in Chromium (the `sandbox` project), Firefox (`sandbox-firefox`, POTYRO_FIREFOX=1) and WebKit
// (POTYRO_REALM_BROWSERS=1).

test.use({ viewport: { width: 1280, height: 800 } });

const FIXTURE = readFileSync(fileURLToPath(new URL("./fixtures/realm-escape.app.ts", import.meta.url)), "utf8");

let probe: Probe;
test.beforeAll(async () => {
  probe = await startProbe();
});
test.afterAll(async () => {
  await probe.close();
});

async function open(page: Page): Promise<void> {
  probe.hits.length = 0;
  await page.addInitScript(() => localStorage.setItem("potyro-secret", "the shell's own"));
  const shell = new URL(String(test.info().project.use.baseURL)).origin;
  await installShared(page, "realm-escape", "Escape attempts", FIXTURE.replaceAll("__PROBE__", probe.origin).replaceAll("__SHELL__", shell));
}

const toast = (page: Page) => page.locator(".k-toast").last();

/**
 * What the app may do and does: write a record through ctx (stamped as this device, checked below),
 * and construct a Worker from a URL — the constructor does not throw, and the request it would make
 * is refused by the realm's CSP, which the probe count below shows.
 */
const EXPECTED_ALLOWED = new Set(["create with forged createdBy", "new Worker(url)"]);

test("nothing the realm's logic tries reaches the network, the shell's storage or another identity", async ({ page, browserName, consoleGuard }) => {
  // Firefox puts each refusal by the realm's own CSP, and its refused cross-origin Worker, in the page's
  // console (Chromium keeps the frame's to itself). Every attempt is the test's; the probe counts them.
  consoleGuard.allow(/^\[JavaScript Error: "Content-Security-Policy: The page’s settings blocked .*\{file: "about:srcdoc"/, "the escape attempts are refused by the realm's CSP on purpose");
  consoleGuard.allow(/^\[JavaScript Error: "Security Error: Content at moz-nullprincipal:\S+ may not load data from http:\/\/127\.0\.0\.1:\d+\/probe\//, "the realm's Worker from the probe's URL is refused on purpose");
  consoleGuard.allow(/^\[JavaScript Error: "Firefox can’t establish a connection to the server at http:\/\/127\.0\.0\.1:\d+\/probe\/sse\."/, "the realm's EventSource to the probe is refused on purpose");
  await open(page);
  const before = page.url();
  await page.locator(".k-page-action", { hasText: "Try to escape" }).click();
  await expect(toast(page)).toContainText('"origin"', { timeout: 60_000 });
  const report = JSON.parse(String(await toast(page).textContent())) as Record<string, string>;

  // What the app saw: every attempt blocked or absent…
  const allowed = Object.entries(report).filter(([, v]) => v.startsWith("ALLOWED"));
  // WebKit gives an opaque Worker a working `caches`; the next test shows it does not outlive the realm.
  const mayOpenCaches = browserName === "webkit" ? ["caches"] : [];
  expect(allowed.filter(([k]) => !EXPECTED_ALLOWED.has(k) && !mayOpenCaches.includes(k))).toEqual([]);
  expect(report["create with forged createdBy"]).toMatch(/^ALLOWED: stamped as me/);
  expect(report["caps.network.fetch (no permission)"]).toMatch(/Permission denied: Escape attempts → network/);
  expect(report["raw op: relay.connect"]).toBe("blocked: op not allowed: relay.connect");
  expect(report["raw op: __proto__"]).toBe("blocked: op not allowed: __proto__");
  expect(report["raw op: unknown ctxId"]).toBe("blocked: no such ctx");
  expect(report["origin"]).toMatch(/opaque origin null/);

  // …and what actually happened: nothing reached the probe (the control below shows the same app run
  // as yours reaching it, and its fetch of the shell's own origin answered), and the shell's
  // own URL and storage are as they were.
  await page.waitForTimeout(500);
  expect(probe.hits).toEqual([]);
  expect(page.url()).toBe(before);
  expect(await page.evaluate(() => localStorage.getItem("potyro-secret"))).toBe("the shell's own");
  // The forged record is there, under this device's name.
  await expect(page.getByRole("listitem").filter({ hasText: "forged" })).toHaveCount(1);
});

test("what a realm stores does not reach the next realm", async ({ page }) => {
  await open(page);
  await page.locator(".k-page-action", { hasText: "Cache write" }).click();
  // Refused outright (Chromium, Firefox), or kept for this realm only (WebKit).
  await expect(toast(page)).toHaveText(/^caches: (blocked|\d+)/);
  await page.reload();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await page.locator(".k-page-action", { hasText: "Cache read" }).click();
  await expect(toast(page)).toHaveText(/^caches: (blocked|nothing there)/);
});

test("control: the same app run as yours does reach the probe, so the empty count above means something", async ({ page, consoleGuard }) => {
  consoleGuard.allow(/^WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/relay' failed|^EventSource's response has a MIME type/, "the trusted control dials the test's probe server with every kind of connection; the probe only counts them");
  consoleGuard.allow(
    /^\[JavaScript Error: "(Firefox can’t establish a connection to the server at (ws|http):\/\/127\.0\.0\.1:\d+\/(relay|probe\/sse)\.|Security Error: Content at http:\/\/localhost:\d+\/\?user=realm-escape may not load data from http:\/\/127\.0\.0\.1:\d+\/probe\/worker\.js\.)"/,
    "the same dials in Firefox's words (a cross-origin Worker URL is refused there by the browser itself)",
  );
  probe.hits.length = 0;
  const source = FIXTURE.replaceAll("__PROBE__", probe.origin).replaceAll("__SHELL__", new URL(String(test.info().project.use.baseURL)).origin);
  await page.addInitScript((src) => {
    localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "realm-escape", name: "Escape attempts", source: src, trusted: true, updatedAt: new Date().toISOString() }]));
  }, source);
  await page.goto("/?user=realm-escape");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
  await page.locator(".k-page-action", { hasText: "Try to escape" }).click();
  await expect(toast(page)).toContainText('"origin"', { timeout: 60_000 });
  await expect.poll(() => probe.hits.some((h) => h.includes("/probe/worker-fetch")), { timeout: 10_000 }).toBe(true);
  const report = JSON.parse(String(await toast(page).textContent())) as Record<string, string>;
  expect(report["fetch(shell)"]).toMatch(/^ALLOWED/);
});

test("logic that never yields is stopped in about a second, and the shell's thread never stalls", async ({ page }) => {
  await open(page);
  const gap = await startGapMeter(page);
  const started = Date.now();
  await page.getByRole("button", { name: "Spin", exact: true }).click();
  await expect(toast(page)).toContainText("stopped", { timeout: 10_000 });
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(await gap()).toBeLessThan(250);

  // A fresh realm answers the next call, with the browser's own Intl.
  await page.locator(".k-page-action", { hasText: "Still here?" }).click();
  await expect(toast(page)).toHaveText("still here: 1.234,5");
});

test("logic that returns and then spins is caught by the heartbeat", async ({ page }) => {
  await open(page);
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "warning") warnings.push(m.text());
  });
  const gap = await startGapMeter(page);
  await page.locator(".k-page-action", { hasText: "Return then spin" }).click();
  await expect(toast(page)).toHaveText("returned");
  await expect.poll(() => warnings.some((w) => /a shared app was stopped: its logic stopped answering/.test(w)), { timeout: 10_000 }).toBe(true);
  expect(await gap()).toBeLessThan(250);
  await page.locator(".k-page-action", { hasText: "Still here?" }).click();
  await expect(toast(page)).toHaveText("still here: 1.234,5");
});
