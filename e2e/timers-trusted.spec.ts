import { test, expect } from "./console-guard";
import { chip, installKitchen, run, switchToPantry, wakeLog } from "./kitchen.js";

// `ctx.ui.timer` (docs/04 §Timers): a countdown the shell keeps — in sight on the app's other pages,
// at home and after a reload, paused and stopped from its chip, ringing at the end until Done. And
// `ctx.ui.keepAwake`: the screen's lock asked for while held, and let go when the app is left.

const shots = process.env.POTYRO_SHOTS;

test.use({ viewport: { width: 390, height: 844 } });

test("a timer outlives the page, the app and a reload, and rings until Done", async ({ page }) => {
  await installKitchen(page, true);
  await run(page, "Bake bread");
  const bread = chip(page, "Bread in the oven");
  await expect(bread).toBeVisible();
  await expect(bread.getByRole("timer")).toHaveText(/^4[45]:\d\d$/);

  // Another page of the app: still there.
  await page.locator(".k-tab", { hasText: "Notes" }).click();
  await expect(bread).toBeVisible();
  await expect(bread.getByRole("timer")).toHaveText(/^4[45]:\d\d$/);
  if (shots) await page.screenshot({ path: `${shots}/timer-chip-phone.png` });

  // Paused from the chip, and the app hears it.
  await bread.getByRole("button", { name: "Pause" }).click();
  await expect(bread).toHaveAttribute("data-paused");
  await page.locator(".k-tab", { hasText: "Cook" }).click();
  await run(page, "How many timers");
  await expect(page.locator(".k-toast").last()).toHaveText("1: Bread in the oven (paused)");
  await bread.getByRole("button", { name: "Resume" }).click();
  await expect(bread).not.toHaveAttribute("data-paused");

  // Another app: the chip names Kitchen, and takes you back to it.
  await switchToPantry(page);
  const elsewhere = chip(page, "Kitchen · Bread in the oven");
  await expect(elsewhere).toBeVisible();
  await elsewhere.getByRole("button", { name: /Kitchen · Bread/ }).click();
  await expect(page.locator("h1").first()).toHaveText("Kitchen", { timeout: 30_000 });

  // Home, after a reload: the shell kept it.
  await page.goto("/");
  const atHome = chip(page, "Kitchen · Bread in the oven");
  await expect(atHome).toBeVisible({ timeout: 30_000 });
  await expect(atHome.getByRole("timer")).toHaveText(/^4[345]:\d\d$/);
  if (shots) await page.screenshot({ path: `${shots}/timer-chip-home.png` });
  await atHome.getByRole("button", { name: /Kitchen · Bread/ }).click();
  await expect(page.locator("h1").first()).toHaveText("Kitchen", { timeout: 30_000 });

  // A short one rings, and stays rung until Done; restarting by id does not stack a second.
  await run(page, "Rest 3 s");
  await run(page, "Rest 3 s");
  await expect(chip(page, "Rest")).toHaveCount(1);
  const rung = page.locator(".k-timer-chip[data-ringing]", { hasText: "Rest" });
  await expect(rung).toContainText("Time’s up", { timeout: 10_000 });
  if (shots) await page.screenshot({ path: `${shots}/timer-chip-ringing.png` });
  await run(page, "How many timers");
  await expect(page.locator(".k-toast").last()).toHaveText("1: Bread in the oven");
  await rung.getByRole("button", { name: "Done" }).click();
  await expect(rung).toHaveCount(0);

  // Stopped from its chip.
  await chip(page, "Bread in the oven").getByRole("button", { name: "Stop timer" }).click();
  await expect(page.locator(".k-timer-chip")).toHaveCount(0);
});

test("keepAwake asks for the screen's lock and lets go when the app is left", async ({ page }) => {
  await installKitchen(page, true);
  expect(await wakeLog(page)).toEqual([]);
  await run(page, "Screen on");
  await expect(page.locator("html")).toHaveAttribute("data-k-awake", "");
  await expect.poll(() => wakeLog(page)).toEqual(["request:screen"]);

  // Leaving the app lets go, though the app never released it.
  await switchToPantry(page);
  await expect(page.locator("html")).not.toHaveAttribute("data-k-awake", "");
  await expect.poll(() => wakeLog(page)).toEqual(["request:screen", "release"]);
});
