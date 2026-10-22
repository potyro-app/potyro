import { test, expect } from "./console-guard";

// The landing page's prompt box (potyro.com, DESIGN.md §9: "the product is the demonstration") sends
// what was typed to potyro.app as `?new=…`, and the Studio opens on it.
test("?new= opens the Studio on the words, and leaves the address clean", async ({ page }) => {
  await page.goto("/?new=" + encodeURIComponent("a shopping list for the house, split by store"));
  const box = page.locator(".k-studio").getByRole("textbox", { name: "Describe the app" });
  await expect(box).toBeVisible({ timeout: 30_000 });
  await expect(box).toHaveValue("a shopping list for the house, split by store");
  expect(new URL(page.url()).searchParams.has("new")).toBe(false);
});

test("an empty ?new= opens the Studio with nothing in the box", async ({ page }) => {
  await page.goto("/?new=");
  const box = page.locator(".k-studio").getByRole("textbox", { name: "Describe the app" });
  await expect(box).toBeVisible({ timeout: 30_000 });
  await expect(box).toHaveValue("");
});
