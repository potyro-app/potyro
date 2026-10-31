import { test, expect, type BrowserContext, type Page } from "./console-guard";
import { readFileSync } from "node:fs";
import { addAsMine, count, packApp, pixelsOf } from "./library-demos";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";
import { E2E_RELAY } from "./ports";
import { grantClipboard } from "./engines";

// apps/photo-puzzle, packed as its build packs it and added as the person's own app. The photo goes in
// the way a phone's would: ctx.caps.camera on the web is a file input, so the test answers its file
// chooser. The pieces are really dragged — from where each one lies to its place on the board — and
// the board is read back from the canvas: when it is solved, the flower is there.
//
// Then the other half of the feature: Photo Puzzle is shared, a second device (another browser
// context, another identity) joins through the link, the photo arrives, and they solve YOUR photo;
// their time comes back to you. Before the app hands out a link of its own, it says the photo goes
// to whoever opens it.

const SHOTS = process.env.POTYRO_SHOTS;
const FLOWER = readFileSync(new URL("./fixtures/garden-flower.png", import.meta.url));
/** The flower's pink. */
const pink = (r: number, g: number, b: number, a: number) => a > 100 && r > 170 && g < 140 && b > 80 && b < 190 && r - g > 70;

test.use({ viewport: { width: 390, height: 844 }, colorScheme: "light" });

const canvas = (page: Page) => page.locator(".pp-stage canvas");
const loose = (page: Page) => page.locator(".pp-stage ul button[data-piece]");

async function choosePhoto(page: Page): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose one" }).first().click();
  await (await chooser).setFiles({ name: "flower.png", mimeType: "image/png", buffer: FLOWER });
}

async function pickLevel(page: Page, level: RegExp): Promise<void> {
  const sheet = page.getByRole("menu", { name: "How many pieces?" });
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await sheet.getByRole("menuitem", { name: level }).click();
  await expect(loose(page).first()).toBeAttached({ timeout: 30_000 });
}

/** Drag one loose piece by hand, from where it lies to its place. */
async function dragHome(page: Page, piece = loose(page).first()): Promise<void> {
  const box = (await canvas(page).boundingBox())!;
  const [x, y, hx, hy] = await piece.evaluate((b) => ["data-x", "data-y", "data-home-x", "data-home-y"].map((k) => Number(b.getAttribute(k))));
  await page.mouse.move(box.x + x!, box.y + y!);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + x! + ((hx! - x!) * i) / 8, box.y + y! + ((hy! - y!) * i) / 8);
  await page.mouse.up();
}

async function solveByHand(page: Page, total: number, byButton = 0): Promise<void> {
  for (let n = 1; n <= total - byButton; n++) {
    await dragHome(page);
    await expect(page.locator(".pp-count")).toHaveText(`${n} of ${total} placed`, { timeout: 10_000 });
  }
  // The rest the accessible way: each loose piece is a button that puts it in place.
  for (let n = total - byButton + 1; n <= total; n++) {
    await loose(page).first().focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".pp-count")).toHaveText(`${n} of ${total} placed`, { timeout: 10_000 });
  }
}

