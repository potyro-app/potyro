import { test, expect } from "./console-guard";
import { foreignHosts, makeDemoLink, stranger } from "./share-demo";
import { addAsMine, packApp } from "./library-demos";

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

test("a demo of an app shown for one group at a time opens on one of the demo's groups, never on “choose a group”", async ({ page, browser, baseURL }) => {
  // Split has a required app-wide selection (docs/03 `scope`): a first run of the empty app asks
  // which group; a demo has groups of its own, so it opens on one.
  const link = await makeDemoLink(page, "Split");
  const { context, page: viewer } = await stranger(browser, baseURL!);
  await viewer.goto(link);
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 15_000 });
  const chip = viewer.locator(".k-scope");
  await expect(chip).toBeVisible();
  await expect(chip).not.toHaveAttribute("data-empty", "true");
  await expect(chip).not.toContainText("Choose");
  // Given a moment to ask, it still has not.
  await viewer.waitForTimeout(500);
  await expect(viewer.getByRole("dialog", { name: "Choose" })).toHaveCount(0);
  await context.close();
});

test("a demo of an app added from a package opens on the sample records its package came with", async ({ page, browser, baseURL }) => {
  // Receipt Split ships a seed.json (#253): it is the app's own sample data, and its demo shows it.
  await addAsMine(page, "receipt-split.potyro-app.zip", packApp("receipt-split", "receipt-split.app.ts", ["--seed", "seed.json"]));
  await expect(page.getByText("Sourdough loaf")).toBeVisible();
  const link = await makeDemoLink(page, "Receipt Split");
  const { context, page: viewer } = await stranger(browser, baseURL!);
  await viewer.goto(link);
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 15_000 });
  await expect(viewer.getByText("Sourdough loaf")).toBeVisible();
  await expect(viewer.getByText("Mozzarella")).toBeVisible();
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

// A demo's own screens (#267): they draw sealed in their frames, as any shared app's do. Where they
// cannot (the QuickJS fallback), "Run it as mine…" was a dead end — nothing is installed to promote —
// so it leads to "Keep this app" first.
for (const box of ["realm", "quickjs"] as const) {
  test(`a demo's own screen: ${box === "realm" ? "drawn sealed in its frame" : "where it cannot run, Run it as mine leads to Keep this app"}`, async ({ page, browser, baseURL }) => {
    const link = await makeDemoLink(page, "Recipes");
    const { context, page: viewer } = await stranger(browser, baseURL!);
    if (box === "quickjs") await context.addInitScript(() => localStorage.setItem("potyro:sandbox", "quickjs"));
    await viewer.goto(link);
    await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 15_000 });
    await viewer.locator(".k-card").first().click();
    await viewer.getByRole("button", { name: /Start cooking/ }).click();
    if (box === "realm") {
      const frame = viewer.frameLocator(".k-sealed-view iframe");
      await expect(frame.locator("#cook-heading")).toContainText("Cooking:", { timeout: 30_000 });
      await frame.getByRole("button", { name: "Next step" }).click();
      await expect(frame.getByText(/Step 2 of \d+/).first()).toBeVisible();
    } else {
      await viewer.getByRole("button", { name: "Run it as mine…" }).click();
      const card = viewer.getByRole("dialog", { name: "Add an app" });
      await expect(card.getByRole("heading", { name: "Recipes" })).toBeVisible({ timeout: 30_000 });
      await expect(viewer.getByRole("heading", { name: "Let it run as yours?" })).toHaveCount(0);
    }
    await context.close();
  });
}
