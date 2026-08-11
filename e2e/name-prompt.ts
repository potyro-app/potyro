import { expect, type Page } from "@playwright/test";

// Sharing and joining ask what to call you, once per device (`askNameIfUnnamed`). Every spec that
// crosses either path meets that dialog, so the handling lives here rather than in five copies that
// would each need finding when the copy changes.
//
// Not a `.spec.ts`, so Playwright does not collect it as a test file.

/**
 * Answer the "what should people see you as?" prompt.
 *
 * Pass a name to set one, or nothing to decline — declining is a supported answer, and a spec that
 * does not care about names should exercise it rather than pretending everyone types one.
 */
export async function answerNamePrompt(page: Page, name?: string): Promise<void> {
  const dialog = page.locator(".k-dialog", { hasText: "see you as" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  if (name) {
    await dialog.locator("input").fill(name);
    await dialog.getByRole("button", { name: "OK" }).click();
  } else {
    await dialog.getByRole("button", { name: "Cancel" }).click();
  }
}
