import { test, expect, type Page } from "./console-guard";

// The board (#107). Recipes' Cookbook puts every recipe in a column by where it stands with you —
// want to try, tried, keeper. Dragging a card to another column moves it; so does "Move to…" in the
// card's menu, which is how a phone moves a card without depending on a drag.

async function openCookbook(page: Page, phone = false): Promise<void> {
  await page.goto("/?user=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
  if (phone) {
    const tab = page.locator(".k-tabbar .k-tab", { hasText: "Cookbook" });
    if (await tab.count()) await tab.first().tap();
    else {
      await page.locator(".k-tabbar").getByRole("button", { name: /More/ }).tap();
      await page.getByRole("menuitem", { name: /Cookbook/ }).tap();
    }
  } else {
    await page.locator(".k-sidenav .k-tab", { hasText: "Cookbook" }).click();
  }
  await expect(page.locator(".k-board")).toBeVisible({ timeout: 30_000 });
}

const column = (page: Page, name: string) => page.locator(`.k-board-col[data-board-column="${name}"]`);

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("columns are the status options with counts; dragging a card moves it and it stays moved", async ({ page }) => {
    await openCookbook(page);
    await expect(page.locator(".k-board-col-title")).toContainText(["want to try", "tried", "keeper"]);
    // The empty column says so and offers to add a recipe that starts there.
    const want = column(page, "want to try");
    await expect(want.getByText("Nothing here")).toBeVisible();
    await expect(want.getByRole("button", { name: /Add/ })).toBeVisible();

    const card = column(page, "tried").locator(".k-board-card", { hasText: "Chicken Caesar" });
    await expect(card).toBeVisible();
    const from = (await card.boundingBox())!;
    const to = (await column(page, "keeper").boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 14 });
    await expect(column(page, "keeper")).toHaveAttribute("data-over", "true");
    await page.mouse.up();

    await expect(column(page, "keeper").locator(".k-board-card", { hasText: "Chicken Caesar" })).toBeVisible();
    await expect(column(page, "tried").locator(".k-board-card")).toHaveCount(0);
    // A drop is not a click: the record did not open.
    await expect(page.locator("article.k-detail")).toHaveCount(0);
    await page.reload();
    await openCookbook(page);
    await expect(column(page, "keeper").locator(".k-board-card", { hasText: "Chicken Caesar" })).toBeVisible();
  });

  test("a card still opens its recipe on a plain click", async ({ page }) => {
    await openCookbook(page);
    await column(page, "keeper").locator(".k-board-card-open").first().click();
    await expect(page.locator("article.k-detail")).toBeVisible();
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("one column at a time, and Move to… moves a card", async ({ page }) => {
    await openCookbook(page, true);
    await expect(page.locator(".k-board")).toHaveAttribute("data-phone", "true");
    // Columns are most of the screen wide, so the next one peeks rather than fitting beside.
    const first = (await page.locator(".k-board-col").first().boundingBox())!;
    expect(first.width).toBeGreaterThan(375 * 0.7);
    await expect(page.locator(".k-board-pager-dot")).toHaveCount(3);

    const tried = column(page, "tried");
    await tried.scrollIntoViewIfNeeded();
    await tried.getByRole("button", { name: "Chicken Caesar: more" }).tap();
    await page.getByRole("menuitem", { name: /Move to want to try/ }).tap();
    await expect(column(page, "want to try").locator(".k-board-card", { hasText: "Chicken Caesar" })).toBeAttached();
    await expect(tried.locator(".k-board-card")).toHaveCount(0);
  });
});
