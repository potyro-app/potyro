import { test, expect } from "./console-guard";
import { makeDemoLink, stranger } from "./share-demo";

// "Made with Potyro · Remix this" (docs/24 §6). Inside a shared app, Remix opens the Studio on the
// person's own copy, prefilled with "Make me a version of <app> that…"; the copy says what it is a
// remix of, and who made that. Trust is unchanged: the copy is sealed, as anything from a link is.

test("Remix this: the Studio opens on your own sealed copy, prefilled, and the credit travels", async ({ page, browser, baseURL }) => {
  // The sharer has told Potyro their name, and leaves "Say it is by Ana" ticked.
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await page.evaluate(() => localStorage.setItem("potyro:identity:name", "Ana"));
  await page.goto("/");
  await page.getByRole("button", { name: "Actions for Groceries" }).click();
  await page.getByRole("menu").locator('[data-action="share"]').click();
  await expect(page.locator(".k-share-sheet").getByRole("checkbox", { name: "Say it is by Ana" })).toBeChecked();
  await page.keyboard.press("Escape");
  const link = await makeDemoLink(page, "Groceries");

  const { context, page: viewer } = await stranger(browser, baseURL!);
  await viewer.goto(link);
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 15_000 });
  const bar = viewer.locator(".k-demo-bar");
  await expect(bar).toContainText("By Ana");

  await bar.getByRole("button", { name: "Remix this" }).click();
  const card = viewer.getByRole("dialog", { name: "Remix an app" });
  await expect(card.getByRole("heading", { name: "Groceries" })).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("By Ana");
  await expect(card).toContainText("It runs in the sealed box");
  await expect(card.getByText("I wrote this. Run it as mine.")).toHaveCount(0);
  await card.getByRole("button", { name: "Remix it" }).click();

  // The copy, sealed, with the Studio open on it and the request started for them.
  await expect(viewer).toHaveURL(/\/\?user=groceries$/, { timeout: 30_000 });
  const studio = viewer.getByRole("dialog", { name: "App studio" });
  await expect(studio).toBeVisible({ timeout: 30_000 });
  await expect(studio.getByRole("textbox", { name: "Describe the app" })).toHaveValue("Make me a version of Groceries that…");
  const apps = await viewer.evaluate(() => JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as Array<{ id: string; trusted?: boolean; remixOf?: unknown; credit?: unknown }>);
  const copy = apps.find((a) => a.id === "groceries")!;
  expect(copy.trusted).toBe(false);
  expect(copy.remixOf).toEqual({ name: "Groceries", by: "Ana" });
  expect(copy.credit).toBeUndefined();
  expect(JSON.parse((await viewer.evaluate(() => localStorage.getItem("potyro:share-counts"))) ?? "{}")).toMatchObject({ "demo-opened": 1, "demo-remixed": 1 });
  await context.close();
});
