import { test, expect } from "./console-guard";
import { addAsMine, packApp } from "./library-demos";

// apps/markdown-notes, packed as its build packs it — with the four notes it ships with and the seed
// that points at them (#389): the app opens on notes, as files in its own folder, rendered from
// their markdown. What is checked is the rendered note, not that a file arrived.

test("Notes comes with four sample notes, files in its folder, rendered from markdown", async ({ page }) => {
  await addAsMine(page, "markdown-notes.potyro-app.zip", packApp("markdown-notes", "notes.app.tsx", ["--files", "files", "--seed", "seed.json"]));
  const rows = page.getByRole("main").locator(".k-list-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: "Welcome to Notes" })).toContainText("welcome-to-notes.md");

  await rows.filter({ hasText: "Sourdough" }).click();
  await expect(page.getByRole("heading", { name: "Sourdough, the short version" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ingredients" })).toBeVisible();
  await expect(page.getByText("100 g active starter")).toBeVisible();
  await expect(page.getByRole("list").filter({ hasText: "stretch and fold" })).toBeVisible();
});
