import { test, expect } from "./console-guard";
import { installQuestions } from "./ui-questions.js";

// The structured questions cross the isolate (#112): an untrusted app's form, menu and progress are
// plain data out and plain data back, with no permission prompt.

test.use({ viewport: { width: 1280, height: 800 } });

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

test("an untrusted app hands words and a link to the share dialog, and hears whether they left", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
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
  await expect(form.getByRole("spinbutton", { name: "Reps" })).toHaveValue("6");
  await form.getByRole("button", { name: "Log set" }).click();
  await expect(page.locator(".k-toast")).toHaveText("Logged 42.5 kg × 6");
});
