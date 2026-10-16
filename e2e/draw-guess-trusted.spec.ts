import { test, expect, type Browser, type Page } from "./console-guard";
import { addAsMine, count, near, packApp, pixelsOf } from "./library-demos";
import { routeRooms, startRoomsRelay, type RoomsRelay } from "./live-servers.js";

// Draw & Guess (apps/draw-guess) played by three people, each in their own browser context with the
// app added as their own, in one room on the REAL rooms relay (started locally, docs/26). Every claim
// reads what a person would see — the pixels on each canvas, the scoreboard, the overlay — never only
// that an element exists:
//   - the lobby shows who came in (presence), and the host starts;
//   - the drawer's red line appears on another player's canvas, and on a late joiner's (the drawer's
//     device sends them the drawing so far);
//   - the guessers never see the word; a right guess scores for the guesser and the drawer;
//   - the turn passes to the next player;
//   - the host leaves: the next oldest hosts (the crown moves) and the game goes on.

let relay: RoomsRelay;
let zip: Buffer;

test.beforeAll(async ({ baseURL }) => {
  relay = await startRoomsRelay(new URL(baseURL!).origin);
  zip = packApp("draw-guess", "draw-guess.app.ts");
});
test.afterAll(async () => {
  await relay?.stop();
});

const RED: [number, number, number] = [229, 56, 59];

/** A person with the app added as theirs, on its start screen, name typed. */
async function player(browser: Browser, baseURL: string, name: string): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: { width: 1180, height: 900 } });
  const page = await context.newPage();
  await routeRooms(page, relay);
  await addAsMine(page, "draw-guess.potyro-app.zip", zip);
  await expect(page.getByRole("heading", { name: "Draw it. Guess it!" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Your name").fill(name);
  return page;
}

async function join(page: Page, code: string): Promise<void> {
  await page.getByPlaceholder("KQ7M-XR4P-2DHC").fill(code.toLowerCase().replaceAll("-", " "));
  await page.getByRole("button", { name: "Join", exact: true }).click();
}

const canvas = (page: Page) => page.locator(".dg-paper canvas");
const redPixels = async (page: Page) => count(await pixelsOf(canvas(page)), near(RED, 45));
const score = (page: Page, who: string) => page.locator(`.dg-score[data-player="${who}"] [data-testid="score"]`);
const crown = (page: Page, who: string) => page.locator(`.dg-score[data-player="${who}"] .dg-crown`);

/** The drawer picks the first word (only they see it) and draws a fat red zigzag. Returns the word. */
async function pickAndDraw(page: Page): Promise<string> {
  const first = page.locator(".dg-choice").first();
  await expect(first).toBeVisible();
  const word = (await first.innerText()).trim();
  await first.click();
  await expect(page.getByTestId("secret")).toHaveText(word);
  await page.getByRole("button", { name: "Red" }).click();
  await page.getByRole("button", { name: "Thick" }).click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.025), box.y + box.height * (i % 2 ? 0.6 : 0.3), { steps: 3 });
  await page.mouse.up();
  return word;
}

