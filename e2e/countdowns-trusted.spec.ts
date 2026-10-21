import { test, expect } from "./console-guard";
import { addAsMine, packApp } from "./library-demos";

// apps/countdowns, packed as its build packs it, added as mine: it opens on its countdown screen with
// nothing yet, an event is added through the one short form, and the days until it fill the screen.

test("Countdowns: add an event, and the days until it are the whole top of the screen", async ({ page }) => {
  await addAsMine(page, "countdowns.potyro-app.zip", packApp("countdowns", "countdowns.app.tsx"));
  await expect(page.getByRole("heading", { name: "Nothing to count down to yet" })).toBeVisible();

  // The "+" is the page's own Add; the form takes what, when and an emoji.
  const keyIn = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const add = async (title: string, days: number, icon: string) => {
    const form = page.getByRole("dialog", { name: "Add an event" });
    await expect(form).toBeVisible();
    await form.getByRole("textbox", { name: "What" }).fill(title);
    const when = form.getByRole("textbox", { name: "When", exact: true });
    await when.fill(keyIn(days));
    await when.press("Enter");
    await expect(when).not.toHaveValue(/^\d{4}-/);
    await form.getByRole("textbox", { name: "Emoji" }).fill(icon);
    await form.getByRole("button", { name: "Add", exact: true }).click();
    await expect(form).toBeHidden();
  };
  await page.locator(".cd-empty").getByRole("button", { name: "Add an event" }).click();
  await add("Lisbon trip", 12, "✈️");

  const hero = page.getByRole("region", { name: "Soon" });
  await expect(hero).toBeVisible();
  await expect(hero.locator(".cd-hero-n")).toHaveText("12");
  await expect(hero.getByRole("heading", { name: "until Lisbon trip" })).toBeVisible();
  // Hero's number fills most of the width: the screen is the countdown.
  const box = (await hero.locator(".cd-hero-n").boundingBox())!;
  expect(box.height).toBeGreaterThan(60);

  // The event has its own page, with its days as a fact.
  await hero.getByRole("button", { name: "Lisbon trip" }).click();
  await expect(page.locator("article.k-detail")).toContainText("Lisbon trip");
  if (process.env.SHOT) {
    await page.getByRole("button", { name: "Back" }).first().click();
    await expect(hero).toBeVisible();
    for (const [title, days, icon] of [["Mum's birthday", 33, "🎂"], ["Dentist", 3, "🦷"], ["Moved in", -18, "🏠"]] as const) {
      await page.getByRole("button", { name: "Add an event" }).first().click();
      await add(title, days, icon);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: process.env.SHOT });
  }
});
