import { test, expect } from "@playwright/test";
import { openSource } from "./studio-helpers.js";

// Studio, opened from inside an app, is about THAT app (reported 2026-09-13).
//
// The in-app tool reads "Studio — change this app", but the Studio was never told which app it
// came from, so it opened on the blank starter as "new app". And the chrome change (#111) scoped the
// tab styles to the tab bar and the sidebar, which left the Studio's tabs as bare browser buttons.

test.use({ viewport: { width: 1440, height: 900 } });

test("Studio opened from an app opens that app, not the starter", async ({ page }) => {
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await page.locator(".k-tools").getByRole("button", { name: "Studio" }).click();

  const studio = page.locator(".k-studio");
  await expect(studio).toBeVisible();
  // The header names the app, and it is the one whose sidebar the Studio was opened from.
  await expect(studio.locator(".k-studio-name")).toHaveText("Groceries", { timeout: 60_000 });
  await expect(studio.getByText("New app", { exact: true })).toHaveCount(0);
  // Wide enough for both: the app is open beside the conversation, and it is that app running.
  await expect(studio.locator(".k-studio-preview h1").first()).toHaveText("Groceries", { timeout: 60_000 });
  // And its source is that app's source.
  const tools = await openSource(page, studio);
  await expect(tools.getByRole("textbox", { name: "App source" })).toHaveValue(/id: "groceries"/);
});

test("the code sheet's tabs are styled tabs, not bare browser buttons", async ({ page }) => {
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await page.locator(".k-tools").getByRole("button", { name: "Studio" }).click();
  await openSource(page, page.locator(".k-studio"));
  const tabs = page.locator(".k-studio-tabs");
  await expect(tabs).toBeVisible();

  const look = (name: string) =>
    tabs.getByRole("tab", { name }).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, borderTop: cs.borderTopWidth, underline: cs.borderBottomWidth, underlineColor: cs.borderBottomColor };
    });

  const source = await look("Source");
  const history = await look("History");
  // No button chrome: no fill and no box border, which is what the browser's default draws.
  expect(source.bg).toBe("rgba(0, 0, 0, 0)");
  expect(history.bg).toBe("rgba(0, 0, 0, 0)");
  expect(source.borderTop).toBe("0px");
  // The selected tab is underlined; the others carry a transparent underline of the same width.
  expect(source.underline).toBe("2px");
  expect(source.underlineColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(history.underlineColor).toBe("rgba(0, 0, 0, 0)");
});
