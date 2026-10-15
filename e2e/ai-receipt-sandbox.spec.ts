import { readFileSync } from "node:fs";
import { test, expect, type Page, type Request } from "@playwright/test";
import { installShared } from "./realm.js";

// `ctx.caps.ai` in a shared app (docs/23): Receipt Split, sealed, reads a photo of a receipt into
// items. What is checked is what a person sees and what leaves the browser: the app asks first,
// naming the service and what goes; nothing is sent before Allow; the free relay is tried first and,
// not being there, the person's own OpenRouter key pays; the request carries the photo and the
// app's instructions and nothing from the app's records; and the items the model read appear as rows.
//
// OpenRouter is a mocked route — no real model is called, nothing is spent. Run in the realm and,
// on the same page, in the QuickJS fallback.

const SOURCE = readFileSync(new URL("../apps/receipt-split/receipt-split.app.ts", import.meta.url), "utf8");
const PHOTO = readFileSync(new URL("./fixtures/garden-flower.png", import.meta.url));
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

const ANSWER = { shop: "Żabka", items: [{ name: "Mleko 2%", price: 4.99 }, { name: "Chleb żytni", price: "6,50" }] };

async function prepare(page: Page, sandbox: "realm" | "quickjs") {
  const sent: Array<{ url: string; body: Record<string, unknown>; auth: string | undefined }> = [];
  await page.addInitScript(
    ([runner]) => {
      try {
        localStorage.setItem("potyro:sandbox", runner);
        // The person's own key, as Model settings keeps it (session only).
        sessionStorage.setItem("potyro:engine-config", JSON.stringify({ engine: "openrouter", openrouterKey: "sk-or-test-key" }));
      } catch {
        // the realm's sandboxed frame has no storage, and needs none of this
      }
    },
    [sandbox] as const,
  );
  // The free relay is not deployed: the site answers with a 404 of its own.
  await page.route("**/ai/complete", async (route) => {
    sent.push({ url: route.request().url(), body: route.request().postDataJSON() as Record<string, unknown>, auth: undefined });
    await route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Not found</title>" });
  });
  await page.route(OPENROUTER, async (route) => {
    const req: Request = route.request();
    sent.push({ url: req.url(), body: req.postDataJSON() as Record<string, unknown>, auth: req.headers().authorization });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANSWER) } }], usage: { cost: 0.0003 } }),
    });
  });
  await installShared(page, "receipt-split", "Receipt Split", SOURCE);
  return sent;
}

/** Tap "Read a receipt" and choose the photo. The wait starts first: the picker can open before a click returns. */
async function readReceipt(page: Page, name: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Read a receipt/ }).click();
  await (await chooser).setFiles({ name, mimeType: "image/png", buffer: PHOTO });
}

for (const sandbox of ["realm", "quickjs"] as const) {
  test(`a shared app asks before sending a photo to AI, then shows the items it read (${sandbox})`, async ({ page }) => {
    const sent = await prepare(page, sandbox);
    await expect(page.locator("h1").first()).toHaveText("Receipt Split");

    await readReceipt(page, "receipt.png");

    // The question, before anything leaves.
    const dialog = page.locator(".k-dialog");
    await expect(dialog).toContainText("“Receipt Split” wants to send a photo to an AI service (OpenRouter) to read it.");
    await expect(dialog).toContainText("nothing else in the app");
    expect(sent).toEqual([]);
    await dialog.getByRole("button", { name: "Allow" }).click();

    // The items the model read, as rows — the price fitted to a number on the way ("6,50" → 6.50).
    await expect(page.locator(".k-primary", { hasText: "Mleko 2%" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".k-primary", { hasText: "Chleb żytni" })).toBeVisible();
    await expect(page.getByText(/6[.,]50/).first()).toBeVisible();
    await expect(page.getByText("Added 2 items")).toBeVisible();

    // Free first, then the person's own key — and what went is the photo and the app's words.
    expect(sent.map((s) => s.url.replace(/^https?:\/\/[^/]+/, ""))).toEqual(["/ai/complete", "/api/v1/chat/completions"]);
    const call = sent[1]!;
    expect(call.auth).toBe("Bearer sk-or-test-key");
    expect(call.body.model).toBe("google/gemini-2.5-flash-lite");
    const user = (call.body.messages as Array<{ role: string; content: unknown }>)[1]!.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(user.map((p) => p.type)).toEqual(["text", "image_url"]);
    expect(user[0]!.text).toContain("A shop or restaurant receipt");
    expect(user[1]!.image_url!.url).toMatch(/^data:image\/(png|jpeg);base64,/);
    // The free relay's payload never carried the key.
    expect(JSON.stringify(sent[0]!.body)).not.toContain("sk-or-test-key");

    // Asked once: the next receipt goes without a question.
    await readReceipt(page, "receipt-2.png");
    await expect(page.locator(".k-primary", { hasText: "Mleko 2%" })).toHaveCount(2, { timeout: 20_000 });
    await expect(dialog).toHaveCount(0);
  });
}

test("Not now sends nothing and adds nothing (realm)", async ({ page }) => {
  const sent = await prepare(page, "realm");
  await readReceipt(page, "receipt.png");
  const dialog = page.locator(".k-dialog");
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/Tap “Read a receipt”/)).toBeVisible();
  expect(sent).toEqual([]);
});
