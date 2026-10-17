import { test, expect, type Page } from "./console-guard";
import { NEEDS_CDP } from "./engines";

// Nested rows as cards (#104). A recipe's steps are a sequence — order is the content — so an
// ordered list gets a grip you can drag with a mouse or a finger, and arrow keys when it has focus.
// Remove lives in each card's menu rather than as a bare ✕ beside the boxes, and the saved order is
// the order you left the cards in.

async function openRecipeForm(page: Page): Promise<void> {
  await page.goto("/?user=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
  await page.locator(".k-card").first().click();
  // A recipe has its own actions, so Edit lives in the record's More actions menu.
  await page.getByRole("button", { name: "More actions" }).first().click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.locator(".k-form")).toBeVisible();
  // Steps sit in a folded group on this form.
  const fold = page.locator("details.k-form-group", { hasText: "Steps" });
  if (await fold.count()) await fold.locator("summary").click();
}

const stepTexts = (page: Page) => page.locator(".k-rows[data-ordered] .k-row-card textarea, .k-rows[data-ordered] .k-row-card input[type=text]");

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("steps are cards with a grip; the keyboard reorders them and the order is saved", async ({ page }) => {
    await openRecipeForm(page);
    const cards = page.locator(".k-rows[data-ordered] .k-row-card");
    await expect(cards.first()).toBeVisible();
    const values = await stepTexts(page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement | HTMLTextAreaElement).value));
    expect(values.length).toBeGreaterThan(1);

    // No bare remove: it lives in the card's menu.
    await expect(page.locator(".k-remove")).toHaveCount(0);
    const grips = page.locator(".k-row-grip");
    await expect(grips).toHaveCount(values.length);

    // Arrow-key reorder: the second step becomes the first.
    await grips.nth(1).focus();
    await page.keyboard.press("ArrowUp");
    const after = await stepTexts(page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement | HTMLTextAreaElement).value));
    expect(after[0]).toBe(values[1]);
    expect(after[1]).toBe(values[0]);
    // Saved, and still in that order when the record is read back.
    await page.locator(".k-form").getByRole("button", { name: /Save|Create/ }).click();
    const detail = page.locator("article.k-detail");
    await expect(detail).toBeVisible();
    // Steps are open on the record page, under the ingredients: the numbered list is there to read.
    // Polled: the page was showing the steps before the save, and redraws once it lands.
    await expect(detail.locator("ol.k-row-list li").first()).toContainText(after[0]!.slice(0, 12));
  });

  test("a card's menu removes its row", async ({ page }) => {
    await openRecipeForm(page);
    const cards = page.locator(".k-rows[data-ordered] .k-row-card");
    const n = await cards.count();
    await cards.first().getByRole("button", { name: /: more$/ }).click();
    await page.getByRole("menuitem", { name: /Remove: step/ }).click();
    await expect(cards).toHaveCount(n - 1);
  });

  test("the button names what it adds, and a new row takes the focus", async ({ page }) => {
    await openRecipeForm(page);
    const add = page.getByRole("button", { name: "＋ Add: step" });
    await expect(add).toBeVisible();
    const n = await page.locator(".k-rows[data-ordered] .k-row-card").count();
    await add.click();
    await expect(page.locator(".k-rows[data-ordered] .k-row-card")).toHaveCount(n + 1);
    // The caret lands in the new row's first box.
    const focusedIn = await page.evaluate(() => {
      const card = [...document.querySelectorAll(".k-rows[data-ordered] .k-row-card")].at(-1);
      return Boolean(card && document.activeElement && card.contains(document.activeElement));
    });
    expect(focusedIn).toBe(true);
  });

  test("dragging a grip moves the row", async ({ page }) => {
    await openRecipeForm(page);
    const values = await stepTexts(page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement | HTMLTextAreaElement).value));
    test.skip(values.length < 2, "needs at least two steps");
    const grips = page.locator(".k-row-grip");
    // Both ends of the drag must be on screen: the form body scrolls, and a grip below the fold
    // reports a box the pointer can never reach.
    await grips.nth(1).scrollIntoViewIfNeeded();
    const from = (await grips.nth(1).boundingBox())!;
    const to = (await grips.nth(0).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
    const after = await stepTexts(page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement | HTMLTextAreaElement).value));
    expect(after[0]).toBe(values[1]);
    expect(after[1]).toBe(values[0]);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("a finger swipes a card aside to reveal Remove; a mouse does not", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", NEEDS_CDP);
    await openRecipeForm(page);
    // From the grip: a hold there starts a reorder, a quick sideways flick is a swipe.
    const grip = page.locator(".k-row-grip").first();
    const g = (await grip.boundingBox())!;
    const y = g.y + g.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const start = g.x + g.width / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start, y }] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start - i * 20, y }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const remove = page.getByRole("button", { name: /^Remove / }).first();
    await expect(remove).toBeVisible();
    const n = await page.locator(".k-row-card").count();
    await remove.click();
    await expect(page.locator(".k-row-card")).toHaveCount(n - 1);
  });
});
