import { test, type BrowserContextOptions, type Page } from "./console-guard";

// One boot for a run of tests that only read what they set up.
//
// Every app boot is ~1.2 s on the CI machine and ~2.7 s on a laptop, and a file whose tests each
// `goto` the same page paid one per test for one page. A describe that calls `pageOnce` boots that
// page once, in `beforeAll`, and its tests share it in order (the describe is made serial, so a test
// that fails stops the ones that would have looked at what it left). The page is closed in `afterAll`.
//
// For tests that READ: navigate, look, assert, open and close what is on screen. A test that writes
// what another must not see — a record, a setting, an installed app — keeps its own `page` fixture.
// The console guard watches the shared page from its first word: the boot's errors are the first
// test's, and each later test answers for what arrived during its own run.

/**
 * `open` boots the page (a `goto` and the wait the tests used to do each); `options` are the
 * context's — the project's `baseURL` is set already — for a locale, a colour scheme or a viewport
 * the describe used to set with `test.use`. Returns the page, for use inside the describe's tests.
 */
export function pageOnce(open: (page: Page) => Promise<void>, options: BrowserContextOptions = {}): () => Page {
  test.describe.configure({ mode: "serial" });
  let page: Page | undefined;
  test.beforeAll(async ({ browser }, workerInfo) => {
    const context = await browser.newContext({ baseURL: workerInfo.project.use.baseURL, ...options });
    page = await context.newPage();
    await open(page);
  });
  test.afterAll(async () => {
    await page?.context().close();
    page = undefined;
  });
  return () => {
    if (!page) throw new Error("pageOnce: the shared page exists only inside the tests of its describe");
    return page;
  };
}
