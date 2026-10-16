import type { Page } from "@playwright/test";

// Someone opening a shared app whose owner named guests is asked, once, whether they are one of them
// (docs/04 §Guests) — Split's sample Lisbon weekend names three. A spec that is about something else
// answers "I'm not on the list" whenever the question appears, so it never stands over the page.
// Not a `.spec.ts`, so Playwright does not collect it.

export async function notOnTheList(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByRole("dialog", { name: "Are you one of these people?" }), async (dialog) => {
    await dialog.getByRole("button", { name: "I’m not on the list" }).click();
  });
}
