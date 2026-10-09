import { test, expect } from "@playwright/test";

// Text shared into Potyro from another app (#213). The Android share sheet puts it in the session's
// share inbox (share-target.ts → rememberShare) and opens "Bring this into…"; here the inbox is
// filled the same way and the page opened by its URL, since a browser has no share sheet to drive.
// The best fit comes first; picking an app opens its Ask with the shared text filled in.

const PLAN = `Here's a Push/Pull/Legs split:
Push — Bench Press 4×6–8, rest 2–3 min; Overhead Press 3×8.
Pull — Deadlift 3×5, Pull-ups 4×8.
Legs — Squat 4×6, Leg curl 3×12.`;

test("a shared plan is offered to the app it fits, and opens that app's Ask filled in", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".k-launch-tile").first()).toBeVisible();
  await page.evaluate((text) => sessionStorage.setItem("potyro:pending-share", JSON.stringify({ text })), PLAN);
  await page.goto("/?share");

  await expect(page.getByRole("heading", { name: "Bring this into…" })).toBeVisible();
  await expect(page.locator(".k-share-preview")).toContainText("Bench Press 4×6–8");
  const first = page.locator(".k-share-app").first();
  await expect(first).toContainText("PPL Log");
  await expect(first).toContainText("Best fit");

  await first.click();
  const dialog = page.getByRole("dialog", { name: /^Ask PPL Log/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "What another AI made" })).toHaveValue(PLAN);
  // Handed over once: reopening the app does not bring it back.
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.reload();
  await expect(page.locator("h1").first()).toHaveText("PPL Log");
  await expect(page.getByRole("dialog", { name: /^Ask PPL Log/ })).toHaveCount(0);
});

test("“Don’t add it” drops the share", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".k-launch-tile").first()).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("potyro:pending-share", JSON.stringify({ text: "anything" })));
  await page.goto("/?share");
  await page.getByRole("button", { name: "Don’t add it" }).click();
  await expect(page.locator(".k-launch-tile").first()).toBeVisible();
  await page.goto("/?share");
  await expect(page.getByRole("heading", { name: "Nothing to bring in" })).toBeVisible();
});
