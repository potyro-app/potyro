import { test, expect, type Locator, type Page } from "./console-guard";
import { addAsMine, packApp } from "./library-demos";
import { dailyCode, feedback, puzzleNumber, shareText, type Mark } from "../apps/daily-puzzle/puzzle";

// apps/daily-puzzle, packed as its build packs it and added as the person's own app. The clock is
// fixed, so the test knows the day's code from puzzle.ts — the same function the app runs — and plays
// a real day: a wrong guess by tapping, one by keyboard, then the code. Every check is about what is
// on screen: what each cell is marked and painted, the result, the shared text and the clipboard.

const SHOTS = process.env.POTYRO_SHOTS;
const DAY = new Date(2026, 9, 20, 9, 30); // puzzle #6
const N = puzzleNumber(DAY);
const CODE = dailyCode(N);

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, colorScheme: "light" });

const rowOf = (page: Page, r: number) => page.locator(".dp-board .dp-row").nth(r);
const key = (page: Page, colour: number) => page.locator(`.dp-key[data-colour="${colour}"]`);

/** What a cell is painted with: its background and whether the gem is what is on top at its centre. */
async function painted(cell: Locator): Promise<{ bg: string; gemOnTop: boolean; w: number }> {
  return cell.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { bg: getComputedStyle(el).backgroundColor, gemOnTop: !!top?.closest(".dp-gem") && el.contains(top), w: r.width };
  });
}

/** Green-ish (exact), amber (present), or neither, read from the computed colour as sRGB. */
async function hue(cell: Locator): Promise<"green" | "amber" | "plain"> {
  const bg = await cell.evaluate((el) => {
    const c = document.createElement("canvas").getContext("2d")!;
    c.fillStyle = getComputedStyle(el).backgroundColor;
    c.fillRect(0, 0, 1, 1);
    return [...c.getImageData(0, 0, 1, 1).data];
  });
  const [r, g, b] = bg as [number, number, number];
  if (g > r + 30 && g > b + 20) return "green";
  if (r > 150 && g > 120 && b < 110) return "amber";
  return "plain";
}

async function expectRow(page: Page, r: number, guess: number[]): Promise<void> {
  const marks = feedback(guess, CODE);
  const cells = rowOf(page, r).locator(".dp-cell");
  await expect(cells.nth(4)).toHaveAttribute("data-mark", marks[4]!, { timeout: 15_000 });
  for (let c = 0; c < 5; c++) {
    await expect(cells.nth(c)).toHaveAttribute("data-mark", marks[c]!);
    const want: Record<Mark, string> = { exact: "green", present: "amber", absent: "plain" };
    expect(await hue(cells.nth(c)), `row ${r} place ${c}`).toBe(want[marks[c]!]);
    // What is on top at the cell's centre is its own gem (once a win's burst of gems has flown past).
    await expect.poll(async () => (await painted(cells.nth(c))).gemOnTop, { message: `row ${r} place ${c} shows its gem`, timeout: 4_000 }).toBe(true);
    expect((await painted(cells.nth(c))).w).toBeGreaterThan(44);
  }
}

/** A guess that is wrong in every place but still says something: the code shifted by one colour. */
const wrong = (shift: number) => CODE.map((c) => (c + shift) % 7);

