import { test, expect } from "./console-guard";
import { tileAction } from "./launcher-actions.js";

// The gate, in a browser, on the path a real person takes.
//
// It runs two cojson nodes and two QuickJS isolates inside the page. Node tests prove the checks are
// right; only this proves they can run where they have to run — and that sharing an unsafe app tells
// you so before the link exists.

const UNSAFE = `import { defineApp } from "potyro";

export default defineApp({
  id: "gate-demo",
  name: "Gate Demo",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      label: "Item",
      icon: "x",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        bought: { type: "number" },
      },
      actions: {
        bump: async (record, ctx) => {
          await ctx.patch("item", record.id, { bought: Number(record.bought ?? 0) + 1 });
        },
      },
    },
  },
  pages: [
    { id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "title" } } },
  ],
});
`;

test("sharing an app that loses concurrent edits says so first", async ({ page }) => {
  test.slow();
  await page.addInitScript(
    ([source]) => {
      localStorage.setItem("potyro:sync:relay", "ws://localhost:4201");
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([{ id: "gate-demo", name: "Gate Demo", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    [UNSAFE] as const,
  );

  await page.goto("/?user=gate-demo");
  await expect(page.locator("h1").first()).toHaveText("Gate Demo", { timeout: 30_000 });

  await page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(page, "Gate Demo", "share");
  // "Share turns on sync" first.
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();

  // THE ASSERTION: the hazard is named, in words, before a link exists — and it names the field.
  const warning = page.locator(".k-dialog", { hasText: "lose each other's work" });
  await expect(warning).toBeVisible({ timeout: 90_000 });
  await expect(warning).toContainText("item.bump");
  await expect(warning).toContainText("bought");
  await expect(warning).toContainText("silently discarded");

  // Declining leaves the app unshared — the warning is a real decision point, not a notice.
  await warning.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".k-dialog")).toHaveCount(0);
});
