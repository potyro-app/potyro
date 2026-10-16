import { test, expect } from "./console-guard";

// Workout's Train screen, first run: the sample program is PPL and yesterday was Push A, so it opens
// on "Next up: Pull A" with each exercise saying what to try today and why. Starting it fills every
// set from last time, the Previous column shows what that was, a ticked set starts the rest clock, and
// finishing saves the session and opens on what was broken: a heavier row than ever is a record.

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("next up, previous column, rest, and a summary that names the record", async ({ page }) => {
    await page.goto("/?user=workout");
    await expect(page.locator("h1").first()).toHaveText("Workout", { timeout: 30_000 });
    await expect(page.locator(".wk-eyebrow").first()).toContainText("Next up", { timeout: 30_000 });
    await expect(page.locator(".wk-huge")).toHaveText("Pull A");
    // The progression rule, said in words: Face Pull hit the top of 12–15 on every set last time.
    await expect(page.locator(".wk-preview li", { hasText: "Face Pull" })).toContainText("+2.5 kg, you hit 15, 15, 15");
    await expect(page.locator(".wk-streak")).toContainText(/weeks? in a row/);

    await page.getByRole("button", { name: "Start Pull A" }).tap();
    const row = page.locator(".wk-ex", { hasText: "Barbell Row" });
    await expect(row.locator(".wk-prev").first()).toHaveText("62.5 × 8");
    const kg = row.getByLabel("Barbell Row 1 kg");
    await expect(kg).toHaveValue("62.5"); // prefilled from last time
    await kg.fill("100");
    await row.getByLabel("Barbell Row 1 reps").fill("5");
    await row.getByRole("button", { name: "Complete set" }).first().tap();
    const rest = page.getByRole("timer", { name: "Rest" });
    await expect(rest).toBeVisible();
    await expect(rest.locator(".wk-rest-n")).toHaveText(/^[12]:\d\d$/); // Barbell Row rests 120 s
    await rest.getByRole("button", { name: "skip" }).tap();
    await expect(rest).toHaveCount(0);

    await page.getByRole("button", { name: "Finish" }).tap();
    await page.getByRole("menuitem", { name: /Save and finish/ }).tap();
    const summary = page.locator(".wk-summary");
    await expect(summary).toContainText("Workout done");
    await expect(summary.locator(".wk-prs li").first()).toContainText("Barbell Row");
    await expect(summary.locator(".wk-prs")).toContainText("100 kg, heaviest yet");
    await summary.getByRole("button", { name: "Done" }).tap();
    // Pull A is done: Legs A takes its turn.
    await expect(page.locator(".wk-huge")).toHaveText("Legs A");

    // The session is in History, with its records.
    await page.locator(".k-tabbar .k-tab", { hasText: "History" }).first().tap();
    await expect(page.locator(".k-tl-item").first()).toContainText("Pull A");
    await expect(page.locator(".k-tl-item").first()).toContainText("🏆");
  });
});
