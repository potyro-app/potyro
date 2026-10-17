import { test, expect, type Page } from "./console-guard";
import { openBoard } from "./board-fixture.js";

// The board (#107): tasks in a column by status — to do, doing, done. Dragging a card to another
// column moves it; so does "Move to…" in the card's menu, which is how a phone moves a card without
// depending on a drag.

const column = (page: Page, name: string) => page.locator(`.k-board-col[data-board-column="${name}"]`);

/** A 64×64 PNG in two colours: a real picture, big enough to press on. */
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAwFBMVEX/pQD8ogL6nwT4nQb2mgj0lwrylQzwkg7ukBDsjRLqihToiBbmhRjkghrigBzgfR7eeyDceCLadSTYcybWcCjUbirSayzQaC7OZjDMYzLKYDTIXjbGWzjEWTrCVjzAUz6+UUG8TkO6S0W4SUe2Rkm0REuyQU2wPk+uPFGsOVOqN1WoNFemMVmkL1uiLF2gKV+eJ2GcJGOaImWYH2eWHGmUGmuSF22QFG+OEnGMD3OKDXWICneGB3mEBXuCAn2AAICs4cErAAAAkklEQVRYw6XBgwEDAADAsM62bdve/v9qRzQBKyARlAhJhCUiElGJmERcIiGRlEhJpCUyElmJnEReoiBRlChJlCUqElWJmkRdoiHRlGhJtCU6El2JnkRfYiAxlBhJjCUmElOJmcRcYiGxlFhJrCU2EluJncRe4iBxlDhJnCUuEleJm8Rd4iHxlHhJvCU+El+Jn/QHWvv4EDQtrq4AAAAASUVORK5CYII=",
  "base64",
);

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("columns are the status options with counts; dragging a card moves it and it stays moved", async ({ page }) => {
    await openBoard(page);
    await expect(page.locator(".k-board-col-title")).toContainText(["to do", "doing", "done"]);
    // Every column has a card (an empty column's words are the views' unit tests' to check:
    // packages/views/test/board.test.tsx).
    const card = column(page, "doing").locator(".k-board-card", { hasText: "Call the plumber" });
    await expect(card).toBeVisible();
    const doing = await column(page, "doing").locator(".k-board-card").count();
    const from = (await card.boundingBox())!;
    const to = (await column(page, "done").boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 14 });
    await expect(column(page, "done")).toHaveAttribute("data-over", "true");
    await page.mouse.up();

    await expect(column(page, "done").locator(".k-board-card", { hasText: "Call the plumber" })).toBeVisible();
    await expect(column(page, "doing").locator(".k-board-card")).toHaveCount(doing - 1);
    // A drop is not a click: the record did not open.
    await expect(page.locator("article.k-detail")).toHaveCount(0);
    await page.reload();
    await expect(column(page, "done").locator(".k-board-card", { hasText: "Call the plumber" })).toBeVisible({ timeout: 30_000 });
  });

  // A card's photo is part of the card, not a picture to drag out of the page. Pressed on, an <img>
  // started the browser's own image drag, and the board's drag never armed — so a card with a photo
  // could not be moved with a mouse, by the very part of it a person reaches for.
  test("a card with a photo moves when it is dragged BY the photo", async ({ page }) => {
    await openBoard(page);
    await column(page, "doing").locator(".k-board-card", { hasText: "Water the plants" }).locator(".k-board-card-open").click();
    await expect(page.locator("article.k-detail")).toBeVisible();
    // A record with no actions of its own: Edit is its one button.
    await page.locator(".k-detail-actions").getByRole("button", { name: "Edit" }).click();
    const form = page.locator(".k-modal");
    await form.locator("input[type=file]").first().setInputFiles({ name: "plant.png", mimeType: "image/png", buffer: PHOTO });
    await expect(form.locator(".k-media-tile img")).toBeVisible();
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(form).toBeHidden();

    await page.getByRole("button", { name: "Back" }).first().click();
    await openBoard(page);
    const card = column(page, "doing").locator(".k-board-card", { hasText: "Water the plants" });
    const photo = card.locator(".k-board-thumb");
    await expect(photo).toBeVisible();
    const from = (await photo.boundingBox())!;
    const to = (await column(page, "done").boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 14 });
    await expect(column(page, "done")).toHaveAttribute("data-over", "true");
    await page.mouse.up();
    await expect(column(page, "done").locator(".k-board-card", { hasText: "Water the plants" })).toBeVisible();
  });

  test("a card still opens its record on a plain click", async ({ page }) => {
    await openBoard(page);
    await column(page, "done").locator(".k-board-card-open").first().click();
    await expect(page.locator("article.k-detail")).toBeVisible();
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("one column at a time, and Move to… moves a card", async ({ page }) => {
    await openBoard(page);
    await expect(page.locator(".k-board")).toHaveAttribute("data-phone", "true");
    // Columns are most of the screen wide, so the next one peeks rather than fitting beside.
    const first = (await page.locator(".k-board-col").first().boundingBox())!;
    expect(first.width).toBeGreaterThan(375 * 0.7);
    await expect(page.locator(".k-board-pager-dot")).toHaveCount(3);

    const doing = column(page, "doing");
    await doing.scrollIntoViewIfNeeded();
    await expect(doing.locator(".k-board-card", { hasText: "Call the plumber" })).toBeAttached();
    const before = await doing.locator(".k-board-card").count();
    await doing.getByRole("button", { name: "Call the plumber: more" }).tap();
    await page.getByRole("menuitem", { name: /Move to to do/ }).tap();
    await expect(column(page, "to do").locator(".k-board-card", { hasText: "Call the plumber" })).toBeAttached();
    await expect(doing.locator(".k-board-card")).toHaveCount(before - 1);
  });
});
