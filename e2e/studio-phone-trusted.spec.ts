import { test, expect, type Locator, type Page } from "./console-guard";
import { currentCard } from "./studio-helpers.js";

// The Studio on a phone and on a desktop (#80, then #261). It is a conversation: the box to say
// what you want sits at the bottom of the screen, whole and in thumb reach; what has been said fills
// the space above it; and the app opens from its card — the whole screen on a phone, as it will
// really run, beside the conversation on a wide screen.

const PHONE = { width: 375, height: 812 };

type Box = { x: number; y: number; width: number; height: number };
const bottom = (b: Box) => b.y + b.height;
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < bottom(b) && b.y < bottom(a);

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error(`no box for ${String(l)}`);
  return b;
}

const APP = `import { defineApp } from "potyro";

export default defineApp({
  id: "reader",
  name: "Reader",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],
});
`;

/** The dev server's generate endpoint, answering with the app above. */
async function stubGenerator(page: Page): Promise<void> {
  await page.route("**/__generate**", async (route) => {
    if (route.request().method() === "POST") return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id: "job-1" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "done", text: "```ts\n" + APP + "```\n" }) });
  });
}

test.describe("phone", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("the box is whole, at the bottom, with nothing on top of it", async ({ page }) => {
    await page.goto("/");
    // The floating New app asks first on a phone: make one, or add one someone sent (#253).
    await page.locator(".k-launch-fab").tap();
    await page.getByRole("menuitem", { name: /Describe a new app/ }).tap();
    const studio = page.getByRole("dialog", { name: "App studio" });
    const prompt = studio.getByRole("textbox", { name: "Describe the app" });
    await expect(prompt).toBeVisible();
    // Wait for the Studio's entrance to settle before measuring.
    await studio.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));

    const p = await box(prompt);
    const send = await box(studio.getByRole("button", { name: "Create the app" }));
    // On screen, in the lower part of it, where a thumb is.
    expect(p.y).toBeGreaterThan(PHONE.height / 2);
    expect(bottom(p)).toBeLessThanOrEqual(PHONE.height);
    expect(p.x + p.width).toBeLessThanOrEqual(PHONE.width);
    // Room to write, and the send button is beside it, not on it.
    expect(p.height).toBeGreaterThanOrEqual(40);
    expect(send.x).toBeGreaterThanOrEqual(p.x + p.width - 1);
    expect(bottom(send)).toBeLessThanOrEqual(PHONE.height);

    const buttons = studio.locator("button:visible");
    for (let i = 0; i < (await buttons.count()); i++) {
      const b = await box(buttons.nth(i));
      expect(intersects(p, b), `button "${await buttons.nth(i).textContent()}" overlaps the box`).toBe(false);
    }
  });

  test("the app opens from its card as the whole screen, with the way back on its bar", async ({ page }) => {
    await stubGenerator(page);
    await page.addInitScript(() => localStorage.setItem("potyro:generator:engine", JSON.stringify({ engine: "cli" })));
    await page.goto("/");
    await page.locator(".k-launch-fab").tap();
    await page.getByRole("menuitem", { name: /Describe a new app/ }).tap();
    const studio = page.getByRole("dialog", { name: "App studio" });
    await studio.getByRole("textbox", { name: "Describe the app" }).fill("a reading list");
    await studio.getByRole("button", { name: "Create the app" }).tap();

    // On a phone the app does not open by itself: the card says it is there.
    await expect(currentCard(studio)).toBeVisible({ timeout: 60_000 });
    await expect(studio.locator(".k-preview")).toHaveCount(0);
    await currentCard(studio).getByRole("button", { name: "Open" }).tap();

    const preview = studio.locator(".k-preview");
    await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 30_000 });
    await preview.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    // The whole screen.
    const p = await box(preview);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    expect(p.width).toBe(PHONE.width);
    expect(p.height).toBe(PHONE.height);
    // And the way back is always there.
    const back = preview.getByRole("button", { name: "Back to the chat" });
    await expect(back).toBeVisible();
    await back.tap();
    await expect(studio.locator(".k-preview")).toHaveCount(0);
    await expect(studio.getByRole("textbox", { name: "Describe the app" })).toBeVisible();
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a reading column with the box under it; the app opens beside the conversation", async ({ page }) => {
    await stubGenerator(page);
    await page.addInitScript(() => localStorage.setItem("potyro:generator:engine", JSON.stringify({ engine: "cli" })));
    await page.goto("/");
    await page.locator(".k-launch-newbtn").click();
    const studio = page.getByRole("dialog", { name: "App studio" });
    const prompt = studio.getByRole("textbox", { name: "Describe the app" });
    await expect(prompt).toBeVisible();
    const p = await box(prompt);
    // A measure, not the full width of a wide screen, and at the bottom of the window.
    expect(p.width).toBeLessThan(800);
    expect(bottom(p)).toBeLessThanOrEqual(900);
    expect(p.y).toBeGreaterThan(900 / 2);

    await prompt.fill("a reading list");
    await studio.getByRole("button", { name: "Create the app" }).click();
    const preview = studio.locator(".k-preview");
    await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 60_000 });
    await preview.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    // Beside: the conversation keeps the left, the app has the rest, and neither covers the other.
    const chat = await box(studio.locator(".k-studio-chat"));
    const app = await box(preview);
    expect(app.x).toBeGreaterThanOrEqual(chat.x + chat.width - 1);
    expect(app.width).toBeGreaterThan(chat.width);
    expect(intersects(await box(studio.getByRole("textbox", { name: "Describe the app" })), app)).toBe(false);
  });
});
