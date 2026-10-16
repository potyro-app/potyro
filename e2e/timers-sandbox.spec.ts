import { test, expect } from "./console-guard";
import { chip, installKitchen, run, switchToPantry, wakeLog } from "./kitchen.js";

// The same timer and screen lock from a sealed app (docs/04): the app only asks, across the realm's
// port; the shell keeps the countdown and holds the screen, and lets go when the app is left.

test.use({ viewport: { width: 390, height: 844 } });

test("a sealed app starts a timer the shell keeps, and holds the screen until it is left", async ({ page }) => {
  await installKitchen(page, false);
  await run(page, "Bake bread");
  const bread = chip(page, "Bread in the oven");
  await expect(bread.getByRole("timer")).toHaveText(/^4[45]:\d\d$/);
  await bread.getByRole("button", { name: "Pause" }).click();
  await run(page, "How many timers");
  await expect(page.locator(".k-toast").last()).toHaveText("1: Bread in the oven (paused)");

  await run(page, "Screen on");
  await expect(page.locator("html")).toHaveAttribute("data-k-awake", "");
  await expect.poll(() => wakeLog(page)).toEqual(["request:screen"]);
  await run(page, "Screen off");
  await expect(page.locator("html")).not.toHaveAttribute("data-k-awake", "");
  await expect.poll(() => wakeLog(page)).toEqual(["request:screen", "release"]);

  // Held again and forgotten: leaving the app lets go all the same.
  await run(page, "Screen on");
  await expect.poll(() => wakeLog(page)).toHaveLength(3);
  await switchToPantry(page);
  await expect(page.locator("html")).not.toHaveAttribute("data-k-awake", "");
  await expect.poll(() => wakeLog(page)).toEqual(["request:screen", "release", "request:screen", "release"]);
  await expect(chip(page, "Kitchen · Bread in the oven")).toBeVisible();
});
