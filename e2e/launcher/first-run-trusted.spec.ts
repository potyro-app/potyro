import { test, expect } from "../console-guard";
import AxeBuilder from "@axe-core/playwright";

// First run and the create action (#90). A device that has never opened an app is told what Potyro is
// and offered one thing to do; the apps are examples to try. "New app" is one control — a header
// button on a wide screen, a floating button on a phone — never a tile among the apps.

const SHOTS = process.env.POTYRO_SHOTS;

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("first run: a welcome with one primary action above the fold, then examples; Not now sticks", async ({ page }) => {
    await page.goto("/");
    const home = page.locator(".k-launcher-home");
    const welcome = home.getByRole("region", { name: "Make the app you need" });
    await expect(welcome).toBeVisible({ timeout: 30_000 });
    const primary = welcome.getByRole("button", { name: "Describe an app" });
    expect((await primary.boundingBox())!.y + 44).toBeLessThan(812);
    await expect(home.locator(".k-launch-title").last()).toHaveText("Examples to try");
    // Exactly one New app control on screen, and it is the floating one.
    await expect(page.getByRole("button", { name: /New app/ }).filter({ visible: true })).toHaveCount(1);
    await expect(page.locator(".k-launch-fab")).toBeVisible();
    await expect(home.locator(".k-launch-tile", { hasText: "New app" })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include(".k-welcome").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.map((v) => v.id)).toEqual([]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/first-run-phone.png` });

    await welcome.getByRole("button", { name: "Not now" }).tap();
    await expect(welcome).toHaveCount(0);
    await expect(home.locator(".k-launch-title").last()).toHaveText("Apps");
    await page.reload();
    await expect(page.locator(".k-launch-tile", { hasText: "Recipes" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("region", { name: "Make the app you need" })).toHaveCount(0);
  });

  test("the welcome's action and the floating button both open the Studio", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Describe an app" }).tap();
    await expect(page.getByRole("dialog", { name: "App studio" })).toBeVisible({ timeout: 30_000 });
  });

  test("the floating New app offers to describe one or add one someone sent (#253)", async ({ page }) => {
    await page.goto("/");
    await page.locator(".k-launch-fab").tap();
    await page.getByRole("menuitem", { name: /Add an app someone sent you/ }).tap();
    await expect(page.getByRole("dialog", { name: "Add an app" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).tap();
    await page.locator(".k-launch-fab").tap();
    await page.getByRole("menuitem", { name: /Describe a new app/ }).tap();
    await expect(page.getByRole("dialog", { name: "App studio" })).toBeVisible({ timeout: 30_000 });
  });

  test("once an app has been opened, home is the apps and the floating New app", async ({ page }) => {
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

  test("New app is a header button, not a floating one", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".k-launch-newbtn")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".k-launch-fab")).toBeHidden();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/first-run-desktop.png` });
    await page.locator(".k-launch-newbtn").click();
    await expect(page.getByRole("dialog", { name: "App studio" })).toBeVisible({ timeout: 30_000 });
  });
});
