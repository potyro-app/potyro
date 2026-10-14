import type { Locator, Page } from "@playwright/test";

// A tile's actions live behind one "Actions for <app>" button since #77 (they used to be a
// hover-only row). Every spec that shares or syncs an app from the launcher goes through here,
// so the next change to the menu is one edit.
//
// Not a `.spec.ts`, so Playwright does not collect it as a test file.

/**
 * `share` is the invite (use it together): Share opens a sheet since docs/24, and the invite is its
 * second way. `share-sheet` only opens the sheet.
 */
export type TileAction = "open" | "pin" | "edit-tile" | "history" | "sync" | "share" | "share-sheet" | "rename" | "duplicate" | "delete" | "data" | "files";

/** Open the tile's menu and choose an action. `root` is the page, or the launcher overlay within it. */
export async function tileAction(root: Page | Locator, appName: string, action: TileAction): Promise<void> {
  await root.getByRole("button", { name: `Actions for ${appName}` }).click();
  await root.getByRole("menu").locator(`[data-action="${action === "share-sheet" ? "share" : action}"]`).click();
  if (action === "share") await root.locator('[data-share="invite"]').click();
}
