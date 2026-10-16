import { test, expect } from "./console-guard";

// M1 DoD, sandbox path: the SAME recipes app loaded UNTRUSTED in the QuickJS-WASM isolate with
// mediated caps. If the list renders with computed macros, the isolate successfully ran the app's
// functions (computed + display) behind the marshalling boundary.

test("recipes app runs untrusted in the QuickJS-WASM isolate", async ({ page }) => {
  await page.goto("/?app=recipes");
  await expect(page.locator("h1")).toHaveText("Recipes");

  // Provenance badge proves this is the isolate path, not direct execution.
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");

  // The app's gallery + computed functions executed inside the isolate and marshalled results out.
  const rows = page.locator(".k-card");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(page.locator(".k-secondary").filter({ hasText: "kcal" }).first()).toBeVisible();

  // Detail navigation works through the isolate boundary too.
  await rows.first().click();
  await expect(page.locator("article.k-detail")).toBeVisible();
});

// The M1 cook-along, sealed (#267): the same React component, in its own sandboxed frame, with the
// recipe it was opened for (`param`, `useRecord`) and a step ticked inside the frame. Through the
// QuickJS fallback a custom view cannot run, and the card says how to run it as yours instead.
test("the cook-along screen runs sealed in its own frame, and its steps tick", async ({ page }, info) => {
  await page.goto("/?app=recipes");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");
  await page.locator(".k-list-row").first().click();
  const name = String(await page.locator("article.k-detail h2, article.k-detail h1").first().textContent()).trim();
  await page.getByRole("button", { name: "Cook", exact: true }).click();
  if (info.project.name === "sandbox-quickjs") {
    await expect(page.getByRole("button", { name: "Run it as mine…" })).toBeVisible();
    return;
  }
  const el = page.locator(".k-sealed-view iframe");
  await expect(el).toHaveAttribute("sandbox", "allow-scripts", { timeout: 30_000 });
  const frame = (await (await el.elementHandle())!.contentFrame())!;
  await expect(frame.locator("#cook-heading")).toContainText(`Cooking: ${name}`, { timeout: 30_000 });
  const firstStep = frame.locator("ol li input[type=checkbox]").first();
  await firstStep.check();
  await expect(firstStep).toBeChecked();
  // Nothing of the app's screen is in the shell's own document.
  await expect(page.locator("#cook-heading")).toHaveCount(0);
});
