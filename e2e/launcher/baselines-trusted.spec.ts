import { test, expect, type Page } from "../console-guard";
import { tileAction } from "../launcher-actions.js";
import { openApp, openHome, openSwitcher, pinFonts, seed } from "./fixture.js";

// Screenshot baselines for the launcher (#94): home (empty and seeded), the in-app switcher and the
// tile menu, at 375 / 768 / 1440, in light and dark. Chromium only, one worker (the suite's rule).
//
// A baseline is a claim about the pixels: a change that moves them is a change somebody has to
// look at. The two themes are identical until #92 lands a dark palette: that is the point of
// taking them now — #92's PR is the one that changes the dark set, and only the dark set.
//
// The pixels are CI's. Two Linux machines with the same Chromium and the same fonts still do not
// agree: glyph hinting differs by a few hundred pixels per page, and a classic scrollbar on one
// shifts a whole layout that overlay scrollbars on the other leave alone. So the baselines are
// rendered on the CI runner, the comparison runs there (or here on request, `POTYRO_BASELINES=1`),
// and the "Launcher baselines" workflow regenerates them after a change you meant. The rest of the
// harness runs everywhere.

test.skip(!process.env.CI && !process.env.POTYRO_BASELINES, "baselines are CI's pixels — set POTYRO_BASELINES=1 to compare here");

const WIDTHS = [375, 768, 1440] as const;
const THEMES = ["light", "dark"] as const;

/** Wait out every running animation and pin the form's scroll, so the pixels are reproducible. */
async function settle(page: Page): Promise<void> {
  await page.locator(".k-modal").evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))).then(() => undefined),
  );
  const body = page.locator(".k-form-body");
  if (await body.count()) await body.evaluate((el) => el.scrollTo(0, 0));
}

const shot = (page: Page, name: string) =>
  expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: false,
    // Antialiasing wobble between Chromium builds is a few dozen pixels; a 1px padding change on a
    // grid of tiles is thousands.
    maxDiffPixels: 120,
  });

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`${width}px ${theme}`, () => {
      test.use({ viewport: { width, height: width < 500 ? 812 : 900 }, colorScheme: theme, isMobile: width < 500, hasTouch: width < 500 });

      test("home, empty", async ({ page }) => {
        await seed(page, []);
        await openHome(page);
        await pinFonts(page);
        await shot(page, `home-empty-${width}-${theme}`);
      });

      test("home, seeded", async ({ page }) => {
        await seed(page);
        await openHome(page);
        await pinFonts(page);
        await shot(page, `home-${width}-${theme}`);
      });

      test("tile menu", async ({ page }) => {
        await seed(page);
        await openHome(page);
        await pinFonts(page);
        await page.getByRole("button", { name: "Actions for Groceries" }).click();
        await expect(page.getByRole("menu")).toBeVisible();
        await shot(page, `tile-menu-${width}-${theme}`);
      });

      test("switcher", async ({ page }) => {
        await seed(page);
        await openApp(page, "groceries", "Groceries");
        await pinFonts(page);
        await openSwitcher(page);
        await shot(page, `switcher-${width}-${theme}`);
      });
    });
  }
}

// The Plants form (#97): the switch rows, and from here on every form control the forms epic lands.
// Baselined at both ends in both schemes; it is the harness's file so one workflow regenerates it.
for (const width of [375, 1440] as const) {
  for (const theme of THEMES) {
    test.describe(`plants form ${width}px ${theme}`, () => {
      test.use({ viewport: { width, height: width < 500 ? 812 : 900 }, colorScheme: theme, isMobile: width < 500, hasTouch: width < 500 });

      test("plants form", async ({ page }) => {
        await seed(page, []);
        await page.goto("/?user=plants");
        await expect(page.locator("h1").first()).toHaveText("Plants", { timeout: 30_000 });
        await pinFonts(page);
        // The entity form. On a desktop its quick action is in the sidebar; on a phone the top bar's +
        // is the page's own add (a photo flow, #383/#384), and the kind's is in the More menu.
        if (width < 500) {
          await page.getByRole("button", { name: "More", exact: true }).click();
          await page.getByRole("menu", { name: "More" }).getByRole("menuitem", { name: /Add: Plant/ }).click();
        } else {
          await page.getByRole("button", { name: "Add: Plant" }).click();
        }
        await expect(page.locator(".k-form")).toBeVisible();
        // Shoot the form where it lands, not where it is passing through: the sheet slides in, and
        // focusing the first field can leave the body scrolled by a few pixels. Both made the same
        // form render two different sets of pixels on two runs of the same commit.
        await settle(page);
        await shot(page, `plants-form-${width}-${theme}`);
      });
    });
  }
}

// The share dialog needs the relay and a few seconds of sync per shot, so it is baselined at the
// two ends only, in light.
for (const width of [375, 1440] as const) {
  test.describe(`share dialog ${width}px`, () => {
    test.use({ viewport: { width, height: width < 500 ? 812 : 900 }, isMobile: width < 500, hasTouch: width < 500 });

    test("share dialog", async ({ page }) => {
      await seed(page);
      await openHome(page);
      await pinFonts(page);
      await tileAction(page, "Tasks", "share"); // already synced: straight to the name, then the link
      const nameDialog = page.locator(".k-dialog", { hasText: "see you as" });
      const shareDialog = page.locator(".k-share-dialog");
      await expect(nameDialog.or(shareDialog).first()).toBeVisible({ timeout: 60_000 });
      if (await nameDialog.count()) {
        await nameDialog.locator("input").fill("Vasco");
        await nameDialog.getByRole("button", { name: "OK" }).click();
      }
      await expect(shareDialog).toBeVisible({ timeout: 60_000 });
      await expect(shareDialog.getByRole("textbox", { name: "Share link" })).toHaveValue(/#join=/);
      // The link differs every run; the field is masked so the baseline is the dialog, not the key.
      await expect(page).toHaveScreenshot(`share-dialog-${width}-light.png`, { maxDiffPixels: 120, mask: [shareDialog.getByRole("textbox", { name: "Share link" })] });
    });
  });
}
