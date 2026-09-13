import { test, expect } from "@playwright/test";

// Studio, opened from inside an app, is about THAT app (reported 2026-09-13).
//
// The in-app tool reads "Studio — change this app", but the Studio was never told which app it
// came from, so it opened on the blank starter as "new app". And the chrome change (#111) scoped the
// tab styles to the tab bar and the sidebar, which left the Studio's Preview / Source / History as
// bare browser buttons.

test.use({ viewport: { width: 1440, height: 900 } });

test("Studio opened from an app opens that app, not the starter", async ({ page }) => {
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await page.locator(".k-tools").getByRole("button", { name: "Studio" }).click();

  const studio = page.locator(".k-studio");
  await expect(studio).toBeVisible();
  // The header names the app, and it is the one whose sidebar the Studio was opened from.
  await expect(studio.locator(".k-studio-bar")).toContainText("· Groceries", { timeout: 60_000 });
  await expect(studio.getByText("· new app")).toHaveCount(0);
  // The preview is that app running, not the starter's "My App".
  await expect(studio.locator(".k-studio-building")).toHaveCount(0, { timeout: 60_000 });
  await expect(studio.getByText("My App", { exact: true })).toHaveCount(0);
  // And its source is that app's source.
  await studio.getByRole("tab", { name: "Source" }).click();
  await expect(studio.getByRole("textbox", { name: "App source" })).toHaveValue(/id: "groceries"/);
});

test("the Studio's tabs are styled tabs, not bare browser buttons", async ({ page }) => {
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await page.locator(".k-tools").getByRole("button", { name: "Studio" }).click();
  const tabs = page.locator(".k-studio-tabs");
  await expect(tabs).toBeVisible();

  const look = (name: string) =>
    tabs.getByRole("tab", { name }).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, borderTop: cs.borderTopWidth, underline: cs.borderBottomWidth, underlineColor: cs.borderBottomColor };
    });

  const preview = await look("Preview");
  const source = await look("Source");
  // No button chrome: no fill and no box border, which is what the browser's default draws.
  expect(preview.bg).toBe("rgba(0, 0, 0, 0)");
  expect(source.bg).toBe("rgba(0, 0, 0, 0)");
  expect(preview.borderTop).toBe("0px");
  // The selected tab is underlined; the others carry a transparent underline of the same width.
  expect(preview.underline).toBe("2px");
  expect(preview.underlineColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(source.underlineColor).toBe("rgba(0, 0, 0, 0)");
});
