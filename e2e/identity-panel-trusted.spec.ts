import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The identity panel leads with the person, not with infrastructure (#95). It used to open on a
// monospace "no identity yet", a ws:// URL and two unrelated-sounding sections.

const SHOTS = process.env.POTYRO_SHOTS;

async function openPanel(page: Page): Promise<ReturnType<Page["locator"]>> {
  await page.goto("/");
  await expect(page.locator(".k-launcher")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "You and your devices" }).click();
  const panel = page.getByRole("dialog", { name: "You and your devices" });
  await expect(panel).toBeVisible();
  return panel;
}

for (const [name, viewport, touch] of [["phone", { width: 375, height: 812 }, true], ["desktop", { width: 1440, height: 900 }, false]] as const) {
  test.describe(name, () => {
    test.use({ viewport, hasTouch: touch, isMobile: touch });

    test("the person first, one heading for devices, infrastructure under Advanced", async ({ page }) => {
      const panel = await openPanel(page);
      // A fresh device: no name yet, said in words, with the action to fix it.
      await expect(panel.locator(".k-identity-name")).toHaveText("No name yet");
      await expect(panel.getByRole("button", { name: "Set a name" })).toBeVisible();
      await expect(panel.getByRole("heading", { name: "Your devices" })).toBeVisible();
      await expect(panel.getByRole("button", { name: /Add a device/ })).toBeVisible();
      await expect(panel.getByRole("button", { name: /This is my second device/ })).toBeVisible();

      // Nothing monospace and no ws:// is visible until Advanced is opened.
      const visibleMono = await panel.evaluate((el) =>
        [...el.querySelectorAll("*")]
          .filter((n) => (n as HTMLElement).checkVisibility() && /mono/i.test(getComputedStyle(n).fontFamily) && n.textContent?.trim())
          .map((n) => `${n.tagName}.${n.className}: ${getComputedStyle(n).fontFamily}`),
      );
      expect(visibleMono).toEqual([]);
      await expect(panel.getByText(/wss?:\/\//)).toBeHidden();
      await expect(panel).not.toContainText("no identity yet");

      // Measure colours once the panel has finished fading in: mid-animation text is half
      // transparent, and on a busy CI machine axe caught it there as low contrast.
      await panel.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))));
      expect((await new AxeBuilder({ page }).include(".k-identity").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.map((v) => v.id)).toEqual([]);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/identity-${name}.png` });

      await panel.getByText(/^Advanced/).click();
      await expect(panel.getByRole("button", { name: "Change relay" })).toBeVisible();
      await expect(panel.locator(".k-relay-current")).toContainText(/wss?:\/\//);
    });

    test("naming yourself changes the heading and the action", async ({ page }) => {
      const panel = await openPanel(page);
      await panel.getByRole("button", { name: "Set a name" }).click();
      await page.locator(".k-dialog input").fill("Ana Lima");
      await page.locator(".k-dialog").getByRole("button", { name: "OK" }).click();
      await expect(panel.locator(".k-identity-name")).toHaveText("Ana Lima");
      await expect(panel.locator(".k-identity-avatar")).toHaveText("AL");
      await expect(panel.getByRole("button", { name: "Rename" })).toBeVisible();
    });
  });
}
