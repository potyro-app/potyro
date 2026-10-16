import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "./console-guard";
import { tileAction } from "./launcher-actions.js";
import { PORTS } from "./ports";

// "Load your apps?" kept coming back (the owner, on apps.vaz.io): after deleting shared apps it was
// offered again on every boot, "Not now" did not stick, and with every app unticked the button still
// read "Load 0 apps", looked ready, and did nothing.
//
// One browser is enough: its apps are on the account (one switch puts them there), and an app the
// account lists that this device does not have is exactly what the offer is for.

const RELAY = `ws://localhost:${process.env.POTYRO_RELAY_PORT ?? PORTS.relay}`;

const source = (id: string, name: string): string => `import { defineApp } from "potyro";
export default defineApp({
  id: "${id}", name: "${name}", icon: "📝", version: "1.0.0", schemaVersion: 1,
  entities: { note: { label: "Note", icon: "📝", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "${name}", view: { type: "list", entity: "note", display: { primary: "title" } } }],
});
`;

const APPS = [
  { id: "notes", name: "Notes" },
  { id: "jots", name: "Jots" },
  { id: "keep", name: "Keep" },
].map((a) => ({ ...a, source: source(a.id, a.name), trusted: true, updatedAt: new Date().toISOString() }));

// The examples are left out, so backing up moves three small apps rather than every example.
const EXAMPLES = readdirSync(fileURLToPath(new URL("../examples", import.meta.url)))
  .map((f) => /^([a-z0-9-]+)\.app\.tsx?$/.exec(f)?.[1])
  .filter((id): id is string => Boolean(id));

const OFFERED = "potyro:account:offered";

/**
 * Reload, and wait until this boot has read the account and decided: `offered` is written right
 * after the read, and the panel (when there is one) follows within a moment of it.
 */
async function bootAndReadAccount(page: Page): Promise<void> {
  await page.evaluate((key) => localStorage.removeItem(key), OFFERED);
  await page.goto("/");
  await expect(page.locator(".k-launcher-home")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), OFFERED), { timeout: 30_000 }).toBe("1");
}

/** Nothing offered: watched for long enough that a panel on its way would have arrived. */
async function expectNoOffer(page: Page): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await expect(page.locator(".k-restore")).toHaveCount(0);
    await page.waitForTimeout(500);
  }
}

test("the restore prompt does not come back for deleted apps or after Not now, and cannot load nothing", async ({ browser }) => {
  test.slow();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(
    ([relay, apps, examples]) => {
      localStorage.setItem("potyro:sync:relay", relay);
      if (localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem("potyro:user-apps", JSON.stringify(apps));
      localStorage.setItem("potyro:examples:seeded", JSON.stringify(examples));
    },
    [RELAY, APPS, EXAMPLES] as const,
  );
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator(".k-launcher-home")).toBeVisible({ timeout: 30_000 });

  // ---- Every app onto the account ----
  await page.getByRole("button", { name: "You and your devices" }).click();
  const backup = page.locator(".k-backup");
  await backup.getByRole("button", { name: "Back up my apps" }).click();
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(backup).toContainText(/Moved 3 apps/, { timeout: 120_000 });
  await page.keyboard.press("Escape");
  await bootAndReadAccount(page);
  await expectNoOffer(page);

  // ---- (a) Leave a shared app: it is not offered back ----
  await tileAction(page, "Notes", "delete");
  await page.locator(".k-dialog").getByRole("button", { name: "Leave" }).click();
  await expect(page.locator(".k-launch-tile", { hasText: "Notes" })).toHaveCount(0);
  await bootAndReadAccount(page);
  await expectNoOffer(page);

  // ---- An app on the account that this device does not have: offered ----
  // As if it had been made on another of your devices: here it is simply not in the registry.
  await page.evaluate(() => {
    const apps = JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as Array<{ id: string }>;
    localStorage.setItem("potyro:user-apps", JSON.stringify(apps.filter((a) => a.id !== "jots")));
  });
  await bootAndReadAccount(page);
  const offer = page.locator(".k-restore");
  await expect(offer).toBeVisible({ timeout: 30_000 });
  await expect(offer).toContainText("Jots");
  await expect(offer).not.toContainText("Notes");

  // ---- (c) Nothing ticked: the button says so and cannot be pressed ----
  for (const box of await offer.getByRole("checkbox").all()) await box.uncheck();
  await expect(offer.getByRole("button", { name: /Load 0/ })).toHaveCount(0);
  await expect(offer.getByRole("button", { name: "Nothing to load" })).toBeDisabled();

  // ---- (b) Not now sticks ----
  await offer.getByRole("button", { name: "Not now" }).click();
  await expect(offer).toHaveCount(0);
  await bootAndReadAccount(page);
  await expectNoOffer(page);

  await ctx.close();
});
