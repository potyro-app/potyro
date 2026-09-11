import { test, expect } from "@playwright/test";

// A boolean field is a switch row (#97). In the Plants form, "Needs Direct Sun" and "Active" used
// to be a grey caption over a 13px browser checkbox. Now each is one row: the label, a toggle, the
// whole thing the hit target, 44px tall, and a real switch to a keyboard and a screen reader.

async function openNewPlant(page: import("@playwright/test").Page): Promise<import("@playwright/test").Locator> {
  await page.goto("/?user=plants");
  await expect(page.locator("h1").first()).toHaveText("Plants", { timeout: 30_000 });
  await page.getByRole("button", { name: "New Plant" }).click();
  const form = page.locator(".k-form");
  await expect(form).toBeVisible();
  return form;
}

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("the booleans are switch rows: 44px, the whole row toggles, and the value is saved", async ({ page }) => {
    const form = await openNewPlant(page);
    const sun = form.getByRole("switch", { name: "Needs Direct Sun" });
    const active = form.getByRole("switch", { name: "Active" });
    await expect(sun).toHaveAttribute("aria-checked", "false");
    await expect(active).toHaveAttribute("aria-checked", "true"); // its default
    const box = (await sun.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    const formBox = (await form.boundingBox())!;
    expect(box.width).toBeGreaterThan(formBox.width * 0.8); // the row, not a 13px box
    // A tap on the label end of the row, far from the toggle, toggles it.
    await sun.tap({ position: { x: 12, y: box.height / 2 } });
    await expect(sun).toHaveAttribute("aria-checked", "true");
    await expect(form.locator("input[type=checkbox]")).toHaveCount(0);

    await form.getByRole("textbox").first().fill("Sun-lover");
    await form.getByRole("button", { name: "Create" }).tap();
    await expect(form).toHaveCount(0);
    await expect(page.locator(".k-list-row", { hasText: "Sun-lover" })).toBeVisible();
    // The value went into the record, not just the row's look. (Headless Chromium has no OPFS, so
    // the app's store is the localStorage fallback and the record is readable there.)
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("karta:user:plants") ?? ""))
      .toMatch(/"needsDirectSun":true/);
  });
});

test.describe("keyboard", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Space toggles the focused row, and the focus ring is visible", async ({ page }) => {
    const form = await openNewPlant(page);
    const sun = form.getByRole("switch", { name: "Needs Direct Sun" });
    await sun.focus();
    await page.keyboard.press("Space");
    await expect(sun).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Space");
    await expect(sun).toHaveAttribute("aria-checked", "false");
    // Reached by keyboard, so :focus-visible applies: the outline is real, not "none".
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(await sun.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  });
});
