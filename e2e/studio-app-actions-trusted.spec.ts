import { test, expect, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";

// Managing an app from inside the Studio, and calling it what you called it.
//
// Three things reported together:
//   "you need to add a confirmation to the deletion of an app on studio with a strong warning:
//    this will delete the app and its data. right now if I click on the X the app is simply
//    deleted!"
//   "we need to have a way inside the studio to duplicate an app or rename it, not just via menu."
//   "I renamed a copy of Groceries to Todo and it still shows at the Top 'Groceries'."
//
// The last one is three names that were never agreed: the one written in the app's source, the one
// on your saved copy (Rename), and the one on the launcher tile (Edit tile). The top bar read the
// source's, so a renamed app went on calling itself by the name the model gave it.

const APP = `import { defineApp } from "karta";

export default defineApp({
  id: "notes",
  name: "Notes",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    note: { label: "Note", displayField: "title", fields: { title: { type: "text", required: true } } },
  },
  pages: [
    { id: "all", title: "All", view: { type: "list", entity: "note", display: { primary: "title" } } },
  ],
});
`;

async function seedApp(page: Page): Promise<void> {
  await page.addInitScript(
    (source) => {
      // Once. `addInitScript` runs on EVERY navigation, so without this guard a reload puts the
      // original name back and a rename looks like it did not survive — which is exactly the
      // phantom bug this spec nearly reported.
      if (localStorage.getItem("karta:user-apps")) return;
      localStorage.setItem(
        "karta:user-apps",
        JSON.stringify([{ id: "notes", name: "Notes", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    APP,
  );
}

const studio = (page: Page) => page.locator(".k-studio");
const openStudio = async (page: Page): Promise<void> => {
  await page.goto("/?user=notes");
  await expect(page.locator("h1").first()).toHaveText("Notes", { timeout: 30_000 });
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(studio(page)).toBeVisible();
};

test("deleting an app from the Studio asks first, and says the data goes too", async ({ page }) => {
  await seedApp(page);
  await openStudio(page);

  await studio(page).getByRole("button", { name: "Delete Notes" }).click();

  // The question, and what it costs. It used to delete on the click, with nothing said.
  const dialog = page.locator(".k-dialog");
  await expect(dialog).toContainText("Delete “Notes” and everything in it?");
  await expect(dialog).toContainText("deletes the app AND its data");

  // Backing out keeps it.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(studio(page).getByRole("button", { name: "Delete Notes" })).toBeVisible();

  // Going through with it does not.
  await studio(page).getByRole("button", { name: "Delete Notes" }).click();
  await page.locator(".k-dialog").getByRole("button", { name: "Delete" }).click();
  await expect(studio(page).getByRole("button", { name: "Delete Notes" })).toHaveCount(0);
});

test("an app can be renamed and duplicated from the Studio", async ({ page }) => {
  await seedApp(page);
  await openStudio(page);

  // Duplicate opens the copy — in here a copy is something you made in order to change it.
  await studio(page).getByRole("button", { name: "Duplicate Notes" }).click();
  await expect(studio(page).getByRole("button", { name: "Delete Notes (copy)" })).toBeVisible({ timeout: 30_000 });

  await studio(page).getByRole("button", { name: "Rename Notes (copy)" }).click();
  const dialog = page.locator(".k-dialog");
  await expect(dialog).toContainText("Rename app");
  await dialog.locator("input").fill("Todo");
  await dialog.getByRole("button", { name: /^(Confirm|OK|Save)$/ }).first().click();

  await expect(studio(page).getByRole("button", { name: "Delete Todo" })).toBeVisible({ timeout: 30_000 });
  // And the original is untouched.
  await expect(studio(page).getByRole("button", { name: "Delete Notes" })).toBeVisible();
});

test("a renamed app is called what you called it, not what its source says", async ({ page }) => {
  await seedApp(page);
  await page.goto("/?user=notes");
  await expect(page.locator("h1").first()).toHaveText("Notes", { timeout: 30_000 });

  await page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(page, "Notes", "rename");
  const dialog = page.locator(".k-dialog");
  await dialog.locator("input").fill("Todo");
  await dialog.getByRole("button", { name: /^(Confirm|OK|Save)$/ }).first().click();

  // The app's source still says `name: "Notes"` — renaming keeps the id, the source and the data.
  // What changes is what it is called, and that has to include the top of the app itself.
  await page.goto("/?user=notes");
  await expect(page.locator("h1").first()).toHaveText("Todo", { timeout: 30_000 });
});
