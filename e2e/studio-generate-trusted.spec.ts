import { test, expect } from "@playwright/test";

// Generation driven through the ACTUAL browser path, because curl proves only that the endpoint
// answers — not that the Studio's polling client works. The bug this covers ("claude -p failed:
// NetworkError") was invisible to curl: the endpoint was fine and the browser lost the response.
//
// Runs a real `claude -p`, so it is slow and needs the CLI authenticated. Skipped when CI=1.

test.skip(!!process.env.CI, "runs a real claude -p; local only");
test.setTimeout(360_000);

test("the Studio generates an app end to end, surviving a long run", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") failures.push(m.text());
  });
  // The symptom was a failed POST/poll; watch the network for it directly.
  const generateCalls: string[] = [];
  page.on("requestfailed", (r) => {
    if (r.url().includes("/__generate")) failures.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ""}`);
  });
  page.on("response", (r) => {
    if (r.url().includes("/__generate")) generateCalls.push(`${r.request().method()} ${r.status()}`);
  });

  await page.goto("/?app=recipes");
  await page.locator("header").getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  await expect(studio).toBeVisible();

  await studio
    .getByRole("textbox", { name: "Describe the app" })
    .fill("a list of places I like in a city, shown on a map, each with a type and tags");

  await studio.getByRole("button", { name: /Create the app|Modify the app/ }).click();

  // Progress must appear — a silent multi-minute wait is what made this feel broken.
  await expect(studio.getByText(/Generating via claude -p… \d+s/)).toBeVisible({ timeout: 30_000 });

  // The generated app replaces the starter in the live preview.
  const preview = studio.locator(".k-studio-preview");
  await expect(preview.locator("h1")).not.toHaveText("My App", { timeout: 330_000 });

  await studio.getByRole("tab", { name: "Source" }).click();
  await expect(studio.getByRole("textbox", { name: "App source" })).toHaveValue(/defineApp/);

  // POST starts the job; at least one GET polls it. A single long-held request is the old shape.
  expect(generateCalls.some((c) => c.startsWith("POST"))).toBe(true);
  expect(generateCalls.some((c) => c.startsWith("GET"))).toBe(true);
  expect(failures, `failures:\n${failures.join("\n")}`).toEqual([]);
});
