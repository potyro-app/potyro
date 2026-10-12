import { test, expect } from "@playwright/test";
import { claudeCliAvailable } from "../packages/generator/src/cli-available.js";
import { openFromCard, openSource } from "./studio-helpers.js";

// Generation driven through the ACTUAL browser path, because curl proves only that the endpoint
// answers — not that the Studio's polling client works. The bug this covers ("claude -p failed:
// NetworkError") was invisible to curl: the endpoint was fine and the browser lost the response.
//
// Runs a real `claude -p`, so it is slow and needs the CLI authenticated. Skipped when CI=1.
//
// The determinstic half of this path — Studio generate → save → history → rollback, with the
// endpoint stubbed — is `create-modify-rollback-trusted.spec.ts`. This one exists for what only a
// real invocation can show: that the CLI answers at all, in the shape the client expects.

test.skip(!!process.env.CI, "runs a real claude -p; local only");
// Without this the spec does not fail, it WAITS: no `claude` on PATH means the dev endpoint's spawn
// errors, the Studio shows the error, and the preview assertion sits out its 330-second timeout
// before saying something that was knowable in the first millisecond. A machine with no CLI is the
// ordinary case — CI, a fresh checkout, this repo on Windows today — so it is answered up front.
test.skip(!claudeCliAvailable(), "`claude` is not on PATH — this spec drives the real CLI");
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

  // From the home screen: a Studio opened there is for making a new app. Opened from inside an app
  // it is for changing THAT app, and opens on it (reported 2026-09-13).
  await page.goto("/");
  await page.getByRole("button", { name: /New app/ }).click();
  const studio = page.locator(".k-studio");
  await expect(studio).toBeVisible();

  await studio
    .getByRole("textbox", { name: "Describe the app" })
    .fill("a list of places I like in a city, shown on a map, each with a type and tags");

  await studio.getByRole("button", { name: /Create the app|Modify the app/ }).click();

  // Progress must appear — a silent multi-minute wait is what made this feel broken.
  await expect(studio.getByText(/Making it via claude -p… \d+s/)).toBeVisible({ timeout: 30_000 });

  // The made app — or the one question a model may ask first (#261), which is an answer too.
  await expect(studio.locator('.k-card[data-current], .k-thread-answer[data-tone="question"]').first()).toBeVisible({ timeout: 330_000 });
  if (await studio.locator(".k-card[data-current]").count()) {
    const preview = await openFromCard(studio);
    await expect(preview.locator("h1").first()).toBeVisible({ timeout: 30_000 });
    const tools = await openSource(page, studio);
    await expect(tools.getByRole("textbox", { name: "App source" })).toHaveValue(/defineApp/);
  }

  // POST starts the job; at least one GET polls it. A single long-held request is the old shape.
  expect(generateCalls.some((c) => c.startsWith("POST"))).toBe(true);
  expect(generateCalls.some((c) => c.startsWith("GET"))).toBe(true);
  expect(failures, `failures:\n${failures.join("\n")}`).toEqual([]);
});
