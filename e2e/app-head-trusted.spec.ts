import { test, expect } from "./console-guard";

// What the browser tab shows of an open app (DESIGN.md §8.5, #424): the app's name as the title and
// its own favicon — a circle of its colour with its initial — and Potyro's own back on the launcher.
// A person's own app wears no seal.

test("the tab carries the app's name and favicon while it is open, and Potyro's again after", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".k-launcher-home")).toBeVisible();
  const potyroTitle = await page.title();
  const potyroIcon = await page.locator('link[rel="icon"]').getAttribute("href");
  expect(potyroIcon).toBe("/favicon.svg");

  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await expect(page).toHaveTitle("Groceries");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /^data:image\/png;base64,/);
  // The circle of the app's colour with its initial: a real picture, not an empty canvas.
  const drawn = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href;
    const img = new Image();
    await new Promise((r) => {
      img.onload = r;
      img.src = href;
    });
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext("2d")!;
    x.drawImage(img, 0, 0);
    const centre = x.getImageData(Math.round(img.width / 2), Math.round(img.height / 2), 1, 1).data;
    const corner = x.getImageData(1, 1, 1, 1).data;
    return { size: img.width, centreAlpha: centre[3], cornerAlpha: corner[3] };
  });
  expect(drawn.size).toBe(64);
  expect(drawn.centreAlpha).toBe(255);
  expect(drawn.cornerAlpha).toBe(0);
  // One's own app: no seal.
  await expect(page.locator(".k-seal")).toHaveCount(0);

  await page.goto("/");
  await expect(page.locator(".k-launcher-home")).toBeVisible();
  await expect(page).toHaveTitle(potyroTitle);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
});
