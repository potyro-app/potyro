import { test, expect, type Page } from "@playwright/test";

// The photo field (#102). Plants' "Photo" is a tile that says "Add photo", not the browser's
// "Choose File | No file chosen". Pick an image and the tile shows it with a way to take it off
// again; the record page shows the same tile. Nothing visible in the form is a file input.

const PNG = Buffer.from(
  // 1×1 green PNG
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function openApp(page: Page, app: string, title: string): Promise<void> {
  await page.goto(`/?user=${app}`);
  await expect(page.locator("h1").first()).toHaveText(title, { timeout: 30_000 });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a photo field is a tile: add, see it, remove it, and it shows the same on the record", async ({ page }) => {
    await openApp(page, "plants", "Plants");
    await page.getByRole("button", { name: "New Plant" }).click();
    const form = page.locator(".k-form");
    await expect(form).toBeVisible();

    // The tile, and no file button in sight.
    const add = form.getByRole("button", { name: "Photo: add photo" });
    await expect(add).toBeVisible();
    await expect(form.locator("input[type=file]:visible")).toHaveCount(0);

    // Choosing a file fills the tile with the image itself.
    await form.locator("input[type=file]").setInputFiles({ name: "leaf.png", mimeType: "image/png", buffer: PNG });
    const tile = form.locator(".k-media-tile");
    await expect(tile).toBeVisible();
    await expect(tile.locator("img")).toHaveAttribute("src", /^blob:|^data:/);
    await expect(add).toHaveCount(0);

    // It can be taken off again.
    await form.getByRole("button", { name: "Remove photo" }).click();
    await expect(form.locator(".k-media-tile")).toHaveCount(0);
    await expect(add).toBeVisible();

    // Put it back, save, and the record page shows the same tile.
    await form.locator("input[type=file]").setInputFiles({ name: "leaf.png", mimeType: "image/png", buffer: PNG });
    await expect(form.locator(".k-media-tile img")).toBeVisible();
    await form.getByRole("textbox", { name: "Name" }).fill("E2E Photo Plant");
    await form.getByRole("button", { name: "Create" }).click();
    const detail = page.locator("article.k-detail");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".k-media-tile img")).toBeVisible();
    // Read-only there: nothing to remove from a record you are reading.
    await expect(detail.locator(".k-media-x")).toHaveCount(0);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("the tile offers the camera or the library", async ({ page }) => {
    await openApp(page, "plants", "Plants");
    await page.getByRole("button", { name: "New Plant" }).tap();
    const form = page.locator(".k-form");
    await form.getByRole("button", { name: "Photo: add photo" }).tap();
    // A phone with a camera gets the choice, as a sheet under the thumb.
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveText([/Take a photo/, /Choose from library/]);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });
});
