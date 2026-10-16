import { test, expect } from "../console-guard";
import { useStart } from "./fixture.js";
import AxeBuilder from "@axe-core/playwright";

// The Tiles home screen (the Start style), chosen in Look; Classic is the default (#96).
test.beforeEach(async ({ page }) => {
  await useStart(page);
});

// First run and the create action (#90), on the Start screen (#96). A device that has never opened an
// app is told what Potyro is and offered one thing to do; the examples are tiles on the wall below,
// grouped as Everyday. "New app" is one control — the app bar's — never a tile among the apps.

const SHOTS = process.env.POTYRO_SHOTS;

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("first run: a welcome with one primary action above the fold, then the examples; Not now sticks", async ({ page }) => {
    await page.goto("/");
    const home = page.locator(".k-launcher-home");
    const welcome = home.getByRole("region", { name: "Make the app you need" });
    await expect(welcome).toBeVisible({ timeout: 30_000 });
    const primary = welcome.getByRole("button", { name: "Describe an app" });
    expect((await primary.boundingBox())!.y + 44).toBeLessThan(812);
    // The examples arrive as Potyro proposes them: one Everyday group.
    await expect(home.getByRole("region", { name: "Everyday" })).toBeVisible({ timeout: 30_000 });
    // Exactly one New app control on screen, and it is the app bar's.
    await expect(page.getByRole("button", { name: /New app/ }).filter({ visible: true })).toHaveCount(1);
    await expect(page.locator(".k-metro-bar .k-launch-newbtn")).toBeVisible();
    await expect(home.locator(".k-launch-tile", { hasText: "New app" })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include(".k-welcome").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.map((v) => v.id)).toEqual([]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/first-run-phone.png` });

    await welcome.getByRole("button", { name: "Not now" }).tap();
    await expect(welcome).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".k-launch-tile", { hasText: "Recipes" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("region", { name: "Make the app you need" })).toHaveCount(0);
  });

  test("the welcome's action and the app bar's New app both open the Studio", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Describe an app" }).tap();
    await expect(page.getByRole("dialog", { name: "App studio" })).toBeVisible({ timeout: 30_000 });
  });

  test("the app bar offers New app and, beside it, Add an app (#253)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Add an app" }).tap();
    await expect(page.getByRole("dialog", { name: "Add an app" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).tap();
    await page.locator(".k-launch-newbtn").tap();
    await expect(page.getByRole("dialog", { name: "App studio" })).toBeVisible({ timeout: 30_000 });
  });

  test("once an app has been opened, home is the wall and the app bar", async ({ page }) => {
    await page.goto("/?app=recipes");
    await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
    await page.goto("/");
    await expect(page.locator(".k-launch-tile", { hasText: "Recipes" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("region", { name: "Make the app you need" })).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/home-phone.png` });
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("New app sits in the header's row, not floating over the wall", async ({ page }) => {
    await page.goto("/");
    const newApp = page.locator(".k-launch-newbtn");
    await expect(newApp).toBeVisible({ timeout: 30_000 });
    expect((await newApp.boundingBox())!.y).toBeLessThan(200);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/first-run-desktop.png` });
    await newApp.click();
    await expect(page.getByRole("dialog", { name: "App studio" })).toBeVisible({ timeout: 30_000 });
  });
});
