import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installQuestions } from "./ui-questions.js";

// ctx.ui grows the structured questions (#112): a form for several values, a sheet or a menu for a
// short choice, a progress bar, and a confirm whose button says what it does. Workout uses the form
// to log a set and the sheet to finish a workout; a small fixture covers the menu and the progress.

const SHOTS = process.env.KARTA_SHOTS;
const A11Y = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const violations = async (page: Page, selector: string) =>
  (await new AxeBuilder({ page }).include(selector).withTags(A11Y).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`);

async function openYesterdaysSession(page: Page, phone: boolean): Promise<void> {
  await page.clock.setFixedTime(new Date(2026, 8, 9, 12, 0, 0));
  await page.goto("/?user=workout");
  await expect(page.locator("h1").first()).toHaveText("PPL Log", { timeout: 30_000 });
  if (phone) await page.locator(".k-tabbar .k-tab", { hasText: "History" }).first().tap();
  else await page.locator(".k-sidenav .k-tab", { hasText: "History" }).click();
  await page.locator(".k-tl-card").first().click();
  await expect(page.locator("article.k-detail")).toBeVisible();
}

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("Log set asks in one form, starts from the last set, and adds the set to the session", async ({ page }) => {
    await openYesterdaysSession(page, true);
    await page.getByRole("button", { name: "Log set" }).tap();
    const form = page.getByRole("dialog", { name: "Log set" });
    await expect(form).toBeVisible();
    // The last set of this session was Overhead Press, 42.5 kg × 6.
    await expect(form.getByRole("button", { name: /Exercise: Overhead Press/ })).toBeVisible();
    await expect(form.getByRole("spinbutton", { name: "Weight" })).toHaveValue("42.5");
    await expect(form.getByRole("spinbutton", { name: "Reps" })).toHaveValue("6");
    await form.getByRole("button", { name: "Increase Reps" }).tap();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ui-form-phone.png` });
    await form.getByRole("button", { name: "Log set" }).tap();
    await expect(form).toHaveCount(0);
    await expect(page.locator(".k-toast")).toHaveText("Logged 42.5 kg × 7");
    await expect(page.locator(".k-detail")).toContainText("42.5 kg · 7");
  });

  test("a delete confirm is a bottom sheet whose button says Delete, in the danger colour", async ({ page }) => {
    await openYesterdaysSession(page, true);
    await page.getByRole("button", { name: "More actions" }).tap();
    await page.getByRole("menuitem", { name: /Delete/ }).tap();
    const dialog = page.locator(".k-dialog");
    await expect(dialog).toContainText("can't be undone");
    await expect.poll(async () => (await dialog.evaluate((el) => el.getAnimations().length))).toBe(0);
    const box = (await dialog.boundingBox())!;
    expect(Math.abs(box.y + box.height - 844)).toBeLessThan(2);
    await expect(dialog.getByRole("button", { name: "Delete" })).toHaveClass(/k-dialog-destructive/);
    expect(await violations(page, ".k-dialog")).toEqual([]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ui-confirm-phone.png` });
    await dialog.getByRole("button", { name: "Cancel" }).tap();
    await expect(page.locator("article.k-detail")).toBeVisible();
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Finish asks with a sheet: the destructive choice last and red, keys walk it, Escape keeps training", async ({ page }) => {
    await page.goto("/?user=workout");
    await page.locator(".k-sidenav .k-tab", { hasText: "Train" }).click();
    await page.getByRole("button", { name: /Start push workout/ }).click();
    await page.getByRole("button", { name: "Finish" }).click();

    const sheet = page.getByRole("menu", { name: "Finish workout?" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("menuitem")).toHaveText([/Save and finish/, /Keep training/, /Discard workout/]);
    await expect(sheet.getByRole("menuitem").last()).toHaveClass(/k-danger/);
    await expect(sheet.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(sheet.getByRole("menuitem", { name: /Discard workout/ })).toBeFocused();
    expect(await violations(page, ".k-choice")).toEqual([]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ui-sheet-desktop.png` });
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Finish" })).toBeVisible(); // still training

    await page.getByRole("button", { name: "Finish" }).click();
    await page.getByRole("menuitem", { name: /Discard workout/ }).click();
    await expect(page.getByRole("button", { name: /Start push workout/ })).toBeVisible();
  });

  test("a menu hangs under the button that ran the action; progress shows while the action runs", async ({ page }) => {
    await installQuestions(page, true);
    const button = page.getByRole("button", { name: "Recolour" });
    await button.click();
    const menu = page.getByRole("menu", { name: "Colour" });
    await expect(menu).toBeVisible();
    const b = (await button.boundingBox())!;
    const m = (await menu.boundingBox())!;
    expect(Math.abs(m.y - (b.y + b.height + 6))).toBeLessThan(2);
    expect(Math.abs(m.x - b.x)).toBeLessThan(2);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ui-menu-desktop.png` });
    await menu.getByRole("menuitem", { name: /Green/ }).click();
    await expect(page.locator(".k-detail")).toContainText("green");

    await page.getByRole("button", { name: "Import demo" }).click();
    const bar = page.getByRole("progressbar", { name: "Importing notes" });
    await expect(bar).toHaveAttribute("aria-valuenow", "50");
    await expect(page.locator(".k-progress")).toContainText("2 of 4");
    await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(bar).toHaveCount(0);
    await expect(page.locator(".k-toast")).toHaveText("Imported");
  });

  test("a form checks required fields and returns typed values; a bad field is the app's error", async ({ page }) => {
    await installQuestions(page, true);
    await page.getByRole("button", { name: "Quick note" }).click();
    const form = page.getByRole("dialog", { name: "Quick note" });
    await form.getByRole("button", { name: "Add note" }).click();
    await expect(form.locator(".k-form-field-error")).toHaveText("Required");
    await form.getByRole("textbox").fill("Buy chalk");
    await form.getByRole("switch", { name: /Pinned/ }).click();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ui-form-desktop.png` });
    await form.getByRole("button", { name: "Add note" }).click();
    await expect(page.locator(".k-toast")).toHaveText("Added Buy chalk (green, pinned)");

    await page.getByRole("button", { name: "Bad form" }).click();
    await expect(page.locator(".k-toast").last()).toContainText('ui.form field "when"');
  });
});