test("three people play Draw & Guess in one room: presence, live drawing, a right guess scores, the turn passes, the host leaves", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const ana = await player(browser, baseURL!, "Ana");
  await ana.getByRole("button", { name: "New game" }).click();
  await expect(ana.getByRole("heading", { name: "Waiting for players" })).toBeVisible({ timeout: 20_000 });
  const code = (await ana.locator(".dg-tiles").getAttribute("aria-label"))!;
  expect(code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  // Alone, the host cannot start yet.
  await expect(ana.getByRole("button", { name: "Start the game" })).toHaveCount(0);

  // Presence: Bo joins with the code (typed loosely) and both lobbies list both.
  const bo = await player(browser, baseURL!, "Bo");
  await join(bo, code);
  await expect(bo.getByRole("heading", { name: "Waiting for players" })).toBeVisible({ timeout: 20_000 });
  for (const p of [ana, bo]) {
    await expect(p.locator(".dg-person:not(.dg-person-empty)")).toHaveCount(2);
    await expect(p.locator(".dg-person", { hasText: "Ana" })).toContainText("host");
    await expect(p.locator(".dg-person", { hasText: "Bo" })).toBeVisible();
  }
  await expect(bo.getByText("Ana starts the game when everyone's in.")).toBeVisible();

  // The host sets one round and starts.
  await ana.getByRole("group", { name: "Rounds" }).getByRole("button", { name: "1", exact: true }).click();
  await expect(bo.getByRole("group", { name: "Rounds" }).getByRole("button", { name: "1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await ana.getByRole("button", { name: "Start the game" }).click();

  // Ana draws first; Bo watches the blanks, never the word.
  await expect(bo.getByText("Ana is picking a word…").first()).toBeVisible();
  const word = await pickAndDraw(ana);
  await expect(bo.getByTestId("mask")).toBeVisible();
  await expect(bo.getByTestId("secret")).toHaveCount(0);
  expect((await bo.getByTestId("mask").innerText()).toLowerCase()).not.toContain(word.toLowerCase());
  // The red line, on Bo's own canvas.
  await expect.poll(() => redPixels(bo), { timeout: 15_000 }).toBeGreaterThan(400);

  // Cy comes in late: the drawing so far lands on their canvas, and everyone sees them arrive.
  const cy = await player(browser, baseURL!, "Cy");
  await join(cy, code);
  await expect(cy.getByTestId("mask")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => redPixels(cy), { timeout: 15_000 }).toBeGreaterThan(400);
  await expect(score(ana, "Cy")).toHaveText("0");

  // A wrong guess shows in everyone's feed; a right one scores for Bo AND Ana, and Cy never saw it typed.
  await bo.getByPlaceholder("Type your guess…").fill("zebra crossing");
  await bo.getByRole("button", { name: "Guess", exact: true }).click();
  await expect(cy.locator(".dg-feed")).toContainText("zebra crossing");
  await bo.waitForTimeout(350);
  await bo.getByPlaceholder("Type your guess…").fill(word.toUpperCase());
  await bo.getByRole("button", { name: "Guess", exact: true }).click();
  for (const p of [ana, bo, cy]) await expect(p.getByTestId("revealed")).toHaveText(word);
  await expect(cy.locator(".dg-overlay")).toContainText("Bo guessed it!");
  await expect(bo.locator(".dg-overlay")).toContainText("You guessed it!");
  expect(await cy.locator(".dg-feed").innerText()).not.toContain(word.toUpperCase());
  const boScore = Number(await score(cy, "Bo").innerText());
  const anaScore = Number(await score(cy, "Ana").innerText());
  expect(boScore).toBeGreaterThanOrEqual(50);
  expect(anaScore).toBe(Math.round(boScore / 2));
  await expect(score(cy, "Cy")).toHaveText("0");

  // The turn passes to Bo, the next one who came in.
  await expect(bo.locator(".dg-choice").first()).toBeVisible({ timeout: 15_000 });
  await expect(ana.getByText("Bo is picking a word…").first()).toBeVisible();
  // Ana's line is gone from the new turn's paper.
  await expect.poll(() => redPixels(cy)).toBeLessThan(50);
  await expect(crown(cy, "Ana")).toHaveCount(1);

  // The host leaves. Bo is the oldest left: Bo hosts now, and the game goes on with Bo's clock.
  await ana.context().close();
  await expect(crown(cy, "Bo")).toHaveCount(1, { timeout: 20_000 });
  await expect(crown(bo, "Bo")).toHaveCount(1);
  await expect(cy.locator(`.dg-score[data-player="Ana"]`)).toContainText("away");
  await expect(score(cy, "Bo")).toHaveText(String(boScore));
  const word2 = await pickAndDraw(bo);
  await expect.poll(() => redPixels(cy), { timeout: 15_000 }).toBeGreaterThan(400);
  await cy.getByPlaceholder("Type your guess…").fill(word2);
  await cy.getByRole("button", { name: "Guess", exact: true }).click();
  await expect(cy.locator(".dg-overlay")).toContainText("You guessed it!");
  await expect.poll(async () => Number(await score(bo, "Cy").innerText())).toBeGreaterThanOrEqual(50);
  // Then Cy draws: the new host moved the game on.
  await expect(cy.locator(".dg-choice").first()).toBeVisible({ timeout: 15_000 });

  await bo.context().close();
  await cy.context().close();
});
