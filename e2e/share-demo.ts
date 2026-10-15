import { expect, type Browser, type BrowserContext, type Page } from "./console-guard";
import { tileAction } from "./launcher-actions";

// Helpers for the demo-link specs (docs/24). Not a `.spec.ts`, so Playwright does not collect it.

// Console errors are the suite's console guard's to catch (./console-guard), in every context too.

/** Hosts a context reached that are not the site's own: there must be none (no analytics, no CDN). */
export function foreignHosts(context: BrowserContext, ownHost: string): string[] {
  const seen: string[] = [];
  context.on("request", (r) => {
    const url = new URL(r.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname !== ownHost) seen.push(url.href);
  });
  return seen;
}

/** Make a demo link for an app from its tile, the way a person does. */
export async function makeDemoLink(page: Page, appName: string): Promise<string> {
  await page.goto("/");
  await tileAction(page, appName, "share-sheet");
  const sheet = page.locator(".k-share-sheet");
  await sheet.locator('[data-share="demo"]').click();
  const field = sheet.getByRole("textbox", { name: "Share link" });
  await expect(field).toBeVisible({ timeout: 30_000 });
  return field.inputValue();
}

/** A browser with nothing in it: no apps, no identity, no storage — someone who has never used Potyro. */
export async function stranger(browser: Browser, baseURL: string, opts: { locale?: string; viewport?: { width: number; height: number } } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, locale: opts.locale ?? "en-US", ...(opts.viewport ? { viewport: opts.viewport } : {}) });
  return { context, page: await context.newPage() };
}
