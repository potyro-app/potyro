import { test, expect } from "./console-guard";
import { openBoard } from "./board-fixture.js";

// The board renders sealed (#107): the tasks app runs in its box, its `sort` and display bindings
// cross back as values, and a move is still a host-side patch.

test("a board runs sealed: columns, cards, and Move to…", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBoard(page, false);
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");

  const todo = page.locator('.k-board-col[data-board-column="to do"]');
  await expect(todo.locator(".k-board-card", { hasText: "Paint the fence" })).toBeVisible({ timeout: 30_000 });
  // The secondary line is a function binding, so it came back from the box.
  await expect(todo.locator(".k-board-card", { hasText: "Paint the fence" }).locator(".k-secondary")).toContainText("4 h of work");

  await todo.getByRole("button", { name: "Paint the fence: more" }).click();
  await page.getByRole("menuitem", { name: /Move to doing/ }).click();
  await expect(page.locator('.k-board-col[data-board-column="doing"]').locator(".k-board-card", { hasText: "Paint the fence" })).toBeVisible();
});
