import { test, expect } from "./console-guard";

// The Data page's Files tab (owner, 2026-10-24): a long list of files scrolls inside the page, and
// never grows over the tabs above it — on a desktop and, worse before, on a phone. Places ships 19.

for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
  test(`${label}: a long Files list scrolls, and the tabs stay whole above it`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?data=places&files");
    const list = page.locator(".k-datapage .k-files-list");
    await expect(list.locator(".k-files-row").first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => list.locator(".k-files-row").count(), { timeout: 15_000 }).toBeGreaterThan(12);

    const tabs = page.locator(".k-data-tabs");
    const tabsBox = (await tabs.boundingBox())!;
    const listBox = (await list.boundingBox())!;
    // The tabs keep their height (a word and its underline) and the list starts below them.
    expect(tabsBox.height).toBeGreaterThanOrEqual(30);
    expect(listBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height - 1);

    // The last file can be reached, and it lies inside the window once scrolled to.
    const last = list.locator(".k-files-row").last();
    await last.scrollIntoViewIfNeeded();
    const lastBox = (await last.boundingBox())!;
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(viewport.height + 1);
    await expect(last).toBeInViewport();
  });
}
