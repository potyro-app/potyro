import { expect, type Locator, type Page } from "@playwright/test";

// The conversation-first Studio (#261), as the specs drive it. One place for the moves every Studio
// spec makes, so a change to how the Studio is reached changes one file rather than twenty.

export const studioOf = (page: Page): Locator => page.locator(".k-studio");

/** From the home screen: a Studio opened there is for making a new app. */
export async function openNewStudio(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.getByRole("button", { name: /New app/ }).first().click();
  const studio = studioOf(page);
  await expect(studio.getByRole("textbox", { name: "Describe the app" })).toBeVisible({ timeout: 30_000 });
  return studio;
}

/** Model settings → OpenRouter, with a stub key. */
export async function chooseOpenRouter(page: Page, studio: Locator): Promise<void> {
  await studio.getByRole("button", { name: "Model settings" }).click();
  const modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /OpenRouter/ }).check();
  await modal.getByLabel("OpenRouter API key").fill("sk-or-stub");
  await modal.getByRole("button", { name: "Close model settings" }).click();
}

/** Say something in the Studio: type it, send it. */
export async function ask(studio: Locator, text: string): Promise<void> {
  await studio.getByRole("textbox", { name: "Describe the app" }).fill(text);
  await studio.getByRole("button", { name: /Create the app|Modify the app/ }).click();
}

/** The card of the app as it is now — the newest version. */
export const currentCard = (studio: Locator): Locator => studio.locator(".k-card[data-current]");

/** Wait for a version to be made, then open the app from its card (unless it is already open beside the chat). */
export async function openFromCard(studio: Locator): Promise<Locator> {
  await expect(currentCard(studio)).toBeVisible({ timeout: 60_000 });
  const preview = studio.locator(".k-preview");
  if (!(await preview.isVisible())) await currentCard(studio).getByRole("button", { name: "Open" }).click();
  await expect(preview).toBeVisible();
  return studio.locator(".k-studio-preview");
}

/** The code, behind the menu: returns the code-and-history sheet, on its Source tab. */
export async function openSource(page: Page, studio: Locator): Promise<Locator> {
  await studio.getByRole("button", { name: "Studio menu" }).click();
  await page.getByRole("menuitem", { name: /See the code|Write the code yourself/ }).click();
  const tools = page.getByRole("dialog", { name: "Code, files and history" });
  await expect(tools.getByRole("textbox", { name: "App source" })).toBeVisible();
  return tools;
}

/** Version history, behind the menu. */
export async function openHistory(page: Page, studio: Locator): Promise<Locator> {
  await studio.getByRole("button", { name: "Studio menu" }).click();
  await page.getByRole("menuitem", { name: "History" }).click();
  const tools = page.getByRole("dialog", { name: "Code, files and history" });
  await expect(tools).toBeVisible();
  return tools;
}
