import { test, expect, type Page } from "./console-guard";
import { tileAction } from "./launcher-actions.js";

// Asking before a sandboxed app's data leaves this device (KA-23, #64).
//
// An app someone else wrote runs in the isolate because its code is not yours to vouch for. Sharing
// it lets that code write into a document other people receive — the same kind of power as
// `ctx.caps.network`, and asked about the same way. A browser drives it because the answer decides
// which STORE opens on the next boot, which no unit test can see.

const SOURCE = (permissions?: string) => `import { defineApp } from "potyro";
export default defineApp({
  id: "trip", name: "Trip Costs", version: "1.0.0", schemaVersion: 1,${permissions ? `\n  permissions: ${permissions},` : ""}
  entities: { expense: { label: "Expense", icon: "💶", displayField: "description", fields: { description: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Expenses", view: { type: "list", entity: "expense", display: { primary: "description" } } }],
});
`;

async function seed(page: Page, opts: { trusted: boolean; permissions?: string }): Promise<void> {
  await page.addInitScript(
    ([source, trusted]) => {
      localStorage.setItem("potyro:sync:relay", "ws://localhost:4201");
      if (localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([{ id: "trip", name: "Trip Costs", source, trusted, updatedAt: new Date().toISOString() }]),
      );
    },
    [SOURCE(opts.permissions), opts.trusted] as const,
  );
}

const synced = (page: Page) => page.evaluate(() => {
  const apps = JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as { id: string; sync?: boolean }[];
  return Boolean(apps.find((a) => a.id === "trip")?.sync);
});

const openTile = async (page: Page, action: "share" | "sync") => {
  await page.goto("/");
  await expect(page.getByText("Trip Costs").first()).toBeVisible({ timeout: 30_000 });
  await tileAction(page, "Trip Costs", action);
};

test("a sandboxed app that never asked to sync is warned about, and 'Don't share' leaves it local-only", async ({ page }) => {
  test.slow();
  await seed(page, { trusted: false });
  await openTile(page, "share");

  const ask = page.locator(".k-dialog", { hasText: "never asked to sync" });
  await expect(ask).toBeVisible({ timeout: 30_000 });
  await expect(ask).toContainText("leaves this device");
  await ask.getByRole("button", { name: "Don't share" }).click();

  // Nothing was turned on, and the app still opens — local-only is the point, not a failure.
  expect(await synced(page)).toBe(false);
  await page.goto("/?user=trip");
  await expect(page.locator("h1").first()).toHaveText("Trip Costs", { timeout: 30_000 });
  await expect(page.locator(".k-sync-status")).toHaveCount(0);
});

test("a sandboxed app that asks to sync says so, and sharing proceeds once allowed", async ({ page }) => {
  test.slow();
  await seed(page, { trusted: false, permissions: "{ sync: true }" });
  await openTile(page, "share");

  const ask = page.locator(".k-dialog", { hasText: "runs in the sealed box" });
  await expect(ask).toBeVisible({ timeout: 30_000 });
  await expect(ask).toContainText("The app asks for this");
  await ask.getByRole("button", { name: "Share" }).click();

  // The ordinary share flow continues from here.
  await expect(page.locator(".k-dialog", { hasText: "This turns on sync" })).toBeVisible({ timeout: 30_000 });
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await expect.poll(() => synced(page), { timeout: 60_000 }).toBe(true);
});

test("your own app is never asked about", async ({ page }) => {
  test.slow();
  await seed(page, { trusted: true });
  await openTile(page, "share");
  // Straight to the ordinary share question — no permission dialog in front of it.
  await expect(page.locator(".k-dialog", { hasText: "This turns on sync" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".k-dialog", { hasText: "sealed box" })).toHaveCount(0);
});
