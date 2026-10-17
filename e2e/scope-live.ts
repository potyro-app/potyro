import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type FrameLocator, type Page } from "@playwright/test";

// The journey of scope-live-{trusted,sandbox}.spec.ts: the selected record is edited while it stays
// selected, and everything that reads `ctx.scope` — the shell's chip, a page title worked out by the
// app's logic, the app's own screen — says the new one, with no reselect (docs/04 §Scope).

export const LIVE_SCOPE_SOURCE = readFileSync(fileURLToPath(new URL("./fixtures/live-scope.app.tsx", import.meta.url)), "utf8");

export async function seedLiveScope(page: Page, trusted: boolean): Promise<void> {
  await page.addInitScript(
    ([source, isTrusted]) => {
      if (localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "live-trips", name: "Live trips", source, trusted: isTrusted, updatedAt: new Date(0).toISOString() }]));
    },
    [LIVE_SCOPE_SOURCE, trusted] as const,
  );
  await page.goto("/?user=live-trips");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", trusted ? "trusted" : "untrusted", { timeout: 30_000 });
}

/** The app's own screen: the page itself, or — sealed — its frame. */
export async function liveScopeJourney(page: Page, view: Page | FrameLocator, shots?: string, name = "scope-live"): Promise<void> {
  const chip = page.locator(".k-scope");
  // No trip yet: the page offers a first one.
  await page.locator(".k-scope-empty").getByRole("button", { name: "New Trip" }).click({ timeout: 30_000 });
  const form = page.locator(".k-form");
  await form.getByLabel(/City/).fill("Lisbon");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(chip).toContainText("Lisbon");

  const city = view.locator("#lv-city");
  await expect(city).toHaveText("Lisbon", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "In Lisbon" }).first()).toBeVisible();

  // Renamed while selected: the chip, the title and the screen all say the new name — no reselect.
  await view.getByRole("button", { name: "Rename it" }).click();
  await expect(city).toHaveText("Lisbon Old Town");
  await expect(chip).toContainText("Lisbon Old Town");
  await expect(page.getByRole("button", { name: "In Lisbon Old Town" }).first()).toBeVisible();

  // Someone added to it: the screen lists them from `ctx.scope`, as it is now.
  await view.getByRole("button", { name: "Ana is coming" }).click();
  await expect(view.locator("#lv-who")).toHaveText("Ana");
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}
