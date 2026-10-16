import { test, expect, type Page } from "./console-guard";
import { startEcho, type EchoServer } from "./live-servers.js";
import { line, openLiveEcho, tap } from "./live-echo.js";
import { tileAction } from "./launcher-actions.js";

// The person's own app and its live connections (docs/28): it is never asked for permission, but a
// device on the home network still needs its address — asked once, remembered, and listed in Edit
// tile where it can be turned off (the open connection ends at once). `keepWhileHidden` holds there too.

let echo: EchoServer;

test.beforeAll(async () => {
  echo = await startEcho();
});
test.afterAll(async () => {
  await echo?.close();
});

const open = (page: Page) => openLiveEcho(page, { echoPort: echo.port, otherPort: echo.port, trusted: true });

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("your own app: a home device's address is asked once — no permission question — and its switch turns it off", async ({ page }) => {
  await open(page);
  await tap(page, "Home device");
  const ask = page.locator(".k-dialog");
  await expect(ask).toContainText("“Live Echo” wants to connect to a device on your home network.");
  await ask.locator("input").fill("127.0.0.1");
  await ask.getByRole("button", { name: "Continue" }).click();
  await expect(line(page, `home open ws://127.0.0.1:${echo.port}/home`)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".k-dialog")).toHaveCount(0);
  await expect.poll(() => echo.open()).toBe(1);

  await page.getByRole("button", { name: "Switch app" }).click();
  const switcher = page.getByRole("dialog", { name: "Switch app" });
  await tileAction(switcher, "Live Echo", "edit-tile");
  const editor = page.getByRole("dialog", { name: "Edit tile: Live Echo" });
  await editor.getByRole("switch", { name: "Live connection to 127.0.0.1" }).uncheck();
  await editor.getByRole("button", { name: "Save" }).click();
  await switcher.press("Escape");

  await expect(line(page, "home closed off")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => echo.open(), { timeout: 10_000 }).toBe(0);
  await tap(page, "Home device");
  await expect(line(page, "home refused off")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".k-dialog")).toHaveCount(0);
});

test("your own app: keepWhileHidden keeps one connection while Potyro is hidden, and lets the other close", async ({ page }) => {
  await open(page);
  await tap(page, "Keep two");
  await expect(line(page, "kept two")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => echo.open()).toBe(2);
  await setHidden(page, true);
  await expect(line(page, "brief closed hidden")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2000);
  await expect(line(page, "chat closed hidden")).toHaveCount(0);
  expect(echo.open()).toBe(1);
  await setHidden(page, false);
});
