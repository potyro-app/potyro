import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

// Installs the live-connection fixture (e2e/fixtures/live-echo.app.ts) with its ports and room filled
// in, as the person's own app or a shared one, and opens it. Shared runs in the realm unless asked
// for QuickJS (`potyro:sandbox`).

const SOURCE = readFileSync(new URL("./fixtures/live-echo.app.ts", import.meta.url), "utf8");

export const ROOM_ID = "e2e-room-0000000000000000";

export interface LiveApp {
  echoPort: number;
  otherPort: number;
  trusted: boolean;
  sandbox?: "realm" | "quickjs";
}

export async function openLiveEcho(page: Page, o: LiveApp): Promise<void> {
  const source = SOURCE.replaceAll("__ECHO_PORT__", String(o.echoPort)).replaceAll("__OTHER_PORT__", String(o.otherPort)).replaceAll("__ROOM_ID__", ROOM_ID);
  await page.addInitScript(
    ([src, trusted, sandbox]) => {
      if (sandbox) localStorage.setItem("potyro:sandbox", sandbox);
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "live-echo", name: "Live Echo", source: src, trusted, updatedAt: new Date().toISOString() }]));
    },
    [source, o.trusted, o.sandbox ?? ""] as const,
  );
  // From the apps screen, so that leaving (Back) is a switch in place, as a person does it — not a
  // page unload, which would close every connection by itself.
  await page.goto("/");
  await tile(page).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", o.trusted ? "trusted" : "untrusted", { timeout: 30_000 });
  await expect(page.locator(".k-page-action", { hasText: "Connect" })).toBeVisible();
}

/** Leave the app the way a person does: Back, to the apps screen, in place. */
export async function leave(page: Page): Promise<void> {
  await page.goBack();
  await expect(tile(page)).toBeVisible({ timeout: 30_000 });
}

/** The app's tile on the apps screen. A shared app's carries its shield, so its name is not exact. */
const tile = (page: Page) => page.getByRole("button", { name: /Live Echo/ }).and(page.locator(":not([aria-label^='Actions'])")).first();

export const tap = (page: Page, label: string) => page.locator(".k-page-action", { hasText: label }).click();

/** A line the app wrote down. */
export const line = (page: Page, text: string) => page.locator(".k-primary", { hasText: text });

/** Answer the consent question, after checking what it says. */
export async function allow(page: Page, says: string): Promise<void> {
  const dialog = page.locator(".k-dialog");
  await expect(dialog).toContainText(says);
  await expect(dialog).toContainText("Potyro closes the connection when you leave the app.");
  await dialog.getByRole("button", { name: "Allow" }).click();
  await expect(dialog).toHaveCount(0);
}
