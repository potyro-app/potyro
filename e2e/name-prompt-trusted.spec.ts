import { test, expect, type Page } from "./console-guard";
import { tileAction } from "./launcher-actions.js";

// When Potyro asks what to call you — and, more importantly, when it must NOT.
//
// Sharing and joining ask once, because until then the name is private and asking would be signup
// ceremony for an app only you can see. The trap is what "once" means: the first version recorded
// only that it had ASKED, so someone who had already named themselves in ⌾ You — the obvious thing
// to do before sharing — was asked the same question again the moment they pressed Share. Answering
// a question you had already answered, immediately followed by another dialog with a text box in it
// (the share link), reads as "it keeps asking".
//
// So the claim under test is about the NAME, not about the flag.

const STARTER = `import { defineApp } from "potyro";
export default defineApp({
  id: "namecheck", name: "Name Check", version: "1.0.0", schemaVersion: 1,
  entities: { item: { label: "Item", icon: "x", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "title" } } }],
});
`;

const nameDialog = (page: Page) => page.locator(".k-dialog", { hasText: "see you as" });

/**
 * Show the launcher, where an app's tile keeps its actions.
 *
 * Needed again between two shares: finishing a share puts you back in the app rather than leaving
 * the launcher hanging open behind the dialogs, so the second share starts from the app the way the
 * first one did.
 */
async function showLauncher(page: Page): Promise<void> {
  await page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
}

async function open(page: Page): Promise<void> {
  await page.addInitScript(
    ([source]) => {
      localStorage.setItem("potyro:sync:relay", "ws://localhost:4201");
      if (localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([{ id: "namecheck", name: "Name Check", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    [STARTER] as const,
  );
  await page.goto("/?user=namecheck");
  await expect(page.locator("h1").first()).toHaveText("Name Check", { timeout: 30_000 });
  await showLauncher(page);
}

test("naming yourself first means sharing does not ask again", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: "You and your devices" }).click();
  await page.locator(".k-identity").getByRole("button", { name: /^(Rename|Set a name)$/ }).click();
  await page.locator(".k-dialog input").fill("Vasco");
  await page.locator(".k-dialog").getByRole("button", { name: "OK" }).click();
  await expect(page.locator(".k-identity-name")).toContainText("Vasco");
  await page.locator(".k-identity").getByRole("button", { name: "Close" }).click();

  await tileAction(page, "Name Check", "share");
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click(); // turns sync on

  // The next thing asked must be the LINK, not the name. Waiting for a dialog rather than a fixed
  // delay matters: turning sync on migrates the data, and an earlier version of this test declared
  // success in the gap before the prompt it was looking for had appeared.
  await page.locator(".k-dialog").waitFor({ timeout: 60_000 });
  await expect(nameDialog(page)).toHaveCount(0);
  await expect(page.locator(".k-dialog")).toContainText("Send this link");
});

test("sharing asks once, and not on every share after", async ({ page }) => {
  await open(page);

  await tileAction(page, "Name Check", "share");
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(nameDialog(page)).toBeVisible({ timeout: 60_000 });
  await nameDialog(page).locator("input").fill("Vasco");
  await nameDialog(page).getByRole("button", { name: "OK" }).click();

  await expect(page.locator(".k-dialog input")).toHaveValue(/#join=/, { timeout: 60_000 });
  await page.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  // The recovery-words offer, first sync of anything (ADR D2a).
  await page.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();

  // Share again: straight to the link.
  await showLauncher(page);
  await tileAction(page, "Name Check", "share");
  await page.locator(".k-dialog").waitFor({ timeout: 60_000 });
  await expect(nameDialog(page)).toHaveCount(0);
  await expect(page.locator(".k-dialog")).toContainText("Send this link");
});
