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

/** A 64×64 PNG in two colours: a real picture, big enough to press on. */
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAwFBMVEX/pQD8ogL6nwT4nQb2mgj0lwrylQzwkg7ukBDsjRLqihToiBbmhRjkghrigBzgfR7eeyDceCLadSTYcybWcCjUbirSayzQaC7OZjDMYzLKYDTIXjbGWzjEWTrCVjzAUz6+UUG8TkO6S0W4SUe2Rkm0REuyQU2wPk+uPFGsOVOqN1WoNFemMVmkL1uiLF2gKV+eJ2GcJGOaImWYH2eWHGmUGmuSF22QFG+OEnGMD3OKDXWICneGB3mEBXuCAn2AAICs4cErAAAAkklEQVRYw6XBgwEDAADAsM62bdve/v9qRzQBKyARlAhJhCUiElGJmERcIiGRlEhJpCUyElmJnEReoiBRlChJlCUqElWJmkRdoiHRlGhJtCU6El2JnkRfYiAxlBhJjCUmElOJmcRcYiGxlFhJrCU2EluJncRe4iBxlDhJnCUuEleJm8Rd4iHxlHhJvCU+El+Jn/QHWvv4EDQtrq4AAAAASUVORK5CYII=",
  "base64",
);

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("columns are the status options with counts; dragging a card moves it and it stays moved", async ({ page }) => {
    await openCookbook(page);
    await expect(page.locator(".k-board-col-title")).toContainText(["want to try", "tried", "keeper"]);
    // The sample cookbook has a card in every column (an empty column's words are the views' unit
    // tests' to check: packages/views/test/board.test.tsx).
    const card = column(page, "tried").locator(".k-board-card", { hasText: "Chicken Caesar" });
    await expect(card).toBeVisible();
    const tried = await column(page, "tried").locator(".k-board-card").count();
    const from = (await card.boundingBox())!;
    const to = (await column(page, "keeper").boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 14 });
    await expect(column(page, "keeper")).toHaveAttribute("data-over", "true");
    await page.mouse.up();

    await expect(column(page, "keeper").locator(".k-board-card", { hasText: "Chicken Caesar" })).toBeVisible();
    await expect(column(page, "tried").locator(".k-board-card")).toHaveCount(tried - 1);
    // A drop is not a click: the record did not open.
    await expect(page.locator("article.k-detail")).toHaveCount(0);
    await page.reload();
    await openCookbook(page);
    await expect(column(page, "keeper").locator(".k-board-card", { hasText: "Chicken Caesar" })).toBeVisible();
  });

  // A card's photo is part of the card, not a picture to drag out of the page. Pressed on, an <img>
  // started the browser's own image drag, and the board's drag never armed — so a card with a photo
  // could not be moved with a mouse, by the very part of it a person reaches for.
  test("a card with a photo moves when it is dragged BY the photo", async ({ page }) => {
    await page.goto("/?user=recipes");
    await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
    await page.locator(".k-card", { hasText: "Chicken Caesar" }).first().click();
    await expect(page.locator("article.k-detail")).toBeVisible();
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const form = page.locator(".k-modal");
    await form.locator("input[type=file]").first().setInputFiles({ name: "dish.png", mimeType: "image/png", buffer: PHOTO });
    await expect(form.locator(".k-media-tile img")).toBeVisible();
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(form).toBeHidden();

    await openCookbook(page);
    const card = column(page, "tried").locator(".k-board-card", { hasText: "Chicken Caesar" });
    const photo = card.locator(".k-board-thumb");
    await expect(photo).toBeVisible();
    const from = (await photo.boundingBox())!;
    const to = (await column(page, "keeper").boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 14 });
    await expect(column(page, "keeper")).toHaveAttribute("data-over", "true");
    await page.mouse.up();
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
    await expect(tried.locator(".k-board-card", { hasText: "Chicken Caesar" })).toBeAttached();
    const before = await tried.locator(".k-board-card").count();
    await tried.getByRole("button", { name: "Chicken Caesar: more" }).tap();
    await page.getByRole("menuitem", { name: /Move to want to try/ }).tap();
    await expect(column(page, "want to try").locator(".k-board-card", { hasText: "Chicken Caesar" })).toBeAttached();
    await expect(tried.locator(".k-board-card")).toHaveCount(before - 1);
  });
});
