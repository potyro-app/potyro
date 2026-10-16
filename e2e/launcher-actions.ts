import type { Locator, Page } from "@playwright/test";

// A tile's actions live behind one "Actions for <app>" button since #77 (they used to be a
// hover-only row). Every spec that shares or syncs an app from the launcher goes through here,
// so the next change to the menu is one edit.
//
// Since the Start screen (#96) the home screen's tiles carry no buttons of their own: the menu
// button is on each app's row in All apps (and in the switcher, as before). `openTileMenu` goes
// there when the button is not on screen already.
//
// Not a `.spec.ts`, so Playwright does not collect it as a test file.

/**
 * `share` is the invite (use it together): Share opens a sheet since docs/24, and the invite is its
 * second way. `share-sheet` only opens the sheet.
 */
export type TileAction = "open" | "pin" | "edit-tile" | "history" | "sync" | "share" | "share-sheet" | "rename" | "duplicate" | "delete" | "data" | "files";

/** Click the app's "Actions for …" button, switching the home screen to All apps when it has to. */
export async function openTileMenu(root: Page | Locator, appName: string, opts: { exact?: boolean } = {}): Promise<void> {
  const button = root.getByRole("button", { name: `Actions for ${appName}`, exact: opts.exact });
  const all = root.getByRole("tab", { name: "All apps" });
  // Whichever shows first: the button (the switcher, or All apps already open), or the home screen's tab.
  await button.or(all).first().waitFor();
  if (!(await button.first().isVisible())) await all.click();
  await button.click();
}

/** Open the tile's menu and choose an action. `root` is the page, or the launcher overlay within it. */
export async function tileAction(root: Page | Locator, appName: string, action: TileAction): Promise<void> {
  await openTileMenu(root, appName);
  await root.getByRole("menu").locator(`[data-action="${action === "share-sheet" ? "share" : action}"]`).click();
  if (action === "share") await root.locator('[data-share="invite"]').click();
}