test("Photo Puzzle: a photo becomes a jigsaw, pieces dragged home click in, and the solved board is the photo", async ({ page }) => {
  test.setTimeout(180_000);
  const { card } = await addAsMine(page, "photo-puzzle.potyro-app.zip", packApp("photo-puzzle", "photo-puzzle.app.ts"));
  expect(card).toMatch(/Asks for camera/);
  expect(card).not.toMatch(/fetches/);

  await expect(page.getByRole("heading", { name: "Any photo, a puzzle in a second" })).toBeVisible({ timeout: 30_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/puzzle-home-empty-390-light-en.png` });
  await choosePhoto(page);
  await pickLevel(page, /Easy/);
  await expect(page.locator(".pp-count")).toHaveText("0 of 12 placed");
  await expect(loose(page)).toHaveCount(12);

  // The table really shows the photo's colours, on the loose pieces, before anything is placed.
  await expect.poll(async () => count(await pixelsOf(canvas(page)), pink), { timeout: 15_000 }).toBeGreaterThan(2_000);

  // A piece dropped far from its place stays loose.
  const first = loose(page).first();
  const box = (await canvas(page).boundingBox())!;
  const [x, y] = await first.evaluate((b) => [Number(b.dataset.x), Number(b.dataset.y)]);
  await page.mouse.move(box.x + x!, box.y + y!);
  await page.mouse.down();
  await page.mouse.move(box.x + x! + 40, box.y + y! - 30, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(".pp-count")).toHaveText("0 of 12 placed");
  await expect(loose(page)).toHaveCount(12);

  // Ten by hand, two the accessible way.
  await solveByHand(page, 12, 2);
  if (SHOTS) await page.waitForTimeout(400);
  const done = page.getByRole("dialog", { name: "Solved!" });
  await expect(done).toBeVisible({ timeout: 15_000 });
  await expect(done).toContainText("A new best for Easy");
  await expect(done).toContainText("with 2 pieces placed for you");
  await expect(loose(page)).toHaveCount(0);
  // The board is the photo, whole: the flower's pink in the middle of it.
  await expect.poll(async () => count(await pixelsOf(canvas(page), { x: 0.2, y: 0.05, w: 0.6, h: 0.45 }), pink), { timeout: 10_000 }).toBeGreaterThan(5_000);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/puzzle-solved-390-light-en.png` });

  // Send, from an app that is not shared yet: it says where sharing happens, and makes no link.
  await done.getByRole("button", { name: /Send to a friend/ }).click();
  const where = page.locator(".k-dialog", { hasText: "Share Photo Puzzle first" });
  await expect(where).toContainText("your photos go with them");
  await where.getByRole("button", { name: "Got it" }).click();

  // Back to the puzzles: the photo, with its best time.
  await done.getByRole("button", { name: "Puzzles" }).click();
  const cardEl = page.locator(".pp-card").first();
  await expect(cardEl).toContainText("Easy · Best 0:");
  await expect.poll(() => cardEl.locator("img").evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(300);
});

async function device(context: BrowserContext): Promise<Page> {
  await context.addInitScript((relay) => localStorage.setItem("potyro:sync:relay", relay), E2E_RELAY);
  return context.newPage();
}

test("Photo Puzzle: sent to a friend, they solve YOUR photo, and their time comes back", async ({ browser, browserName }) => {
  test.setTimeout(300_000);
  // ---- A: makes a puzzle, shares the app ----
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await grantClipboard(ctxA, browserName);
  const a = await device(ctxA);
  await addAsMine(a, "photo-puzzle.potyro-app.zip", packApp("photo-puzzle", "photo-puzzle.app.ts"));
  await choosePhoto(a);
  await pickLevel(a, /Easy/);
  await a.goto("/?user=photo-puzzle");
  await expect(a.locator(".pp-card")).toHaveCount(1);

  await a.goto("/");
  await tileAction(a, "Photo Puzzle", "share");
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click(); // sync on
  // Turning sync on copies the photo into the synced store first, which takes a moment.
  await expect(a.locator(".k-dialog", { hasText: "see you as" })).toBeVisible({ timeout: 120_000 });
  await answerNamePrompt(a, "Vasco");
  const linkField = a.locator(".k-dialog input");
  await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  const backup = a.locator(".k-dialog", { hasText: "more than one place" });
  if (await backup.isVisible().catch(() => false)) await backup.getByRole("button", { name: "Cancel" }).click();

  // ---- B: opens the link, trusts it, and the puzzle is there, from Vasco ----
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const b = await device(ctxB);
  await b.goto(link);
  await b.locator(".k-dialog").getByRole("button", { name: /Join, run it as yours/ }).click(); // trust prompt
  await answerNamePrompt(b, "Ana");
  const gift = b.locator(".pp-card").first();
  await expect(gift).toContainText("From Vasco", { timeout: 90_000 });
  // The photo arrives on demand and shows.
  await expect.poll(() => gift.locator("img").evaluate((el) => (el as HTMLImageElement).naturalWidth).catch(() => 0), { timeout: 90_000 }).toBeGreaterThan(300);
  if (SHOTS) await b.screenshot({ path: `${SHOTS}/puzzle-friend-home-390-light-en.png` });
  await gift.getByRole("button", { name: /play/ }).click();
  await pickLevel(b, /Easy/);
  await expect(b.locator(".pp-sub")).toContainText("From Vasco");
  await expect.poll(async () => count(await pixelsOf(canvas(b)), pink), { timeout: 30_000 }).toBeGreaterThan(2_000);
  await solveByHand(b, 12, 9);
  await expect(b.getByRole("dialog", { name: "Solved!" })).toBeVisible({ timeout: 15_000 });

  // ---- A: sees Ana's time, and can send more links from inside the app — after being told ----
  await a.goto("/?user=photo-puzzle");
  await expect(a.locator(".pp-card").first()).toContainText("Ana ·", { timeout: 90_000 });
  await a.locator(".pp-card").first().getByRole("button", { name: /More for/ }).click();
  await a.getByRole("menuitem", { name: /Send to a friend/ }).click();
  const warn = a.locator(".k-dialog", { hasText: "Your photo goes with it" });
  await expect(warn).toContainText("Whoever gets the link joins Photo Puzzle with you");
  await warn.getByRole("button", { name: "Get the link" }).click();
  const share = a.getByRole("dialog", { name: "Send the puzzle" });
  await expect(share.getByRole("textbox", { name: "What will be sent" })).toHaveValue(/I made a puzzle out of a photo for you 🧩[\s\S]*#join=/, { timeout: 60_000 });
  await share.getByRole("button", { name: "Done" }).click();

  await ctxA.close();
  await ctxB.close();
});

// The launch screenshots (POTYRO_SHOTS=dir): mid-game on a phone in light and dark, and a desktop, in
// English and Polish.
test.describe("screenshots", () => {
  test.skip(!SHOTS, "set POTYRO_SHOTS to a folder to take them");
  for (const [locale, lang] of [
    ["en-US", "en"],
    ["pl-PL", "pl"],
  ] as const) {
    for (const [scheme, width, height] of [
      ["light", 375, 812],
      ["dark", 375, 812],
      ["light", 1440, 900],
      ["dark", 1440, 900],
    ] as const) {
      test(`${lang} ${width} ${scheme}`, async ({ browser }) => {
        test.setTimeout(180_000);
        const context = await browser.newContext({ locale, colorScheme: scheme, viewport: { width, height }, deviceScaleFactor: 2 });
        const page = await context.newPage();
        await page.goto("/");
        await page.evaluate(() => localStorage.setItem("potyro:locale", "en"));
        await addAsMine(page, "photo-puzzle.potyro-app.zip", packApp("photo-puzzle", "photo-puzzle.app.ts"));
        // Back to the device's language, then the same steps by their places rather than their words.
        await page.evaluate(() => localStorage.removeItem("potyro:locale"));
        await page.reload();
        const chooser = page.waitForEvent("filechooser");
        await page.locator(".pp-hero .pp-btn:not(.pp-primary)").click({ timeout: 30_000 });
        await (await chooser).setFiles({ name: "flower.png", mimeType: "image/png", buffer: FLOWER });
        await page.getByRole("menuitem").nth(1).click({ timeout: 30_000 });
        await expect(loose(page).first()).toBeAttached({ timeout: 30_000 });
        for (let i = 1; i <= 7; i++) {
          await dragHome(page);
          await expect(page.locator(".pp-count")).toHaveText(new RegExp(`^${i}\\D`), { timeout: 10_000 });
        }
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/puzzle-play-${width}-${scheme}-${lang}.png` });
        for (let guard = 0; guard < 60 && (await loose(page).count()) > 0; guard++) {
          await loose(page).first().focus().catch(() => undefined);
          await page.keyboard.press("Enter");
          await page.waitForTimeout(150);
        }
        await expect(page.locator(".pp-done")).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(2200);
        await page.screenshot({ path: `${SHOTS}/puzzle-solved-${width}-${scheme}-${lang}.png` });
        await page.locator(".pp-done .pp-row .pp-btn").last().click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${SHOTS}/puzzle-home-${width}-${scheme}-${lang}.png` });
        await context.close();
      });
    }
  }
});
