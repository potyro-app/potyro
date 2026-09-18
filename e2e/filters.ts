import { expect, type Locator, type Page } from "@playwright/test";

// Choosing a filter, wherever the chrome happens to keep it.
//
// Option lists (a category, a set of tags) live behind one Filter button since the Places screen
// came to thirteen chips — most of a phone's screen spent on choices nobody had made. Booleans and
// "near me" stayed outside, because each is already one tap.
//
// Every spec that filtered used to click `.k-chip` directly. This is that, in one place, so the next
// move of the control is one edit rather than a dozen.
//
// Not a `.spec.ts`, so Playwright does not collect it as a test file.

/** Pick an option (a category, a tag). Opens the Filter sheet when the option is not already out. */
export async function chooseFilter(root: Page | Locator, option: string | RegExp): Promise<void> {
  const chip = root.locator(".k-chip", { hasText: option });
  if ((await chip.count()) === 0) {
    await root.getByRole("button", { name: /Filter/ }).first().click();
    await chip.first().waitFor({ timeout: 10_000 });
  }
  await chip.first().click();
  // Back to the page: the sheet is a choice, not a destination.
  const done = root.getByRole("button", { name: "Done" });
  if (await done.count()) await done.first().click();
  await expect(root.locator(".k-filter-sheet")).toHaveCount(0);
}

/** The chip a chosen value leaves beside the Filter button — tapping it takes the filter off. */
export function chosenFilter(root: Page | Locator, option: string | RegExp): Locator {
  return root.locator(".k-chip-picked", { hasText: option });
}
