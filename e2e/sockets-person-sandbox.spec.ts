import { test, expect, type Page } from "./console-guard";
import { startEcho, type EchoServer } from "./live-servers.js";
import { allow, line, openLiveEcho, tap } from "./live-echo.js";
import { tileAction } from "./launcher-actions.js";

// What the person decides about a SHARED app's live connections (docs/28), in the browser realm and
// in the QuickJS fallback:
//   - Edit tile's "Live connections" takes a permission back — the open connection ends at once, the
//     server sees it go, and the app is refused without a question until the switch is on again;
//   - a device on the home network (`hosts: ["local"]`): the person types its address, the question
//     names it, and it is remembered;
//   - `keepWhileHidden`: one connection outlives Potyro being hidden, another closes on time;
//   - a connect slower than a sealed call's whole budget (~1 s) still finishes: waiting on the network
//     is not the app running away.

const SHOTS = process.env.POTYRO_SHOTS;

let echo: EchoServer;
let slow: EchoServer;

test.beforeAll(async () => {
  echo = await startEcho();
  slow = await startEcho({ delayMs: 2500 });
});
test.afterAll(async () => {
  await echo?.close();
  await slow?.close();
});

const open = (page: Page, sandbox: "realm" | "quickjs") => openLiveEcho(page, { echoPort: echo.port, otherPort: slow.port, slowPort: slow.port, trusted: false, sandbox });

/** Edit tile for Live Echo, from the switcher, while the app stays open underneath. */
async function editTile(page: Page) {
  await page.getByRole("button", { name: "Switch app" }).click();
  const switcher = page.getByRole("dialog", { name: "Switch app" });
  await tileAction(switcher, "Live Echo", "edit-tile");
  const editor = page.getByRole("dialog", { name: "Edit tile: Live Echo" });
  await expect(editor).toBeVisible();
  return {
    editor,
    async save() {
      await editor.getByRole("button", { name: "Save" }).click();
      await expect(editor).toHaveCount(0);
      await switcher.press("Escape");
      await expect(switcher).toHaveCount(0);
    },
  };
}

/** Potyro goes to the background (or comes back), as the browser says it when the person switches away. */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

for (const sandbox of ["realm", "quickjs"] as const) {
  test(`Edit tile takes a live connection back: it ends at once, and stays off until turned on (${sandbox})`, async ({ page, browserName }) => {
    await open(page, sandbox);
    await tap(page, "Connect");
    await allow(page, `“Live Echo” wants a live connection to 127.0.0.1:${echo.port}.`);
    await expect(line(page, "echo hello")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => echo.open()).toBe(1);

    const tile = await editTile(page);
    const section = tile.editor.locator(".k-tile-editor-live");
    await expect(section).toContainText("Live connections");
    await expect(section).toContainText(`127.0.0.1:${echo.port}`);
    const toggle = tile.editor.getByRole("switch", { name: `Live connection to 127.0.0.1:${echo.port}` });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    if (SHOTS && sandbox === "realm") await page.screenshot({ path: `${SHOTS}/edit-tile-live-connections-${browserName}.png` });
    await tile.save();

    // At once: the app hears why, and the server sees the connection go.
    await expect(line(page, "closed off 1000")).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => echo.open(), { timeout: 10_000 }).toBe(0);

    // The next try is refused, and nobody is asked.
    await tap(page, "Connect");
    await expect(line(page, "refused off")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".k-dialog")).toHaveCount(0);
    expect(echo.open()).toBe(0);

    // On again: it connects, still without a question.
    const again = await editTile(page);
    await again.editor.getByRole("switch", { name: `Live connection to 127.0.0.1:${echo.port}` }).check();
    await again.save();
    await tap(page, "Connect");
    await expect(line(page, "echo hello")).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator(".k-dialog")).toHaveCount(0);
  });

  test(`a device on the home network: the person gives its address, the question names it, it is remembered (${sandbox})`, async ({ page, browserName }) => {
    await open(page, sandbox);
    await tap(page, "Home device");
    const ask = page.locator(".k-dialog");
    await expect(ask).toContainText("“Live Echo” wants to connect to a device on your home network.");
    await expect(ask).toContainText("For example 192.168.1.20 or homeassistant.local");
    if (SHOTS && sandbox === "realm") {
      await page.waitForTimeout(400); // past the dialog's fade-in
      await page.screenshot({ path: `${SHOTS}/local-device-address-${browserName}.png` });
    }
    // Not on the home network: asked again, naming what was typed.
    await ask.locator("input").fill("example.com");
    await ask.getByRole("button", { name: "Continue" }).click();
    await expect(ask).toContainText("“example.com” is not an address on your home network.");
    // The echo server stands in for the device: on this machine, which is local too.
    await ask.locator("input").fill("127.0.0.1");
    await ask.getByRole("button", { name: "Continue" }).click();
    await expect(ask).toContainText("“Live Echo” wants a live connection to 127.0.0.1 on your home network.");
    if (SHOTS && sandbox === "realm") await ask.screenshot({ path: `${SHOTS}/local-device-consent-${browserName}.png` });
    await allow(page, "“Live Echo” wants a live connection to 127.0.0.1 on your home network.");
    await expect(line(page, `home open ws://127.0.0.1:${echo.port}/home`)).toBeVisible({ timeout: 15_000 });
    await expect(line(page, "home echo lights on")).toBeVisible();
    expect(echo.paths).toContain("/home");

    // Remembered: the next connection asks nothing.
    await tap(page, "Home device");
    await expect(line(page, "home echo lights on")).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator(".k-dialog")).toHaveCount(0);

    // And listed in Edit tile as a home device, with its switch.
    const tile = await editTile(page);
    const row = tile.editor.locator(".k-tile-editor-live-row", { hasText: "127.0.0.1" });
    await expect(row).toContainText("A device on your home network");
    await expect(row.getByRole("button", { name: "Change address" })).toBeVisible();
    if (SHOTS && sandbox === "realm") {
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/edit-tile-home-device-${browserName}.png` });
    }
    await tile.editor.getByRole("button", { name: "Cancel" }).click();
  });

  test(`keepWhileHidden: one connection outlives Potyro being hidden, the other closes on time (${sandbox})`, async ({ page }) => {
    await open(page, sandbox);
    await tap(page, "Keep two");
    await allow(page, `“Live Echo” wants a live connection to 127.0.0.1:${echo.port}.`);
    await expect(line(page, "kept two")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => echo.open()).toBe(2);

    await setHidden(page, true);
    await expect(line(page, "brief closed hidden")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2000);
    await expect(line(page, "chat closed hidden")).toHaveCount(0);
    expect(echo.open()).toBe(1);
    await setHidden(page, false);
    await page.waitForTimeout(500);
    expect(echo.open()).toBe(1);
  });

  test(`a connect slower than a sealed call's whole budget still opens (${sandbox})`, async ({ page }) => {
    // A call over budget is stopped, and the shell says so in a warning — in QuickJS the app's own
    // continuation may still write its line after the call was given up, so the line alone proves little.
    const failed: string[] = [];
    page.on("console", (m) => {
      if (/did not finish within|timed out after|page action .* failed/.test(m.text())) failed.push(m.text());
    });
    await open(page, sandbox);
    await tap(page, "Slow server");
    await allow(page, `“Live Echo” wants a live connection to 127.0.0.1:${slow.port}.`);
    // The server holds the handshake 2.5 s, more than twice the box's budget for one call.
    await expect(line(page, "slow open")).toBeVisible({ timeout: 15_000 });
    await expect(line(page, "slow refused")).toHaveCount(0);
    expect(failed).toEqual([]);
  });
}
