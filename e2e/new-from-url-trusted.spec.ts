import { test, expect } from "./console-guard";

// The landing page's prompt box (potyro.com, DESIGN.md §9: "the product is the demonstration") sends
// what was typed to potyro.app as `?new=…`, and the Studio opens on it.
test("?new= opens the Studio on the words, and leaves the address clean", async ({ page }) => {
  await page.goto("/?new=" + encodeURIComponent("a shopping list for the house, split by store"));
  const box = page.locator(".k-studio").getByRole("textbox", { name: "Describe the app" });
  await expect(box).toBeVisible({ timeout: 30_000 });
  await expect(box).toHaveValue("a shopping list for the house, split by store");
  expect(new URL(page.url()).searchParams.has("new")).toBe(false);
});

test("an empty ?new= opens the Studio with nothing in the box", async ({ page }) => {
  await page.goto("/?new=");
  const box = page.locator(".k-studio").getByRole("textbox", { name: "Describe the app" });
  await expect(box).toBeVisible({ timeout: 30_000 });
  await expect(box).toHaveValue("");
});

// ---- #53: from the site's own prompt box, the app is made without another press -------------------
//
// The words in an address belong to whoever made the link. A visit the browser says came from the
// site (its links to the app carry `referrerpolicy="origin"`, and nothing else on the site says
// where it came from) starts by itself; any other only fills the box. The site here is a stand-in
// page on the real site's address, so the referrer is the browser's own, not something the test set.

const WORDS = "A countdown to the wedding";
const COUNTDOWN = `import { defineApp } from "potyro";

export default defineApp({
  id: "wedding-countdown",
  name: "Wedding Countdown",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { day: { label: "Day", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Days", view: { type: "list", entity: "day", display: { primary: "title" } } }],
});
`;

/** The dev server's generate endpoint, answering with one canned app; counts how often it was asked. */
async function stubGenerator(page: import("@playwright/test").Page): Promise<{ calls: () => number }> {
  let asked = 0;
  await page.route("**/__generate**", async (route) => {
    if (route.request().method() === "POST") {
      asked += 1;
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id: `job-${asked}` }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "done", text: "```ts\n" + COUNTDOWN + "```\n" }) });
  });
  return { calls: () => asked };
}

test("words sent from the site's page make the app at once", async ({ page, baseURL }) => {
  const generator = await stubGenerator(page);
  const link = `${baseURL}/?new=${encodeURIComponent(WORDS)}`;
  await page.route("https://potyro.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      headers: { "Referrer-Policy": "no-referrer" }, // as the real site answers
      body: `<!doctype html><title>the site</title><a id="go" referrerpolicy="origin" href="${link}">${WORDS}</a>`,
    }),
  );
  await page.goto("https://potyro.com/");

  await page.locator("#go").click();

  const studio = page.locator(".k-studio");
  await expect(studio.getByText("Wedding Countdown").first()).toBeVisible({ timeout: 60_000 });
  await expect(studio.getByRole("button", { name: "Open", exact: true })).toBeVisible();
  expect(generator.calls()).toBe(1);
  expect(new URL(page.url()).searchParams.has("new")).toBe(false);
});

test("the same words from anywhere else only fill the box: nothing is made until the person says so", async ({ page, baseURL }) => {
  const generator = await stubGenerator(page);
  const link = `${baseURL}/?new=${encodeURIComponent(WORDS)}`;
  // Another site, sending its whole address as the referrer.
  await page.route("https://example.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><a id="go" referrerpolicy="unsafe-url" href="${link}">a link</a>` }),
  );
  await page.goto("https://example.org/?https://potyro.com/");

  await page.locator("#go").click();

  const box = page.locator(".k-studio").getByRole("textbox", { name: "Describe the app" });
  await expect(box).toHaveValue(WORDS, { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  expect(generator.calls()).toBe(0);
});
