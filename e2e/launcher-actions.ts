import type { Page } from "@playwright/test";

// A tile's actions live behind one "Actions for <app>" button since #77 (they used to be a
// hover-only row). Every spec that shares or syncs an app from the launcher goes through here,
// so the next change to the menu is one edit.
//
// Not a `.spec.ts`, so Playwright does not collect it as a test file.

export type TileAction = "open" | "history" | "sync" | "share" | "rename" | "delete";

/** Open the tile's menu and choose an action. `page` may be any page-like locator root. */
export async function tileAction(page: Page, appName: string, action: TileAction): Promise<void> {
  await page.getByRole("button", { name: `Actions for ${appName}` }).click();
  await page.getByRole("menu").locator(`[data-action="${action}"]`).click();
}
