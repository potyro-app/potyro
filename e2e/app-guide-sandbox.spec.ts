import { test, expect } from "./console-guard";
import { installShared } from "./realm.js";

// A shared app's guide (#80). The app runs sealed; its guide is data read out of the box, a
// stranger's words, and the shell draws them itself — as text, on its own page, never in the app's
// frame. Markup in a step is shown as the characters it is, and an address in one is not a link.

const MARKUP = `<img src=x onerror="window.__guideRan=1"><b>bold</b>`;
const STEPS = ["Tap “Add: Wine” to write down a bottle.", `${MARKUP} see https://example.com/more`];

const SOURCE = `import { defineApp } from "potyro";
export default defineApp({
  id: "cellar-shared", name: "Cellar", version: "1.0.0", schemaVersion: 1,
  guide: ${JSON.stringify(STEPS)},
  entities: {
    wine: { label: "Wine", displayField: "name", fields: { name: { type: "text", required: true, label: "Name" } } },
  },
  pages: [{ id: "wines", title: "Wines", view: { type: "list", entity: "wine", display: { primary: "name" } } }],
});
`;

test("a shared app's guide is shown by the shell, as text", async ({ page }) => {
  await installShared(page, "cellar-shared", "Cellar", SOURCE);

  // On the shell's page, not inside the sealed app's frame.
  const card = page.locator(".k-guide-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.locator(".k-guide-step")).toHaveText(STEPS);
  await expect(card.locator("img, b, a")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __guideRan?: number }).__guideRan)).toBeUndefined();

  await card.getByRole("button", { name: "Got it" }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Add: Wine" }).first()).toBeVisible({ timeout: 30_000 });
  await expect(card).toHaveCount(0);
});
