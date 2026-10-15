import { test, expect, type Page } from "./console-guard";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The timeline (#110). Workout's History: sessions on a rail by week, newest first, each dot in its
// day's colour, the week's heading sticking under the top bar while the week scrolls past. The clock
// is fixed so the seeded history lands in known weeks — Wednesday 9 September.

const NOW = new Date(2026, 8, 9, 12, 0, 0);
const SHOTS = process.env.POTYRO_SHOTS;

async function openHistory(page: Page, phone = false): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.goto("/?user=workout");
  await expect(page.locator("h1").first()).toHaveText("PPL Log", { timeout: 30_000 });
  if (phone) await page.locator(".k-tabbar .k-tab", { hasText: "History" }).first().tap();
  else await page.locator(".k-sidenav .k-tab", { hasText: "History" }).click();
  await expect(page.locator(".k-tl-item").first()).toBeVisible({ timeout: 30_000 });
}

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("weeks newest first, dots in the day's colour, a sticky heading, and a card opens its session", async ({ page }) => {
    await openHistory(page, true);
    const heads = page.locator(".k-tl-head");
    await expect(heads.nth(0)).toHaveText("This week");
    await expect(heads.nth(1)).toHaveText("Last week");
    await expect(heads.nth(2)).toHaveText(/Aug 24\s*–\s*30|24\s*–\s*30 Aug/);

    const thisWeek = page.getByRole("region", { name: "This week, 1" });
    await expect(thisWeek.locator(".k-primary")).toHaveText("Push");
    await expect(thisWeek.locator(".k-tl-when")).toHaveText(/^Yesterday \d{1,2}:\d\d/);
    const lastWeek = page.getByRole("region", { name: "Last week, 2" });
    await expect(lastWeek.locator(".k-primary")).toHaveText(["Legs", "Push"]);
    await expect(lastWeek.locator(".k-secondary").first()).toHaveText("3 sets · 1,410 kg · 55 min");
    // Legs is green and push is red: different dots, drawn from the field's colours.
    const dot = (loc: ReturnType<Page["locator"]>) => loc.locator(".k-tl-dot").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await dot(lastWeek.locator(".k-tl-item").nth(0))).not.toBe(await dot(lastWeek.locator(".k-tl-item").nth(1)));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/timeline-phone.png` });

    // Scrolled down, the heading of the week being read sits under the top bar.
    const head = heads.nth(3);
    await head.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top));
    await page.waitForTimeout(100);
    const bar = (await page.locator(".k-topbar").boundingBox())!;
    const stuck = (await head.boundingBox())!;
    expect(Math.abs(stuck.y - (bar.y + bar.height))).toBeLessThan(3);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/timeline-phone-stuck.png` });

    await thisWeek.locator(".k-tl-card").tap();
    await expect(page.locator("article.k-detail")).toBeVisible();
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("500 entries: the first cards paint within 200ms, only the first weeks render, and more load on scroll", async ({ page }) => {
    const source = readFileSync(fileURLToPath(new URL("./fixtures/journal-500.app.tsx", import.meta.url)), "utf8");
    await page.addInitScript(([src]) => {
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "journal-500", name: "Journal 500", source: src, trusted: true, updatedAt: new Date().toISOString() }]));
    }, [source]);
    await page.clock.setFixedTime(new Date(2026, 8, 10, 9, 0));
    await page.goto("/?user=journal-500");
    await expect(page.locator(".seeded")).toHaveText("Seeded 500", { timeout: 60_000 });

    // Warm once, so the measurement is the view and not the first bundle of a lazy module.
    const tab = page.locator(".k-sidenav .k-tab", { hasText: "Journal" });
    const seedTab = page.locator(".k-sidenav .k-tab", { hasText: "Seed" });
    await tab.click();
    await expect(page.locator(".k-tl-card .k-primary").first()).toHaveText("Entry 1", { timeout: 30_000 });
    await seedTab.click();
    await expect(page.locator(".seeded")).toBeVisible();

    const ms = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const link = [...document.querySelectorAll<HTMLElement>(".k-sidenav .k-tab")].find((el) => el.textContent?.includes("Journal"))!;
          const t0 = performance.now();
          link.click();
          const tick = (): void => {
            if (document.querySelector(".k-tl-card .k-primary")?.textContent === "Entry 1") requestAnimationFrame(() => resolve(performance.now() - t0));
            else requestAnimationFrame(tick);
          };
          tick();
        }),
    );
    console.log(`timeline first paint with 500 entries: ${Math.round(ms)}ms`);
    expect(ms).toBeLessThan(200);

    const rendered = await page.locator(".k-tl-item").count();
    expect(rendered).toBeGreaterThanOrEqual(40);
    expect(rendered).toBeLessThan(100);
    await page.locator(".k-tl-item").last().scrollIntoViewIfNeeded();
    await expect.poll(() => page.locator(".k-tl-item").count()).toBeGreaterThan(rendered);
  });
});
