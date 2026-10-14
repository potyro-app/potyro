import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions";

// Helpers for the demo-link specs (docs/24). Not a `.spec.ts`, so Playwright does not collect it.

/** The one console line every sealed app prints in Chrome: the realm's CSP names a directive it does not know yet. */
const BENIGN = [/Unrecognized Content-Security-Policy directive 'webrtc'/];

/**
 * Everything a page says is wrong: console errors and uncaught exceptions, minus the known-benign
 * line above. Read it at the end of a flow and expect it empty.
 */
export function consoleGuard(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !BENIGN.some((re) => re.test(m.text()))) problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

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
