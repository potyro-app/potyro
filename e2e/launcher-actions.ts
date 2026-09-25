import type { Locator, Page } from "@playwright/test";

// A tile's actions live behind one "Actions for <app>" button since #77 (they used to be a
// hover-only row). Every spec that shares or syncs an app from the launcher goes through here,
// so the next change to the menu is one edit.
//
// Not a `.spec.ts`, so Playwright does not collect it as a test file.

export type TileAction = "open" | "pin" | "edit-tile" | "history" | "sync" | "share" | "rename" | "duplicate" | "delete" | "data";

/** Open the tile's menu and choose an action. `root` is the page, or the launcher overlay within it. */
export async function tileAction(root: Page | Locator, appName: string, action: TileAction): Promise<void> {
  await root.getByRole("button", { name: `Actions for ${appName}` }).click();
  await root.getByRole("menu").locator(`[data-action="${action}"]`).click();
}
