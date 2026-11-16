import { test, expect, type Page } from "./console-guard";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installShared, startProbe, type Probe } from "./realm.js";

// What a person sees where a shared app's own screen cannot be drawn (#91): the QuickJS fallback,
// which the shell chooses by itself on a device whose browser cannot build the realm (docs/07). It
// has no frame to put a custom view in, so the page says so in plain words, names the app's other
// pages — which work — and offers the one way to see this screen. Never a blank, never an error in a
// developer's words, and the trust dialog does not claim the box draws screens it cannot draw here.
//
// The fallback is asked for on this device (`potyro:sandbox`), as a person's own browser would end
// up there, so this runs in every sandbox project and not only under POTYRO_QUICKJS.

test.use({ viewport: { width: 1280, height: 800 } });

const FIXTURE = readFileSync(fileURLToPath(new URL("./fixtures/sealed-views.app.tsx", import.meta.url)), "utf8");

let probe: Probe;
test.beforeAll(async () => {
  probe = await startProbe();
});
test.afterAll(async () => {
  await probe.close();
});

async function open(page: Page): Promise<void> {
  probe.hits.length = 0;
  await page.addInitScript(() => localStorage.setItem("potyro:sandbox", "quickjs"));
  await installShared(page, "sealed-views", "Sealed views", FIXTURE.replaceAll("__PROBE__", probe.origin));
}

test("where the box cannot draw an app's own screen, the page says so, names the pages that work and offers to run it as yours", async ({ page }) => {
  await open(page);
  const card = page.locator(".k-custom-fallback");
  await expect(card).toBeVisible({ timeout: 30_000 });
  // The app's code never ran as a screen: no frame, none of its DOM, nothing asked of the network.
  await expect(page.locator(".k-sealed-view")).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByText("Sealed board")).toHaveCount(0);
  // Plain words, not a failure: no alert, no error text of the engine's.
  await expect(card).toContainText("This screen is built with the app’s own code, so it only runs when the app runs as yours.");
  await expect(card).toContainText("The app’s other pages work here:");
  await expect(page.locator(".k-part-problem")).toHaveCount(0);
  await expect(card).not.toContainText(/not defined|undefined|Error|QuickJS/i);

  // The dialog it leads to is true of this device: the box here draws no screens of the app's own.
  await card.getByRole("button", { name: "Run it as mine" }).click();
  const dialog = page.getByRole("dialog", { name: "Let it run as yours?" });
  await expect(dialog).toContainText("on this device it cannot draw its own screens there");
  await expect(dialog).not.toContainText("runs and draws its own screens");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");

  // The other page is one tap away and is the app's real page, sealed: its title, its own button.
  await card.getByRole("button", { name: "Notes" }).click();
  await expect(page.getByRole("heading", { name: "Notes", level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Still here?" })).toBeVisible();
  await expect(page.locator(".k-custom-fallback")).toHaveCount(0);
  expect(probe.hits).toEqual([]);
});
