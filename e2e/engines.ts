// What differs between the engines a spec runs in, said once: what a page is granted, and what a
// browser can do at all.
//
// Playwright's Firefox knows only `geolocation`, `notifications` and a few others by name:
// `grantPermissions(["clipboard-read"])` or `permissions: ["camera"]` there is a thrown
// `Unknown permission`, before the test has done anything. Firefox is given the same powers by its
// own prefs instead, set once for its projects in playwright.config.ts (firefox-prefs.ts): the
// async clipboard reads without its paste prompt, and getUserMedia gets a fake camera without asking.

import { expect, test, type BrowserContext, type Page } from "./console-guard";

export { FIREFOX_PREFS } from "./firefox-prefs";

/** Let the page read and write the clipboard: by name in Chromium, by FIREFOX_PREFS in Firefox. */
export async function grantClipboard(context: BrowserContext, browserName: string): Promise<void> {
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
}

/**
 * Why a test that drives the page through Chromium's DevTools protocol (`newCDPSession`) skips in
 * the other engines: a finger's hold, drag or flick (`Input.dispatchTouchEvent`), or a slowed CPU
 * (`Emulation.setCPUThrottlingRate`). Playwright's Firefox can only tap, and has no throttling; a
 * scripted PointerEvent would skip the very thing these claim (the browser deciding scroll or drag).
 */
export const NEEDS_CDP = "drives a finger or the CPU through Chromium's DevTools protocol; Playwright's Firefox can only tap";

const escaped = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * A WebSocket to `url` that could not connect, in each engine's words — for a test that points one
 * at nothing on purpose. Chromium: "WebSocket connection to 'ws://…/' failed". Firefox: "Firefox
 * can’t establish a connection to the server at ws://…/." (and, for one it gave up on mid-way,
 * "The connection to ws://…/ was interrupted while the page was loading.").
 */
export function socketRefused(url: string): RegExp {
  const u = escaped(url);
  return new RegExp(`^(WebSocket connection to '${u}' failed|\\[JavaScript Error: "(Firefox can’t establish a connection to the server at ${u}\\.|The connection to ${u} was interrupted while the page was loading\\.)")`);
}

/** Why a test of the DRAWN map skips in a browser with no WebGL2. */
export const NO_WEBGL =
  "no WebGL2 in this browser (Playwright's headless Firefox on Linux has none), so no map is drawn — map-no-webgl-trusted.spec.ts covers what a person sees then";

const hasWebGL2 = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    try {
      return document.createElement("canvas").getContext("webgl2") !== null;
    } catch {
      return false;
    }
  });

/**
 * Skip a test that asserts on the drawn map (its pins, its camera, a tap on it) where this browser
 * cannot draw one. Asked of the browser, not keyed to its name: an engine that gains WebGL runs these.
 */
export async function skipWithoutMaps(page: Page): Promise<void> {
  test.skip(!(await hasWebGL2(page)), NO_WEBGL);
}

/** A map page is on screen: the drawn map where the browser can draw one, its list where it cannot. */
export async function expectMapPage(page: Page): Promise<void> {
  if (await hasWebGL2(page)) await expect(page.locator(".k-map-canvas")).toBeVisible();
  else await expect(page.locator(".k-map-list")).toBeVisible();
}
