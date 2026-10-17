import { test, expect } from "./console-guard";

// Workout's Train screen, first run: the sample program is PPL and yesterday was Push A, so it opens
// on "Next up: Pull A" with each exercise saying what to try today and why. Starting it fills every
// set from last time, the Previous column shows what that was, a ticked set starts the rest clock, and
// finishing saves the session and opens on what was broken: a heavier row than ever is a record.
//
// The rest is the shell's timer (`ctx.ui.timer`, docs/04): its chip is in sight on the app's other
// pages and the screen stays on (`ctx.ui.keepAwake`) only while a workout is under way.

const shots = process.env.POTYRO_SHOTS;
const seconds = (mmss: string | null): number => {
  const [m, s] = String(mmss ?? "").split(":").map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
};

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

    const html = page.locator("html");
    await expect(html).not.toHaveAttribute("data-k-awake", "");
    await page.getByRole("button", { name: "Start Pull A" }).tap();
    // A workout under way holds the screen on.
    await expect(html).toHaveAttribute("data-k-awake", "");
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
    // The rest is the shell's timer: one chip, the same countdown.
    const chip = page.locator(".k-timer-chip", { hasText: "Rest" });
    await expect(chip).toHaveCount(1);
    await expect(chip.getByRole("timer")).toHaveText(/^[12]:\d\d$/);
    // +30 s restarts that same timer, longer: still one chip.
    const before = seconds(await rest.locator(".wk-rest-n").textContent());
    await rest.getByRole("button", { name: "+30s" }).tap();
    await expect.poll(async () => seconds(await chip.getByRole("timer").textContent())).toBeGreaterThan(before + 20);
    await expect(chip).toHaveCount(1);
    // The chip is shell chrome, on the tab bar: the workout's own bottom bar sits above it, Finish in reach.
    const [chipBox, barBox] = [await chip.boundingBox(), await page.locator(".wk-bar").boundingBox()];
    expect(chipBox && barBox && barBox.y + barBox.height <= chipBox.y).toBe(true);
    if (shots) await page.screenshot({ path: `${shots}/workout-rest-bar-clear-phone.png` });

    // Another page: the rest is still counting, in sight; the screen may sleep (the workout is off-screen).
    await page.locator(".k-tabbar .k-tab", { hasText: "History" }).first().tap();
    await expect(page.locator(".k-tl-item").first()).toBeVisible();
    await expect(chip).toBeVisible();
    await expect(chip.getByRole("timer")).toHaveText(/^2:\d\d$/);
    await expect(html).not.toHaveAttribute("data-k-awake", "");
    if (shots) await page.screenshot({ path: `${shots}/workout-rest-chip-history.png` });

    // Back on Train: the screen reads the shell's timer, and holds the screen on again.
    await page.locator(".k-tabbar .k-tab", { hasText: "Train" }).first().tap();
    await expect(rest).toBeVisible();
    await expect(html).toHaveAttribute("data-k-awake", "");
    // Skip stops the shell's timer, not just the drawing of it.
    await rest.getByRole("button", { name: "skip" }).tap();
    await expect(rest).toHaveCount(0);
    await expect(chip).toHaveCount(0);

    await page.getByRole("button", { name: "Finish" }).tap();
    await page.getByRole("menuitem", { name: /Save and finish/ }).tap();
    const summary = page.locator(".wk-summary");
    await expect(summary).toContainText("Workout done");
    await expect(summary.locator(".wk-prs li").first()).toContainText("Barbell Row");
    await expect(summary.locator(".wk-prs")).toContainText("100 kg, heaviest yet");
    // The workout is over: the screen may sleep again.
    await expect(html).not.toHaveAttribute("data-k-awake", "");
    await summary.getByRole("button", { name: "Done" }).tap();
    // Pull A is done: Legs A takes its turn.
    await expect(page.locator(".wk-huge")).toHaveText("Legs A");

    // The session is in History, with its records.
    await page.locator(".k-tabbar .k-tab", { hasText: "History" }).first().tap();
    await expect(page.locator(".k-tl-item").first()).toContainText("Pull A");
    await expect(page.locator(".k-tl-item").first()).toContainText("🏆");
  });
});
