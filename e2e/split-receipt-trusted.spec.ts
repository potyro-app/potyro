import { readFileSync } from "node:fs";
import { test, expect, type Page } from "./console-guard";
import { pickScope } from "./scope-pick.js";

// Split a receipt (docs/23): the photo goes to the AI service and comes back as lines in ONE form —
// "Who had what?" — which the person checks, corrects and confirms before anything is saved. The
// total the AI read and the lines' sum differ, so the form also carries the rest of the bill as a line
// of its own: nothing the AI decides goes in unseen. Then Settle up offers the suggested transfers.
//
// OpenRouter is a mocked route — no real model is called, nothing is spent.

const PHOTO = readFileSync(new URL("./fixtures/garden-flower.png", import.meta.url));
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
const ANSWER = { shop: "Cervejaria Ramiro", total: 52.5, items: [{ name: "Gambas", price: 24 }, { name: "Prego", price: 6.5 }, { name: "Imperial", price: 9 }] };

async function prepare(page: Page): Promise<Array<Record<string, unknown>>> {
  const sent: Array<Record<string, unknown>> = [];
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("potyro:engine-config", JSON.stringify({ engine: "openrouter", openrouterKey: "sk-or-test-key" }));
    } catch {
      // nothing to set where there is no storage
    }
  });
  await page.route("**/ai/health", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Not found</title>" }));
  await page.route("**/ai/complete", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Not found</title>" }));
  await page.route(OPENROUTER, async (route) => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANSWER) } }], usage: { cost: 0.0003 } }) });
  });
  return sent;
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("a receipt becomes checked lines in one form, then an itemized expense", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/Failed to load resource: .*404/, "the free AI relay is not deployed in this test: its /ai/health answers 404");
    const sent = await prepare(page);
    await page.goto("/?user=split");
    await pickScope(page, /^Lisbon weekend/, 30_000);
    await expect(page.locator(".k-list-row", { hasText: "Tasca da Esquina" })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /Split a receipt/ }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: /Read a photo of it/ }).click();
    await (await chooser).setFiles({ name: "receipt.png", mimeType: "image/png", buffer: PHOTO });
    // A trusted app may still be asked about AI the first time; allow it if it is.
    const allow = page.locator(".k-dialog").getByRole("button", { name: "Allow" });
    if (await allow.isVisible({ timeout: 3_000 }).catch(() => false)) await allow.click();

    const form = page.getByRole("dialog", { name: "Who had what?" });
    await expect(form).toBeVisible({ timeout: 20_000 });
    await expect(form.getByLabel(/^Where/)).toHaveValue("Cervejaria Ramiro");
    // The three lines, and the rest of the bill the AI's total says is missing — all editable.
    await expect(form.locator("input[value='Gambas']")).toBeVisible();
    await expect(form.locator("input[value='Rest of the bill (tax, tip)']")).toBeVisible();
    await form.getByRole("button", { name: "Add expense" }).click();
    await expect(form).toHaveCount(0);
    await expect(page.locator(".k-toast")).toContainText("Added, 4 lines");

    const row = page.locator(".k-list-row", { hasText: "Cervejaria Ramiro" });
    await expect(row).toContainText("€52.50");
    await row.click();
    const detail = page.locator("article.k-detail");
    await expect(detail).toContainText("Gambas");
    await expect(detail).toContainText("to the cent");
    // What went to the AI: the photo and the app's words, nothing from its records.
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).not.toContain("Tasca da Esquina");
  });
});
