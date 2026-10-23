import { test, expect } from "./console-guard";
import { makeDemoLink, stranger } from "./share-demo";

// The mascot in the edge moments (DESIGN.md §4.2, #426): a success comes in with the boing (a link
// made), a long wait draws its stroke (the Studio at work), a 404 shows it still (a link taken down).
// One per screen; never in an error.

test.use({ viewport: { width: 1440, height: 900 } });

test("a link made: the mascot comes in beside the heading", async ({ page }) => {
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await makeDemoLink(page, "Groceries");
  const sheet = page.locator(".k-share-sheet");
  await expect(sheet.locator(".k-mascot[data-mascot='enter']")).toHaveCount(1);
  expect(await sheet.locator(".k-mascot").evaluate((el) => getComputedStyle(el).animationName)).toBe("k-mascot-enter");
});

test("a link taken down is a 404: the mascot, still, where the app's tile would be — and never on an error", async ({ page, browser, baseURL, consoleGuard }) => {
  consoleGuard.allow(/Failed to load resource: the server responded with a status of 404/, "the link was taken down on purpose: its package is gone");
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  const link = await makeDemoLink(page, "Groceries");
  const id = new URL(link).pathname.split("/").pop()!;
  const token = await page.evaluate((i) => (JSON.parse(localStorage.getItem("potyro:shares") ?? "[]") as Array<{ id: string; deleteToken: string }>).find((s) => s.id === i)?.deleteToken, id);
  expect((await page.request.delete(`/share-api/shares/${id}`, { headers: { "x-delete-token": token! } })).status()).toBe(200);

  const { context, page: viewer } = await stranger(browser, baseURL!);
  await viewer.goto(link);
  const splash = viewer.locator(".k-splash-failed");
  await expect(splash).toContainText("This link no longer works", { timeout: 15_000 });
  await expect(splash.locator(".k-mascot[data-mascot='still']")).toHaveCount(1);
  await expect(splash.locator(".k-splash-tile")).toHaveCount(0);
  await context.close();
});

test("a link that was never made is a 404 too: the same mascot", async ({ page, consoleGuard }) => {
  consoleGuard.allow(/Failed to load resource: the server responded with a status of 404/, "no package was ever stored under this id");
  await page.goto("/s/AAAAAAAAAAAAAAAAAAAAAA#k=AAAAAAAAAAAAAAAAAAAAAA");
  const splash = page.locator(".k-splash-failed");
  await expect(splash).toContainText("This link no longer works", { timeout: 15_000 });
  await expect(splash.locator(".k-mascot[data-mascot='still']")).toHaveCount(1);
});
