import { test, expect, type Page } from "./console-guard";

// Number fields show their unit and get a stepper and the right phone keyboard (#99). Plants'
// watering interval was a bare "7" in a full-width box; Workout's sets and reps the same.

async function openForm(page: Page, app: string, title: string, button: string, via?: string) {
  await page.goto(`/?user=${app}`);
  await expect(page.locator("h1").first()).toHaveText(title, { timeout: 30_000 });
  // `via` is the page to stand on first. A map page adds inline — you arm placement and tap, which
  // puts the record where you pointed — so the shell drops the floating quick action there rather
  // than showing two buttons for one act. Places lands on its Map, so its form is reached from the
  // list; the form itself is the same one either way, and the number field is what is under test.
  if (via) await page.getByRole("tab", { name: via }).or(page.getByRole("button", { name: via })).first().click();
  await page.getByRole("button", { name: button }).click();
  const form = page.locator(".k-form");
  await expect(form).toBeVisible();
  return form;
}

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("Plants: the interval says days, steps by 44px buttons, and asks for the numeric keyboard", async ({ page }) => {
    const form = await openForm(page, "plants", "Plants", "Add: Plant", "Plants");
    const interval = form.getByRole("spinbutton", { name: "Watering Interval Days" });
    await expect(interval).toHaveValue("7");
    await expect(interval).toHaveAttribute("inputmode", "numeric");
    const wrapper = form.locator(".k-number").filter({ has: page.getByRole("spinbutton", { name: "Watering Interval Days" }) });
    await expect(wrapper.locator(".k-number-unit")).toHaveText("days");
    const plus = wrapper.getByRole("button", { name: /Increase/ });
    const minus = wrapper.getByRole("button", { name: /Decrease/ });
    for (const b of [plus, minus]) {
      const box = (await b.boundingBox())!;
      expect(Math.round(Math.min(box.width, box.height))).toBeGreaterThanOrEqual(44);
    }
    await plus.tap();
    await expect(interval).toHaveValue("8");
    await minus.tap();
    await minus.tap();
    await expect(interval).toHaveValue("6");
    // The text stays editable.
    await interval.fill("10");
    await expect(interval).toHaveValue("10");
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Workout: target sets is an integer with a stepper and a unit; Places: a half-star rating steps by 0.5", async ({ page }) => {
    const exercise = await openForm(page, "workout", "PPL Log", "New exercise");
    const sets = exercise.getByRole("spinbutton", { name: "Target Sets" });
    await expect(sets).toHaveAttribute("inputmode", "numeric");
    await expect(sets).toHaveValue("3");
    const wrap = exercise.locator(".k-number").filter({ has: page.getByRole("spinbutton", { name: "Target Sets" }) });
    await expect(wrap.locator(".k-number-unit")).toHaveText("sets");
    await wrap.getByRole("button", { name: /Increase/ }).click();
    await expect(sets).toHaveValue("4");
    // Below its minimum the button is disabled, not silently clamped.
    await sets.fill("1");
    await expect(wrap.getByRole("button", { name: /Decrease/ })).toBeDisabled();

    const place = await openForm(page, "places", "Places", "Add: Place", "All places");
    const rating = place.getByRole("spinbutton", { name: "Rating" });
    await expect(rating).toHaveAttribute("inputmode", "decimal");
    const rwrap = place.locator(".k-number").filter({ has: page.getByRole("spinbutton", { name: "Rating" }) });
    await rwrap.getByRole("button", { name: /Increase/ }).click();
    await expect(rating).toHaveValue("0");
    await rwrap.getByRole("button", { name: /Increase/ }).click();
    await expect(rating).toHaveValue("0.5");
  });
});
