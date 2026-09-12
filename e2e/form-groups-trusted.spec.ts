import { test, expect, type Page } from "@playwright/test";

// Entity groups drive both the form and the detail page (#100): Recipes declares four, and the
// person who edits a recipe under "Nutrition & cost" reads it back under "Nutrition & cost". A
// required field left empty is told so under the field and gets the focus; two `width: "half"`
// neighbours share a row on a wide screen and stack on a phone.

async function openApp(page: Page, app: string, title: string): Promise<void> {
  await page.goto(`/?user=${app}`);
  await expect(page.locator("h1").first()).toHaveText(title, { timeout: 30_000 });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Recipes: the form and the detail page show the same groups; an empty name is refused under the field", async ({ page }) => {
    await openApp(page, "recipes", "Recipes");

    // The detail page: the entity's groups, no page `sections` needed.
    await page.locator(".k-list-row").first().click();
    const detail = page.locator("article.k-detail");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".k-section h3")).toHaveText(["Overview", "Ingredients", "Steps", "Nutrition & cost"]);
    // The folded group is closed until opened, and opens.
    const steps = detail.locator("details.k-section");
    await expect(steps).toHaveCount(1);
    await expect(steps).not.toHaveAttribute("open", "");
    await steps.locator("summary").click();
    await expect(steps).toHaveAttribute("open", "");
    // A computed value in a group shows on the detail page.
    await expect(detail.locator(".k-field dt", { hasText: "Calories Per Serving" })).toBeVisible();

    // The form: the same four groups, the computed-only fields skipped, Steps folded.
    await page.getByRole("button", { name: /Recipes/ }).click();
    await page.locator(".k-quickbar").getByRole("button", { name: /New Recipe/ }).click();
    const form = page.locator(".k-modal .k-form");
    await expect(form).toBeVisible();
    await expect(form.locator(".k-form-group-title")).toHaveText(["Overview", "Ingredients", "Steps", "Nutrition & cost"]);
    await expect(form.locator("details.k-form-group")).not.toHaveAttribute("open", "");
    const name = form.getByRole("textbox", { name: "Name" });
    await expect(name).toHaveAttribute("placeholder", "Shakshuka");
    await expect(form.getByText("The per-serving figures divide by this")).toBeVisible();

    // Submit with nothing: the complaint is under the field, the field is marked, and focused.
    await form.getByRole("button", { name: "Create" }).click();
    await expect(form.locator(".k-form-field-error")).toHaveText(["Required"]);
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toBeFocused();
    await expect(form.getByText(/^Required:/)).toHaveCount(0);
    await expect(page.locator(".k-modal")).toHaveCount(1);
    // Typing clears it; the create goes through.
    await name.fill("E2E Grouped Dish");
    await expect(name).not.toHaveAttribute("aria-invalid", "true");
    await form.getByRole("button", { name: "Create" }).click();
    await expect(page.locator("article.k-detail")).toBeVisible();
  });

  test("Plants: two half-width fields share a row", async ({ page }) => {
    await openApp(page, "plants", "Plants");
    await page.getByRole("button", { name: "New Plant" }).click();
    const form = page.locator(".k-form");
    const watered = form.locator(".k-form-field").filter({ has: page.getByLabel("Last Watered") });
    const interval = form.locator(".k-form-field").filter({ has: page.getByRole("spinbutton", { name: "Watering Interval Days" }) });
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
    await page.getByRole("button", { name: "New Plant" }).click();
    const form = page.locator(".k-form");
    const watered = form.locator(".k-form-field").filter({ has: page.getByLabel("Last Watered") });
    const interval = form.locator(".k-form-field").filter({ has: page.getByRole("spinbutton", { name: "Watering Interval Days" }) });
    const a = (await watered.boundingBox())!;
    const b = (await interval.boundingBox())!;
    expect(b.y).toBeGreaterThan(a.y + a.height - 1);
    expect(Math.abs(a.width - b.width)).toBeLessThan(2);
  });
});
