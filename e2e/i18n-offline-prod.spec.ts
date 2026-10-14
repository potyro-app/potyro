import { test, expect } from "@playwright/test";

// Every language works offline (#298). Each one is a lazy chunk, and the service worker otherwise
// caches only what has been fetched — so a language never chosen online would be missing on a plane.
// The build writes the chunk list to /i18n-precache.json and the worker's install fetches it all.
// Production only: the dev server registers no worker.

test("every language chunk is precached, and switching language works offline", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator(".k-launcher")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => navigator.serviceWorker.ready);

  const listed = await page.evaluate(async () => ((await (await fetch("/i18n-precache.json")).json()) as { files: string[] }).files);
  expect(listed.length).toBe(5); // pt-BR, de, es, pl, it — English is in the main chunk
  await expect
    .poll(async () => page.evaluate(async (files) => {
      const cached = await Promise.all(files.map((f) => caches.match(f)));
      return cached.filter(Boolean).length;
    }, listed), { timeout: 20_000 })
    .toBe(listed.length);

  await context.setOffline(true);
  await page.locator(".k-launch-you").first().click();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const picker = page.locator(".k-identity").getByRole("combobox", { name: "Language" });
  await picker.selectOption("de");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(picker).toHaveValue("de");
  await expect(page.locator(".k-lang-note[role=status]")).toHaveCount(0);
  await context.setOffline(false);
});
