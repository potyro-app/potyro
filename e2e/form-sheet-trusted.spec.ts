import { test, expect, type Page } from "./console-guard";
import AxeBuilder from "@axe-core/playwright";

// The form's surface (#101). On a phone it is a full-screen sheet with the actions in a footer that
// stays put while the fields scroll — the Save button of a tall form used to be 400px below the
// fold. On a wide screen the modal is capped at the viewport with the same footer. Focus goes to
// the first field, stays inside, and returns to the opener; a nested create is a second sheet.

const TWENTY = `import { defineApp } from "potyro";
export default defineApp({
  id: "tall",
  name: "Tall",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    thing: {
      label: "Thing",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
${Array.from({ length: 19 }, (_, i) => `        field${i + 1}: { type: "text" },`).join("\n")}
      },
    },
  },
  pages: [{ id: "all", title: "Things", view: { type: "list", entity: "thing", display: { primary: "name" } } }],
});
`;

async function seedTall(page: Page): Promise<void> {
  await page.addInitScript((source: string) => {
    if (localStorage.getItem("potyro:user-apps")) return;
    localStorage.setItem(
      "potyro:user-apps",
      JSON.stringify([{ id: "tall", name: "Tall", source, trusted: true, updatedAt: new Date().toISOString() }]),
    );
  }, TWENTY);
}

const inside = (box: { x: number; y: number; width: number; height: number }, vp: { width: number; height: number }): boolean =>
  box.y >= 0 && box.x >= 0 && box.y + box.height <= vp.height && box.x + box.width <= vp.width;

/** Resolves once the sheet's open animation has finished, so boxes are the final ones. */
async function settled(dialog: import("@playwright/test").Locator): Promise<void> {
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))).then(() => undefined));
}

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("Places: the Create button is on screen when the form opens and after scrolling to the end", async ({ page }) => {
    await page.goto("/?user=places");
    await expect(page.locator("h1").first()).toHaveText("Places", { timeout: 30_000 });
    // Places lands on the Map, and a map page adds inline (you arm placement and tap), so the shell
    // drops the floating quick action there rather than showing two buttons for one act. The list is
    // where adding is still a button, and a form opened from it is the same sheet either way.
    await page.getByRole("tab", { name: "All places" }).or(page.getByRole("button", { name: "All places" })).first().click();
    await page.getByRole("button", { name: "Add: Place" }).click();
    const dialog = page.getByRole("dialog", { name: "Add: Place" });
    await expect(dialog).toBeVisible();
    // The sheet slides up when it opens; measure where it lands, not where it is passing through.
    await settled(dialog);
    const create = dialog.getByRole("button", { name: "Create" });
    expect(inside((await create.boundingBox())!, page.viewportSize()!)).toBe(true);
    // The body scrolls; the footer does not move.
    const body = dialog.locator(".k-form-body");
    await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    expect(inside((await create.boundingBox())!, page.viewportSize()!)).toBe(true);
    // The sheet is the whole screen, the Close a 44px target.
    const sheet = (await dialog.boundingBox())!;
    expect(sheet.width).toBe(375);
    expect(Math.round(sheet.height)).toBe(812);
    const close = (await dialog.getByRole("button", { name: "Close" }).boundingBox())!;
    expect(Math.round(Math.min(close.width, close.height))).toBeGreaterThanOrEqual(44);
  });

  test("a swipe down on the header closes an untouched form", async ({ page }) => {
    await page.goto("/?user=plants");
    await expect(page.locator("h1").first()).toHaveText("Plants", { timeout: 30_000 });
    // Today's one big button is "Add a plant"; the Plants list has the floating form button.
    await page.locator(".k-tabbar .k-tab", { hasText: "Plants" }).tap();
    await page.getByRole("button", { name: "Add: Plant" }).click();
    const dialog = page.getByRole("dialog", { name: "Add: Plant" });
    await expect(dialog).toBeVisible();
    await settled(dialog);
    const head = (await dialog.locator(".k-form-head").boundingBox())!;
    const x = head.x + head.width / 2;
    const y = head.y + head.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + i * 25 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(dialog).toHaveCount(0);
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a twenty-field form never exceeds the viewport; the footer stays visible", async ({ page }) => {
    await seedTall(page);
    await page.goto("/?user=tall");
    await expect(page.locator("h1").first()).toHaveText("Tall", { timeout: 30_000 });
    await page.getByRole("button", { name: "Add: Thing" }).click();
    const dialog = page.getByRole("dialog", { name: "Add: Thing" });
    await expect(dialog).toBeVisible();
    const sheet = (await dialog.boundingBox())!;
    expect(sheet.height).toBeLessThanOrEqual(900 * 0.9 + 1);
    const create = dialog.getByRole("button", { name: "Create" });
    expect(inside((await create.boundingBox())!, page.viewportSize()!)).toBe(true);
    const body = dialog.locator(".k-form-body");
    expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    expect(inside((await create.boundingBox())!, page.viewportSize()!)).toBe(true);
    await expect(dialog.getByRole("textbox", { name: "Field19" })).toBeVisible();
  });

  test("focus goes to the first field, stays inside, and returns to the opener; axe passes", async ({ page }) => {
    await page.goto("/?user=plants");
    await expect(page.locator("h1").first()).toHaveText("Plants", { timeout: 30_000 });
    const opener = page.getByRole("button", { name: "Add: Plant" });
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add: Plant" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
    // Shift+Tab reaches the Close before the field; from there it wraps to the last control, and
    // Tab from the last wraps back to the first — focus never leaves the sheet.
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Create" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();

    const results = await new AxeBuilder({ page }).include(".k-sheet").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("closing a form with edits asks first; the scrim, Escape and Cancel alike", async ({ page }) => {
    await page.goto("/?user=plants");
    await expect(page.locator("h1").first()).toHaveText("Plants", { timeout: 30_000 });
    await page.getByRole("button", { name: "Add: Plant" }).click();
    const dialog = page.getByRole("dialog", { name: "Add: Plant" });
    await dialog.getByRole("textbox", { name: "Name" }).fill("Basil");
    await page.keyboard.press("Escape");
    const ask = page.getByRole("dialog", { name: "Discard your changes?" });
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("Basil");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Confirm" }).click();
    await expect(dialog).toHaveCount(0);
  });
});
