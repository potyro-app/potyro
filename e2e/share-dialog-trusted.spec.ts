import { test, expect, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";

// The share dialog (#79). It used to copy the link silently before opening, swallow the failure,
// and offer a generic prompt with an OK button. Now: the link read-only, a Copy button that says
// whether it worked, and — when it did not — the link left selected for copying by hand.

const STARTER = `import { defineApp } from "potyro";
export default defineApp({
  id: "sharedlg", name: "Share Dialog", version: "1.0.0", schemaVersion: 1,
  entities: { item: { label: "Item", icon: "x", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "title" } } }],
});
`;

async function openLauncher(page: Page, initScript?: () => void): Promise<void> {
  await page.addInitScript(
    ([source]) => {
      localStorage.setItem("potyro:sync:relay", "ws://localhost:4201");
      if (localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([{ id: "sharedlg", name: "Share Dialog", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    [STARTER] as const,
  );
  if (initScript) await page.addInitScript(initScript);
  await page.goto("/?user=sharedlg");
  await expect(page.locator("h1").first()).toHaveText("Share Dialog", { timeout: 30_000 });
  await page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
}

/** Share from the launcher, through "turn sync on" and the name question, to the link dialog. */
async function reachShareDialog(page: Page): Promise<void> {
  await tileAction(page, "Share Dialog", "share");
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click(); // turns sync on
  const nameDialog = page.locator(".k-dialog", { hasText: "see you as" });
  const shareDialog = page.locator(".k-share-dialog");
  await expect(nameDialog.or(shareDialog).first()).toBeVisible({ timeout: 60_000 });
  if (await nameDialog.count()) {
    await nameDialog.locator("input").fill("Vasco");
    await nameDialog.getByRole("button", { name: "OK" }).click();
  }
  await expect(shareDialog).toBeVisible({ timeout: 60_000 });
  await expect(shareDialog.getByRole("textbox", { name: "Share link" })).toHaveValue(/#join=/);
}

test("Copy puts the link on the clipboard and says so", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openLauncher(page);
  await reachShareDialog(page);

  const dialog = page.locator(".k-share-dialog");
  await expect(dialog).toContainText("Whoever opens it joins your app and its data");
  const link = await dialog.getByRole("textbox", { name: "Share link" }).inputValue();
  // Nothing is claimed before Copy is pressed.
  await expect(dialog.getByRole("status")).toHaveText("");

  await dialog.getByRole("button", { name: "Copy link" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
});

test("a refused clipboard is reported, and the link is left selected", async ({ page }) => {
  await openLauncher(page, () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
      configurable: true,
    });
  });
  await reachShareDialog(page);

  const dialog = page.locator(".k-share-dialog");
  await dialog.getByRole("button", { name: "Copy link" }).click();
  await expect(dialog.getByRole("status")).toContainText("Couldn't copy");

  const field = dialog.getByRole("textbox", { name: "Share link" });
  await expect(field).toBeFocused();
  const selected = await field.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0));
  expect(selected).toMatch(/#join=/);
});
