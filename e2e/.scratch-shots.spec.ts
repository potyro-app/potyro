// SCRATCH (uncommitted, #303): 375 px screenshots in Polish and German.
import { test, expect, type Page } from "@playwright/test";

const OUT = "/tmp/claude-1000/-home-aivuk-appinator/fd384e0b-36a6-4cc9-9664-11de67510d7a/scratchpad/i18n-303";

async function go(page: Page, words: RegExp): Promise<void> {
  const tab = page.locator(".k-tabbar .k-tab", { hasText: words });
  if (await tab.count()) await tab.first().click();
  else {
    await page.locator(".k-tabbar").getByRole("button", { name: /More/ }).click();
    await page.getByRole("menuitem", { name: words }).click();
  }
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

const WORDS = {
  pl: { cookbook: /Książka kucharska/, train: /Trenuj/, add: /Dodaj wydatek/, today: /Dziś/, progress: /Postępy/, start: /Zacznij trening/ },
  de: { cookbook: /Kochbuch/, train: /Trainieren/, add: /Ausgabe hinzufügen/, today: /Heute/, progress: /Fortschritt/, start: /Training starten/ },
} as const;

for (const lang of ["pl", "de"] as const) {
  test.describe(lang, () => {
    test.use({ locale: lang === "pl" ? "pl-PL" : "de-DE", viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
    const w = WORDS[lang];

    test(`plants today ${lang}`, async ({ page }) => {
      await page.goto("/?user=plants");
      await expect(page.locator(".k-aggregate").first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(800);
      await shot(page, `${lang}-plants-today`);
    });

    test(`recipes board ${lang}`, async ({ page }) => {
      await page.goto("/?user=recipes");
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });
      await go(page, w.cookbook);
      await page.waitForTimeout(1200);
      await shot(page, `${lang}-recipes-board`);
    });

    test(`split form ${lang}`, async ({ page }) => {
      await page.goto("/?user=split");
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });
      // The group picker opens on first run: choose the seeded one.
      const flat = page.getByText("Flat", { exact: true }).first();
      if (await flat.isVisible().catch(() => false)) await flat.click();
      await page.waitForTimeout(800);
      await shot(page, `${lang}-split-expenses`);
      await page.getByRole("button", { name: w.add }).first().click();
      await page.waitForTimeout(1200);
      await shot(page, `${lang}-split-form`);
    });

    test(`workout train ${lang}`, async ({ page }) => {
      await page.goto("/?user=workout");
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });
      await go(page, w.train);
      await expect(page.locator(".wk-start-title")).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(800);
      await shot(page, `${lang}-workout-start`);
      await page.locator(".wk-start-btn").click();
      await page.waitForTimeout(800);
      await shot(page, `${lang}-workout-active`);
      await page.locator(".wk-finish").click();
      await page.waitForTimeout(800);
      await shot(page, `${lang}-workout-finish-sheet`);
    });

    test(`workout progress ${lang}`, async ({ page }) => {
      await page.goto("/?user=workout");
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });
      await go(page, w.progress);
      await page.waitForTimeout(1500);
      await shot(page, `${lang}-workout-progress`);
    });
  });
}
