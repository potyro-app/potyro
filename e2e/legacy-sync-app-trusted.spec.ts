import { test, expect } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";

// A synced app created BEFORE the cojson database was renamed must still open (regression).
//
// The rename from `${appId}-jazz` to a device-global `karta-jazz` fixed the second synced app, and
// shipped without a migration. Every space that already existed was orphaned — its group and root
// CoValues are in the old file — and the store's guard refused to continue, correctly:
//
//   group co_z… for "user:city-places" is unavailable. Its storage is missing or unreadable;
//   refusing to silently create a new space and strand the existing data.
//
// Reproducing that needs the pre-move state exactly: records in the per-app file, a saved group id,
// and NO database marker. It is built here rather than mocked — the marker is forced to the legacy
// name so the data is genuinely written there, then deleted, which is precisely what a device
// upgrading from the old build looks like.

const STARTER = `import { defineApp } from "potyro";

export default defineApp({
  id: "legacy-app",
  name: "Legacy App",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    place: {
      label: "Place",
      icon: "📍",
      displayField: "name",
      fields: { name: { type: "text", required: true } },
    },
  },
  pages: [
    { id: "all", title: "Places", view: { type: "list", entity: "place", display: { primary: "name" } } },
  ],
});
`;

test("a synced app created before the database rename still opens", async ({ page }) => {
  test.slow();

  await page.addInitScript(
    ([source]) => {
      if (localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([
          { id: "legacy-app", name: "Legacy App", source, trusted: true, updatedAt: new Date().toISOString() },
        ]),
      );
      // Force this app's space into the LEGACY per-app file, as the old build did.
      localStorage.setItem("potyro:jazz:db:user:legacy-app", "user:legacy-app-jazz");
    },
    [STARTER],
  );

  // ---- build the old world: turn sync on, so the space and a record land in the legacy file ----
  await page.goto("/?user=legacy-app");
  await expect(page.locator("h1").first()).toHaveText("Legacy App", { timeout: 30_000 });

  await page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(page, "Legacy App", "sync");
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".k-dialog")).toContainText("Moved", { timeout: 30_000 });
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await page.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();

  await page.goto("/?user=legacy-app");
  await expect(page.locator(".k-sync-status")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Add: Place|Add Place/i }).first().click();
  await page.getByLabel(/name/i).fill("Rua Augusta");
  await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(page.locator(".k-list-row", { hasText: "Rua Augusta" })).toBeVisible();

  // ---- now become a device that has just upgraded ----
  //
  // Delete the marker. The group id and the records stay exactly where the old build left them, so
  // the app is now indistinguishable from one created before the rename ever happened.
  const before = await page.evaluate(() => ({
    group: localStorage.getItem("potyro:jazz:group:user:legacy-app"),
    account: localStorage.getItem("potyro:identity:id"),
  }));
  expect(before.group).toBeTruthy();

  await page.evaluate(() => localStorage.removeItem("potyro:jazz:db:user:legacy-app"));

  // ---- THE POINT: it opens, on the old data, as the same person ----
  await page.goto("/?user=legacy-app");
  await expect(page.locator("h1").first()).toHaveText("Legacy App", { timeout: 30_000 });
  await expect(page.locator(".k-list-row", { hasText: "Rua Augusta" })).toBeVisible({ timeout: 30_000 });

  // Not a fresh empty space wearing the same name: same group, same account.
  const after = await page.evaluate(() => ({
    group: localStorage.getItem("potyro:jazz:group:user:legacy-app"),
    account: localStorage.getItem("potyro:identity:id"),
    db: localStorage.getItem("potyro:jazz:db:user:legacy-app"),
  }));
  expect(after.group).toBe(before.group);
  expect(after.account).toBe(before.account);
  // And the choice is now recorded, so it cannot drift again.
  expect(after.db).toBe("user:legacy-app-jazz");
});