test("Potyro Daily: a whole day — tap, type, crack it, share the grid, and come back to it", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.clock.setFixedTime(DAY);
  const { card } = await addAsMine(page, "daily-puzzle.potyro-app.zip", packApp("daily-puzzle", "daily-puzzle.app.ts"));
  expect(card).not.toMatch(/fetches/); // nothing from the network: it works offline from the first open

  // First visit: how to play, then the empty board.
  const help = page.getByRole("dialog", { name: "How to play" });
  await expect(help).toBeVisible({ timeout: 30_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/daily-help-375-light-en.png` });
  await help.getByRole("button", { name: "Let's play" }).click();
  await expect(help).toHaveCount(0);
  await expect(page.locator(".dp-number")).toContainText(`#${N}`);
  await expect(page.locator(".dp-board .dp-cell")).toHaveCount(30);
  await expect(page.locator(".dp-key")).toHaveCount(7);

  // Check with an empty place is refused, out loud, and the row shakes.
  await key(page, 0).tap();
  await page.getByRole("button", { name: "Check" }).tap();
  await expect(page.locator(".dp-toastline")).toHaveText("Fill all five places first");
  await page.getByRole("button", { name: "Remove" }).tap();
  await expect(rowOf(page, 0).locator(".dp-gem")).toHaveCount(0);

  // Guess 1, by tapping; a place can be picked and changed.
  const g1 = wrong(1);
  for (const c of g1) await key(page, c).tap();
  await rowOf(page, 0).locator(".dp-cell").nth(2).tap();
  await key(page, (g1[2]! + 3) % 7).tap();
  g1[2] = (g1[2]! + 3) % 7;
  await page.getByRole("button", { name: "Check" }).tap();
  await expectRow(page, 0, g1);
  // The palette learnt something: a colour told "not in the code" is struck out — once the row's
  // reveal has played (the keys are painted after it, `paintKeysLater`), so this waits for it.
  await expect.poll(() => page.locator(".dp-key[data-hint]").count(), { timeout: 10_000 }).toBeGreaterThan(0);

  // Guess 2, by keyboard: digits place, Backspace takes back, Enter checks.
  const g2 = wrong(2);
  await page.keyboard.press("1");
  await page.keyboard.press("Backspace");
  for (const c of g2) await page.keyboard.press(String(c + 1));
  await page.keyboard.press("Enter");
  await expectRow(page, 1, g2);
  await expect(page.locator(".dp-toastline")).toContainText("4 tries left");

  // Guess 3: the code.
  for (const c of CODE) await key(page, c).tap();
  await page.getByRole("button", { name: "Check" }).tap();
  await expectRow(page, 2, CODE);
  const result = page.locator(".dp-done");
  await expect(result.getByRole("heading", { name: "Cracked in 3" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".dp-pad")).toBeHidden();
  await expect(page.locator(".dp-flame")).toHaveText("🔥 1");
  const expected = shareText(N, { guesses: [g1, g2, CODE] }, CODE);
  await expect(result.locator(".dp-grid-preview")).toHaveText(expected.split("\n").slice(1).join("\n"));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/daily-won-375-light-en.png` });

  // Share: the shell's dialog shows exactly what goes out; Copy puts it on the clipboard.
  await result.getByRole("button", { name: /Share result/ }).tap();
  const dialog = page.getByRole("dialog", { name: "Send your result" });
  await expect(dialog.getByRole("textbox", { name: "What will be sent" })).toHaveValue(expected);
  expect(expected.split("\n")[0]).toBe(`Potyro Daily #${N} 3/6`);
  if (SHOTS) {
    await expect.poll(() => page.locator(".k-modal-scrim").evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
    await page.screenshot({ path: `${SHOTS}/daily-share-375-light-en.png` });
  }
  await dialog.getByRole("button", { name: "Copy", exact: true }).tap();
  await expect(dialog.getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  await dialog.getByRole("button", { name: "Done" }).tap();
  await expect(page.locator(".dp-toastline")).toHaveText("Sent. Now see if they can beat it.");

  // Come back later: the same board, finished, and the day counted once.
  await page.reload();
  await expect(page.locator(".dp-done").getByRole("heading", { name: "Cracked in 3" })).toBeVisible({ timeout: 30_000 });
  await expectRow(page, 2, CODE);
  await page.locator(".k-tab", { hasText: "Stats" }).first().tap();
  await expect(page.locator(".dp-stats dd")).toHaveText(["1", "100", "1", "1"]);
  await expect(page.locator(".dp-spread li").nth(2)).toHaveAttribute("aria-label", "1 win in 3");
  await expect(page.locator(".dp-past li")).toHaveCount(1);
  await expect(page.locator(".dp-past li").first()).toContainText(`#${N}`);
  await expect(page.locator(".dp-past li").first()).toContainText("3/6");
});

test("Potyro Daily: a practice round does not count, and a lost day shows the code", async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.setFixedTime(DAY);
  await addAsMine(page, "daily-puzzle.potyro-app.zip", packApp("daily-puzzle", "daily-puzzle.app.ts"));
  await page.getByRole("dialog", { name: "How to play" }).getByRole("button", { name: "Let's play" }).click();

  // Six wrong guesses, typed.
  for (let r = 0; r < 6; r++) {
    for (const c of wrong(1 + (r % 6))) await page.keyboard.press(String(c + 1));
    await page.keyboard.press("Enter");
    await expect(rowOf(page, r).locator(".dp-cell").nth(4)).toHaveAttribute("data-mark", /exact|present|absent/, { timeout: 15_000 });
  }
  const result = page.locator(".dp-done");
  await expect(result.getByRole("heading", { name: "So close." })).toBeVisible({ timeout: 10_000 });
  await expect(result.locator(".dp-answer .dp-gem")).toHaveCount(5);
  await expect(result.locator(".dp-grid-preview")).toBeVisible();
  await expect(page.locator(".dp-flame")).toHaveText("🔥 0");

  // Practice: a fresh board, marked as practice; finishing it adds nothing to the stats.
  await result.getByRole("button", { name: /Practice round/ }).click();
  await expect(page.locator(".dp-practice-bar")).toBeVisible();
  await expect(page.locator(".dp-board .dp-gem")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to today" }).click();
  await expect(page.locator(".dp-done").getByRole("heading", { name: "So close." })).toBeVisible();
  await page.locator(".k-tab", { hasText: "Stats" }).first().click();
  await expect(page.locator(".dp-stats dd")).toHaveText(["1", "0", "0", "0"]);
});

// The screenshots for the launch (POTYRO_SHOTS=dir): phone light and dark, desktop, English and Polish.
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
        test.setTimeout(120_000);
        const context = await browser.newContext({ locale, colorScheme: scheme, viewport: { width, height }, hasTouch: width < 600, isMobile: width < 600, deviceScaleFactor: 2 });
        const page = await context.newPage();
        await page.clock.setFixedTime(DAY);
        // Added through the shell in English (the steps are written in its words), then shown as the
        // device asks: the shell follows the device's language once the choice is cleared.
        await page.goto("/");
        await page.evaluate(() => localStorage.setItem("potyro:locale", "en"));
        await addAsMine(page, "daily-puzzle.potyro-app.zip", packApp("daily-puzzle", "daily-puzzle.app.ts"));
        await page.evaluate(() => localStorage.removeItem("potyro:locale"));
        await page.reload();
        await page.locator(".dp-dialog .dp-btn").click({ timeout: 30_000 });
        // Mid-game: two guesses told, a third half placed.
        for (const g of [wrong(1), wrong(3)]) {
          for (const c of g) await page.keyboard.press(String(c + 1));
          await page.keyboard.press("Enter");
          await page.waitForTimeout(1600);
        }
        await page.keyboard.press(String(CODE[0]! + 1));
        await page.keyboard.press(String(CODE[1]! + 1));
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${SHOTS}/daily-play-${width}-${scheme}-${lang}.png` });
        // Then crack it.
        await page.keyboard.press("Backspace");
        await page.keyboard.press("Backspace");
        for (const c of CODE) await page.keyboard.press(String(c + 1));
        await page.keyboard.press("Enter");
        await page.waitForTimeout(2600);
        await page.screenshot({ path: `${SHOTS}/daily-won-${width}-${scheme}-${lang}.png` });
        await context.close();
      });
    }
  }
});
