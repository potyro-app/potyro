import { test, expect } from "./console-guard";
import { installQuestions } from "./ui-questions.js";
import { grantClipboard } from "./engines";

// The structured questions cross the isolate (#112): an untrusted app's form, menu and progress are
// plain data out and plain data back, with no permission prompt.

test.use({ viewport: { width: 1280, height: 800 } });

const shots = process.env.POTYRO_SHOTS;

test("an untrusted app asks with a form, a menu and a progress bar", async ({ page }) => {
  await installQuestions(page, false);

  await page.getByRole("button", { name: "Quick note" }).click();
  const form = page.getByRole("dialog", { name: "Quick note" });
  await form.getByRole("textbox").fill("From the isolate");
  await form.getByRole("button", { name: "Add note" }).click();
  await expect(page.locator(".k-toast")).toHaveText("Added From the isolate (green)");

  await page.getByRole("button", { name: "Recolour" }).click();
  await page.getByRole("menu", { name: "Colour" }).getByRole("menuitem", { name: /Blue/ }).click();
  await expect(page.locator(".k-detail")).toContainText("blue");

  await page.getByRole("button", { name: "Import demo" }).click();
  await expect(page.getByRole("progressbar", { name: "Importing notes" })).toHaveAttribute("aria-valuenow", "50");
  await page.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.locator(".k-toast").last()).toHaveText("Stopped");
});

test("an untrusted app hands words and a link to the share dialog, and hears whether they left", async ({ page, context, browserName }) => {
  await grantClipboard(context, browserName);
  await installQuestions(page, false);
  await page.getByRole("button", { name: "Share it" }).click();
  const dialog = page.getByRole("dialog", { name: "Send this note" });
  const sent = dialog.getByRole("textbox", { name: "What will be sent" });
  await expect(sent).toHaveValue("First\n🟩🟨⬛\nhttps://example.org/note");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".k-toast").last()).toHaveText("Not sent");

  await page.getByRole("button", { name: "Share it" }).click();
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("First\n🟩🟨⬛\nhttps://example.org/note");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".k-toast").last()).toHaveText("Sent");
});

test("Workout's Log set works untrusted", async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 8, 9, 12, 0, 0));
  await page.goto("/?app=workout");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await page.locator(".k-sidenav .k-tab", { hasText: "History" }).click();
  await page.locator(".k-tl-card").first().click();
  await page.getByRole("button", { name: "Log set" }).click();
  const form = page.getByRole("dialog", { name: "Log set" });
  await expect(form.getByRole("spinbutton", { name: "Reps" })).toHaveValue("9");
  await form.getByRole("button", { name: "Log set" }).click();
  await expect(page.locator(".k-toast")).toHaveText("Logged 30 kg × 9");
});

// A sealed app's own screen asks too (#267): Workout's Train view runs in its sandboxed frame, and
// its "Finish workout?" sheet — `ctx.ui.sheet` from the view — is the shell's, over the frame, through
// the same mediated ctx as the logic's questions.
test("a sealed screen asks with the shell's sheet, and its answer reaches the screen", async ({ page, consoleGuard, browserName }, info) => {
  test.skip(info.project.name === "sandbox-quickjs", "the QuickJS fallback has no sealed screens");
  if (browserName === "webkit")
    consoleGuard.allow(/Computed cycle: "session.label"/, "a pre-existing WebKit finding in the LOGIC realm (PR #360): WebKit reads a record's cycle-trap getter while cloning a computed call's arguments; not the sealed screen's");
  await page.goto("/?app=workout");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await page.locator(".k-sidenav .k-tab", { hasText: "Train" }).click();
  const el = page.locator(".k-sealed-view iframe");
  await expect(el).toHaveCount(1, { timeout: 30_000 });
  const frame = page.frameLocator(".k-sealed-view iframe");
  await frame.getByRole("button", { name: /Start Pull A/ }).click({ timeout: 30_000 });
  // The workout under way holds the screen on, and a ticked set's rest is the shell's timer, its
  // countdown drawn in the frame (docs/04 §Timers, §Keeping the screen on). The frame says it draws it
  // (`ctx.ui.drawsTimer`, across the realm's port), so the shell's chip steps aside on Train…
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-k-awake", "");
  await frame.locator(".wk-ex", { hasText: "Barbell Row" }).getByRole("button", { name: "Complete set" }).first().click();
  const chip = page.locator(".k-timer-chip", { hasText: "Rest" });
  await expect(frame.getByRole("timer", { name: "Rest" })).toBeVisible();
  await expect(page.locator(".k-timer-chip")).toHaveCount(0);
  if (shots) await page.screenshot({ path: `${shots}/sealed-train-rest-bar-only.png` });
  // …and is in sight on History, where nothing else shows the rest. The frame went: its hold with it.
  await page.locator(".k-sidenav .k-tab", { hasText: "History" }).click();
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await expect(chip.getByRole("timer")).toHaveText(/^[12]:\d\d$/);
  if (shots) await page.screenshot({ path: `${shots}/sealed-history-rest-chip.png` });
  await page.locator(".k-sidenav .k-tab", { hasText: "Train" }).click();
  await expect(frame.getByRole("timer", { name: "Rest" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".k-timer-chip")).toHaveCount(0);
  // Finish is tapped with the rest still running, by a real click (#377).
  const finish = frame.getByRole("button", { name: "Finish" });
  await finish.click();
  const sheet = page.getByRole("menu", { name: "Finish workout?" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("menuitem")).toHaveText([/Save and finish/, /Keep training/, /Discard workout/]);
  await sheet.getByRole("menuitem", { name: /Discard workout/ }).click();
  await expect(frame.getByRole("button", { name: /Start Pull A/ })).toBeVisible();
  // Thrown away, the rest goes with it: the shell's timer stops, not just its drawing — History has no chip.
  await page.locator(".k-sidenav .k-tab", { hasText: "History" }).click();
  await expect(page.locator(".k-tl-card").first()).toBeVisible({ timeout: 30_000 });
  await expect(chip).toHaveCount(0);
  await page.locator(".k-sidenav .k-tab", { hasText: "Train" }).click();
  await expect(frame.getByRole("button", { name: /Start Pull A/ })).toBeVisible({ timeout: 30_000 });
  // Thrown away: the screen may sleep.
  await expect(html).not.toHaveAttribute("data-k-awake", "");
});
