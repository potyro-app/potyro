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
  await page.locator(".k-card").first().click();
  await expect(page.locator("article.k-detail")).toBeVisible();
  await page.getByRole("button", { name: /Start cooking/ }).click();
  if (info.project.name === "sandbox-quickjs") {
    await expect(page.getByRole("button", { name: "Run it as mine…" })).toBeVisible();
    return;
  }
  const el = page.locator(".k-sealed-view iframe");
  await expect(el).toHaveAttribute("sandbox", "allow-scripts", { timeout: 30_000 });
  const frame = page.frameLocator(".k-sealed-view iframe");
  // The recipe it was opened for (its `param`), one step at a time: Next ticks the step it leaves.
  await expect(frame.locator("#cook-heading")).toContainText("Cooking:", { timeout: 30_000 });
  await expect(frame.getByText(/Step 1 of \d+/).first()).toBeVisible();
  // Sealed, it asks across the realm's port: the screen held on, and a step's timer the shell keeps —
  // its chip in the shell's own page (docs/04 §Timers).
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-k-awake", "");
  await frame.locator(".ck-timer").click();
  const chip = page.locator(".k-timer-chip", { hasText: ", step 1" });
  await expect(chip).toHaveCount(1);
  await expect(frame.locator(".ck-timer")).toHaveAttribute("data-running", "true");
  await frame.getByRole("button", { name: "Next step" }).click();
  await expect(frame.getByText(/Step 2 of \d+/).first()).toBeVisible();
  await expect(frame.locator("ol li input[type=checkbox]").first()).toBeChecked();
  const secondStep = frame.locator("ol li input[type=checkbox]").nth(1);
  await secondStep.check();
  await expect(secondStep).toBeChecked();
  // Nothing of the app's screen is in the shell's own document.
  await expect(page.locator("#cook-heading")).toHaveCount(0);
  // Out of cook mode the screen may sleep; the step's timer is still on its chip, and stops there.
  await page.getByRole("button", { name: /Recipes/ }).first().click();
  await expect(html).not.toHaveAttribute("data-k-awake", "");
  await chip.getByRole("button", { name: "Stop timer" }).click();
  await expect(chip).toHaveCount(0);
});
