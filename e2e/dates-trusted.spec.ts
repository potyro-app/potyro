import { test, expect } from "./console-guard";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Dates are days (#103). A `datetime` field asks for a day: the box reads it in words, chips set
// today, yesterday or tomorrow in one tap, the calendar button opens a month grid — a popover on a
// wide screen, a bottom sheet on a phone — and no hour is ever asked for. Only a field that says
// `precision: "minute"` keeps a time box beside the day.
//
// Driven against a committed fixture app holding both precisions, so the two live in one form.

const SOURCE = readFileSync(fileURLToPath(new URL("./fixtures/dates.app.ts", import.meta.url)), "utf8");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([source]) => {
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([{ id: "dates", name: "Dates", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    [SOURCE],
  );
});

const dayName = (offset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  // The day buttons are named the way the language writes a full date (Intl, #299).
  return new Intl.DateTimeFormat("en", { dateStyle: "full" }).format(d);
};

async function openForm(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?user=dates");
  await expect(page.locator("h1").first()).toHaveText("Dates", { timeout: 30_000 });
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted");
  await page.getByRole("button", { name: /New task/ }).first().click();
  await expect(page.locator(".k-form")).toBeVisible();
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a date field asks for a day: words, chips, a month grid, and never a time", async ({ page }) => {
    await openForm(page);
    const form = page.locator(".k-form");
    const box = form.getByRole("textbox", { name: "Due" });
    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute("placeholder", "Pick a day");
    // No hour on this field, and no browser datetime control anywhere.
    await expect(form.getByLabel("Due time")).toHaveCount(0);
    await expect(form.locator("input[type='datetime-local']")).toHaveCount(0);

    // A chip fills the box with the day in words.
    const dueField = form.locator(".k-form-field").filter({ has: page.getByRole("textbox", { name: "Due" }) });
    await dueField.getByRole("button", { name: "Yesterday" }).click();
    await expect(box).toHaveValue(/^Yesterday, /);
    await dueField.getByRole("button", { name: "Today" }).click();
    await expect(box).toHaveValue(/^Today, /);
    await expect(box).not.toHaveValue(/\d:\d\d/);

    // The calendar button opens a popover on the month, and picking a day writes it.
    await form.getByRole("button", { name: "Pick Due" }).click();
    const picker = page.getByRole("dialog", { name: "Due" });
    await expect(picker).toBeVisible();
    await expect(picker.locator(".k-date-day[data-selected]")).toHaveText(String(new Date().getDate()));
    await picker.getByRole("button", { name: dayName(3) }).click();
    await expect(picker).toHaveCount(0);
    await expect(box).toHaveValue(/^In 3 days, /);

    // Typing is still allowed, and the record keeps the day it was given.
    await box.fill("2026-12-24");
    await box.press("Enter");
    await expect(box).toHaveValue(/24 Dec|Dec 24/);
    await form.getByRole("textbox", { name: "Title" }).fill("E2E Dated Task");
    await form.getByRole("button", { name: "Create" }).click();
    const detail = page.locator("article.k-detail");
    await expect(detail).toBeVisible();
    const due = detail.locator(".k-field", { hasText: "Due" });
    await expect(due).toContainText(/24 Dec 2026|Dec 24, 2026/);
    await expect(due).not.toContainText(/\d\d:\d\d/);
  });

  test("a minute field keeps its hour beside the day", async ({ page }) => {
    await openForm(page);
    const form = page.locator(".k-form");
    const box = form.getByRole("textbox", { name: "Starts At", exact: true });
    const time = form.getByLabel("Starts At time");
    await expect(time).toBeVisible();
    await expect(time).toHaveAttribute("type", "time");

    // Set the day from a chip, then the hour; the field keeps both.
    const startsField = form.locator(".k-form-field").filter({ has: page.getByRole("textbox", { name: "Starts At", exact: true }) });
    await startsField.getByRole("button", { name: "Tomorrow" }).click();
    await time.fill("18:30");
    // The day is in the box, the hour in its own box — the hour is not said twice.
    await expect(box).toHaveValue(/^Tomorrow, /);
    await expect(box).not.toHaveValue(/·/);
    await form.getByRole("textbox", { name: "Title" }).fill("E2E Timed Task");
    await form.getByRole("button", { name: "Create" }).click();
    const starts = page.locator("article.k-detail .k-field", { hasText: "Starts At" });
    await expect(starts).toContainText(/18:30|06:30/);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("the picker is a bottom sheet, and a day in it fills the box", async ({ page }) => {
    await openForm(page);
    const form = page.locator(".k-form");
    await form.getByRole("button", { name: "Pick Due" }).tap();
    const picker = page.getByRole("dialog", { name: "Due" });
    await expect(picker).toHaveClass(/k-date-picker-sheet/);
    const sheet = (await picker.boundingBox())!;
    expect(sheet.x).toBeLessThan(2);
    expect(Math.round(sheet.y + sheet.height)).toBeGreaterThan(800);
    await picker.getByRole("button", { name: "Tomorrow" }).tap();
    await expect(picker).toHaveCount(0);
    await expect(form.getByRole("textbox", { name: "Due" })).toHaveValue(/^Tomorrow, /);
  });
});
