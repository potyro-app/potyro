import { test, expect, type Locator } from "@playwright/test";

// The Studio on a phone (#80). At 375px the prompt textarea — the Studio's reason to exist — was
// 31px tall with the Create button sitting on top of it. Now the prompt is shown in full, its one
// action below it, the preview after that, and saving after the preview.

const PHONE = { width: 375, height: 812 };

type Box = { x: number; y: number; width: number; height: number };
const bottom = (b: Box) => b.y + b.height;
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < bottom(b) && b.y < bottom(a);

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error(`no box for ${String(l)}`);
  return b;
}

test.describe("phone", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("the prompt is whole and on screen, with nothing on top of it", async ({ page }) => {
    await page.goto("/");
    // The floating New app asks first on a phone: make one, or add one someone sent (#253).
    await page.locator(".k-launch-fab").tap();
    await page.getByRole("menuitem", { name: /Describe a new app/ }).tap();
    const studio = page.getByRole("dialog", { name: "App studio" });
    const prompt = studio.getByRole("textbox", { name: "Describe the app" });
    await expect(prompt).toBeVisible();

    const p = await box(prompt);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(bottom(p)).toBeLessThanOrEqual(PHONE.height);
    expect(p.x + p.width).toBeLessThanOrEqual(PHONE.width);
    // Room to write a sentence or three, not a slit.
    expect(p.height).toBeGreaterThanOrEqual(80);

    const buttons = studio.locator("button:visible");
    for (let i = 0; i < (await buttons.count()); i++) {
      const b = await box(buttons.nth(i));
      expect(intersects(p, b), `button "${await buttons.nth(i).textContent()}" overlaps the prompt`).toBe(false);
    }

    // Order down the page: prompt → its action → the stage → saving.
    const create = await box(studio.getByRole("button", { name: /Create the app/ }));
    const tabs = await box(studio.getByRole("tab", { name: "Preview" }));
    const save = await box(studio.getByRole("button", { name: /Save to My Apps/ }));
    expect(create.y).toBeGreaterThanOrEqual(bottom(p));
    expect(tabs.y).toBeGreaterThanOrEqual(bottom(create));
    expect(save.y).toBeGreaterThan(tabs.y);
    // The action is reachable without scrolling.
    expect(bottom(create)).toBeLessThanOrEqual(PHONE.height);
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("keeps the rail: prompt and saving on the left, the stage beside them", async ({ page }) => {
    await page.goto("/");
    await page.locator(".k-launch-newbtn").click();
    const studio = page.getByRole("dialog", { name: "App studio" });
    const p = await box(studio.getByRole("textbox", { name: "Describe the app" }));
    const save = await box(studio.getByRole("button", { name: /Save to My Apps/ }));
    const tabs = await box(studio.getByRole("tab", { name: "Preview" }));
    expect(p.height).toBeGreaterThanOrEqual(80);
    expect(save.x).toBeLessThan(tabs.x);
    expect(tabs.x).toBeGreaterThan(p.x + p.width);
  });
});
