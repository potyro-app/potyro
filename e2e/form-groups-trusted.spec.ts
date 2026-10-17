import { test, expect, type Page } from "./console-guard";

// Entity groups drive the form (#100), and the record page unless the page names its own `sections`:
// Recipes declares five groups for its form, and its record page reads ingredients and steps first. A
// required field left empty is told so under the field and gets the focus; two `width: "half"`
// neighbours share a row on a wide screen and stack on a phone.

async function openApp(page: Page, app: string, title: string): Promise<void> {
  await page.goto(`/?user=${app}`);
  await expect(page.locator("h1").first()).toHaveText(title, { timeout: 30_000 });
}

/**
 * Wait out the form sheet's open animation. Two boxes read while the sheet slides in are read at
 * two different moments, so "is B below A" compared positions from different frames and failed
 * about one run in two.
 */
async function settled(page: Page): Promise<void> {
  await expect(page.locator(".k-modal").first()).toBeVisible();
  await page.locator(".k-modal").first().evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))).then(() => undefined),
  );
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Recipes: the page's own sections on the record, the entity's groups in its form; an empty name is refused under the field", async ({ page }) => {
    await openApp(page, "recipes", "Recipes");

    // The record page: the page's own `sections` — what is read at the stove first.
    await page.locator(".k-card").first().click();
    const detail = page.locator("article.k-detail");
    await expect(detail).toBeVisible();
    // Headings are plain for a section that does not fold and a button for one that does (#108).
    await expect(detail.locator(".k-section h3, .k-section .k-fold-title")).toHaveText(["Ingredients", "Steps", "Your notes", "Nutrition & cost"]);
    const nutrition = detail.getByRole("button", { name: /^Nutrition & cost/ });
    await expect(nutrition).toHaveAttribute("aria-expanded", "false");
    await nutrition.click();
    await expect(nutrition).toHaveAttribute("aria-expanded", "true");
    // A computed value in a section shows under its own label (#310).
    await expect(detail.locator(".k-field dt", { hasText: "Calories per serving" })).toBeVisible();

    // The form: the entity's five groups, the computed-only fields skipped, Steps folded.
    await detail.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const form = page.locator(".k-modal .k-form");
    await expect(form).toBeVisible();
    await expect(form.locator(".k-form-group-title")).toHaveText(["Overview", "Ingredients", "Steps", "Nutrition & cost", "Your notes"]);
    await expect(form.locator("details.k-form-group")).not.toHaveAttribute("open", "");
    const name = form.getByRole("textbox", { name: "Name" });
    await expect(name).toHaveAttribute("placeholder", "Shakshuka");
    await expect(form.getByText("The per-serving figures divide by this")).toBeVisible();

    // Saved with no name: the complaint is under the field, the field is marked, and focused.
    await name.fill("");
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(form.locator(".k-form-field-error")).toHaveText(["Required"]);
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toBeFocused();
    await expect(form.getByText(/^Required:/)).toHaveCount(0);
    await expect(page.locator(".k-modal")).toHaveCount(1);
    // Typing clears it; the save goes through.
    await name.fill("E2E Grouped Dish");
    await expect(name).not.toHaveAttribute("aria-invalid", "true");
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator(".k-modal")).toHaveCount(0);
    await expect(detail.locator(".k-detail-title")).toHaveText("E2E Grouped Dish");
  });

  test("Plants: two half-width fields share a row", async ({ page }) => {
    await openApp(page, "plants", "Plants");
    await page.getByRole("button", { name: "Add: Plant" }).click();
    const form = page.locator(".k-form");
    await settled(page);
    const watered = form.locator(".k-form-field").filter({ has: page.getByLabel("Last watered") });
    const interval = form.locator(".k-form-field").filter({ has: page.getByRole("spinbutton", { name: "Water every" }) });
    const a = (await watered.boundingBox())!;
    const b = (await interval.boundingBox())!;
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(a.x).toBeLessThan(b.x);
    await expect(form.getByText("The reminder comes this many days after a watering")).toBeVisible();
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("Plants: the half-width fields stack", async ({ page }) => {
    await openApp(page, "plants", "Plants");
    // The "+" is "Add a plant" (a photo or typed); the whole form is in the ⋯ menu.
    await page.getByRole("button", { name: "More", exact: true }).tap();
    await page.getByRole("menu", { name: "More" }).getByRole("menuitem", { name: /Add: Plant/ }).tap();
    const form = page.locator(".k-form");
    await settled(page);
    const watered = form.locator(".k-form-field").filter({ has: page.getByLabel("Last watered") });
    const interval = form.locator(".k-form-field").filter({ has: page.getByRole("spinbutton", { name: "Water every" }) });
    const a = (await watered.boundingBox())!;
    const b = (await interval.boundingBox())!;
    expect(b.y).toBeGreaterThan(a.y + a.height - 1);
    expect(Math.abs(a.width - b.width)).toBeLessThan(2);
  });
});
