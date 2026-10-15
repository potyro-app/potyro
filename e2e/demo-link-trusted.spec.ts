import { test, expect } from "./console-guard";
import { foreignHosts, makeDemoLink, stranger } from "./share-demo";

// Every shared link is a working demo (docs/24). Someone who has never used Potyro opens the link and
// is using the app within seconds: sealed, on its sample records — never the sharer's — in their own
// language, with nothing installed. "Keep this app" is the ordinary Add-an-app card, sealed.

const SECRET = "Prezent dla Ani";

test("a stranger opens a demo link: the app runs at once, sealed, demo records only, in Polish", async ({ page, browser, baseURL }) => {
  // The sharer has records of their own in the app. None of them may travel.
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  const add = page.getByRole("textbox", { name: "Add an item" });
  await add.fill(SECRET);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("checkbox", { name: SECRET })).toBeVisible();

  // Without the share service (a static site, whose SPA rule answers every path with its page): the
  // link carries the app itself.
  await page.route("**/share-api/health", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><div id=\"root\"></div>" }));
  const link = await makeDemoLink(page, "Groceries");
  expect(link).toMatch(/\/#try=/);
  expect(decodeURIComponent(link)).not.toContain(SECRET);

  const { context, page: viewer } = await stranger(browser, baseURL!, { locale: "pl-PL" });
  const foreign = foreignHosts(context, new URL(baseURL!).hostname);
  const started = Date.now();
  await viewer.goto(link);

  // The app, sealed, with its sample records — within seconds, with no question asked first.
  const app = viewer.locator(".k-app");
  await expect(app).toHaveAttribute("data-provenance", "untrusted", { timeout: 15_000 });
  const milk = viewer.getByRole("checkbox", { name: "Milk" });
  await expect(milk).toBeVisible();
  await milk.click();
  await expect(milk).toHaveAttribute("aria-checked", "true");
  expect(Date.now() - started).toBeLessThan(15_000);
  await expect(viewer.getByRole("checkbox", { name: SECRET })).toHaveCount(0);
  await expect(viewer.getByText(SECRET)).toHaveCount(0);

  // In the viewer's language, and the bar says what this is.
  const bar = viewer.locator(".k-demo-bar");
  await expect(bar).toContainText("Potyro");
  await expect(bar.getByRole("button", { name: "Zachowaj tę aplikację" })).toBeVisible();
  await expect(viewer.locator("html")).toHaveAttribute("lang", "pl");

  // Nothing was installed: no apps, no account on this device.
  const stored = await viewer.evaluate(() => ({ apps: localStorage.getItem("potyro:user-apps"), counts: localStorage.getItem("potyro:share-counts") }));
  expect(stored.apps).toBeNull();
  expect(JSON.parse(stored.counts ?? "{}")).toEqual({ "demo-opened": 1 });

  expect(foreign).toEqual([]);
  await context.close();
});

test("Keep this app goes through the Add-an-app card, as a link: sealed, never “I wrote this”", async ({ page, browser, baseURL }) => {
  const link = await makeDemoLink(page, "Groceries");
  const { context, page: viewer } = await stranger(browser, baseURL!);
  await viewer.goto(link);
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 15_000 });

  await viewer.locator(".k-demo-bar").getByRole("button", { name: "Keep this app" }).click();
  const card = viewer.getByRole("dialog", { name: "Add an app" });
  await expect(card.getByRole("heading", { name: "Groceries" })).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("It runs in the sealed box");
  await expect(card.getByText("I wrote this. Run it as mine.")).toHaveCount(0);
  await expect(card).toContainText(/Starts with/);
  await card.getByRole("button", { name: "Add app" }).click();

  // Kept: the ordinary shell at the site's root, the app sealed, its sample records with it.
  await expect(viewer).toHaveURL(/\/\?user=groceries$/, { timeout: 30_000 });
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await expect(viewer.getByRole("checkbox", { name: "Milk" })).toBeVisible();
  const apps = await viewer.evaluate(() => JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as Array<{ id: string; trusted?: boolean }>);
  expect(apps.find((a) => a.id === "groceries")?.trusted).toBe(false);
  await context.close();
});
