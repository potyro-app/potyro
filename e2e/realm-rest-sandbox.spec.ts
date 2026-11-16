import { test, expect } from "./console-guard";
import { installShared } from "./realm.js";

// A sealed app the watchdog keeps stopping is not started again by itself (#90, docs/22 §7.1).
//
// The browser gives a page no way to cap a Worker's memory, so what Potyro can do about an app that
// keeps running away — into a loop, a flood, or memory the browser takes its process back for — is on
// its own side: stop it, and after three stops in a row leave it stopped, say so in a sentence, and
// let the person start it again. A loop stands in for the growth here: the watchdog's stop is the
// same one, and a spec must not fill a shared machine's memory to see it.

test.use({ viewport: { width: 1280, height: 800 } });

const KEEPS_STOPPING = `import { defineApp } from "potyro";
export default defineApp({
  id: "keeps-stopping",
  name: "Keeps stopping",
  version: "1.0.0",
  schemaVersion: 1,
  quickActions: [{ id: "add", label: "Add entry", entity: "entry", mode: "instant", prefill: { title: "Kept" } }],
  entities: {
    entry: { displayField: "title", fields: { title: { type: "text" } }, computed: { shout: (r) => String(r.title).toUpperCase() + "!" } },
  },
  pages: [
    {
      id: "all",
      title: "Entries",
      actions: [{ label: "Run away", run: () => { for (;;) {} } }],
      view: { type: "list", entity: "entry", display: { primary: "title", secondary: (r) => r.shout } },
    },
  ],
});
`;

test("an app stopped three times in a row rests, says so, and starts again when asked", async ({ page }) => {
  test.setTimeout(90_000);
  await installShared(page, "keeps-stopping", "Keeps stopping", KEEPS_STOPPING);
  await page.getByRole("button", { name: /Add entry/ }).first().click();
  const row = page.locator(".k-list-row").first();
  await expect(row.locator(".k-secondary")).toHaveText("KEPT!", { timeout: 15_000 });

  const notice = page.locator(".k-rest-notice");
  const runAway = page.getByRole("button", { name: "Run away" });
  const tooLong = page.locator(".k-toast", { hasText: "This took too long, so it was stopped." });
  // Twice: stopped, told, and the app runs again by itself — an accident is not a habit.
  for (let i = 0; i < 2; i++) {
    await runAway.click();
    await expect(tooLong.first()).toBeVisible({ timeout: 10_000 });
    await expect(notice).toHaveCount(0);
    await expect(tooLong).toHaveCount(0, { timeout: 10_000 });
  }
  // The third time in a row it is left stopped, and the page says what happened and what to do.
  await runAway.click();
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await expect(notice).toContainText("This app stopped several times in a row, so Potyro paused it. What you saved in it is still here.");
  // No realm is started for it meanwhile: its frame is gone and stays gone.
  await expect(page.locator("#potyro-realms iframe")).toHaveCount(0);
  await expect(tooLong).toHaveCount(0, { timeout: 10_000 });
  await runAway.click();
  await expect(page.locator(".k-toast", { hasText: "The app was stopped before this finished." })).toBeVisible();
  await expect(page.locator("#potyro-realms iframe")).toHaveCount(0);
  // What was saved is the store's, and still on the page.
  await expect(row).toContainText("Kept");

  await notice.getByRole("button", { name: "Start it again" }).click();
  await expect(notice).toHaveCount(0);
  await expect(row.locator(".k-secondary")).toHaveText("KEPT!", { timeout: 15_000 });
  await expect(page.locator("#potyro-realms iframe")).toHaveCount(1);
});

test("an app that was open when a tab died is not started again by itself", async ({ page }) => {
  // What a tab that crashed or froze leaves behind: its marker for the app it had open, never
  // refreshed again. (The browser ends a tab whose shared app keeps memory without end where the
  // app's frame shares the page's process — measured in docs/22 §7.1; a spec must not do that to
  // the machine it runs on.)
  await page.addInitScript(() => {
    if (sessionStorage.getItem("planted")) return;
    sessionStorage.setItem("planted", "1");
    localStorage.setItem("potyro:sealed-open:mark:deadtab:1", JSON.stringify({ app: "keeps-stopping", page: "app", at: Date.now() - 60_000 }));
  });
  await page.addInitScript(
    ([s]) => {
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "keeps-stopping", name: "Keeps stopping", source: s, trusted: false, updatedAt: new Date().toISOString() }]));
    },
    [KEEPS_STOPPING] as const,
  );
  await page.goto("/?user=keeps-stopping");
  const splash = page.locator(".k-splash");
  await expect(splash).toContainText("Potyro stopped working the last time this app was open, so it has not been started. What you saved in it is still here.", { timeout: 30_000 });
  // None of its code has run: no realm was made for it.
  await expect(page.locator("#potyro-realms iframe")).toHaveCount(0);

  await splash.getByRole("button", { name: "Start it" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await expect(page.locator("#potyro-realms iframe")).toHaveCount(1);
  // Open and on screen, it is marked; the old tab's marker is gone.
  const marks = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("potyro:sealed-open:mark:")));
  expect(marks).toHaveLength(1);
  expect(marks[0]).not.toContain("deadtab");
  expect(await page.evaluate(() => localStorage.getItem("potyro:sealed-open:off"))).toBeNull();
});

// ─── when the notice may show: only a page that died while it was SHOWING the app ────────────────
//
// A phone ends background tabs all day with no word to the page, and a shared app is what every
// shared app is: coming back to one must never read as "Potyro stopped working". The marker is taken
// away the moment the page is hidden or put away, so only a page that died on screen leaves one.

const PAUSED = "Potyro stopped working the last time this app was open, so it has not been started.";
const MARKS = () => Object.keys(localStorage).filter((k) => k.startsWith("potyro:sealed-open:mark:"));

/** The app in every page of the context, as a shared app on this device. */
async function shared(context: import("@playwright/test").BrowserContext): Promise<void> {
  await context.addInitScript(
    ([s]) => {
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "keeps-stopping", name: "Keeps stopping", source: s, trusted: false, updatedAt: new Date().toISOString() }]));
    },
    [KEEPS_STOPPING] as const,
  );
}

/** End the page's process as the system does: no unload, no event, nothing runs. */
async function kill(page: import("@playwright/test").Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const crashed = page.waitForEvent("crash");
  void cdp.send("Page.crash").catch(() => {});
  await crashed;
}

/** A later visit, in a new tab: whatever the dead tab left is by now older than a live tab's would be. */
async function comeBack(context: import("@playwright/test").BrowserContext): Promise<import("@playwright/test").Page> {
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (sessionStorage.getItem("aged")) return;
    sessionStorage.setItem("aged", "1");
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("potyro:sealed-open:mark:")) continue;
      const mark = JSON.parse(localStorage.getItem(key) ?? "null") as { at: number } | null;
      if (mark) localStorage.setItem(key, JSON.stringify({ ...mark, at: mark.at - 60_000 }));
    }
  });
  await page.goto("/?user=keeps-stopping");
  return page;
}

test("a tab the system ended in the background, healthy, comes back with no notice", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "ending a page's process without unload needs CDP");
  await shared(context);
  await page.goto("/?user=keeps-stopping");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  expect(await page.evaluate(MARKS)).toHaveLength(1);
  // The person switches away: the page is hidden, as the browser tells it.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await page.evaluate(MARKS)).toEqual([]);
  await kill(page);

  const back = await comeBack(context);
  await expect(back.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await expect(back.getByText(PAUSED)).toHaveCount(0);
  expect(await back.evaluate(() => localStorage.getItem("potyro:sealed-open:off"))).toBeNull();
});

test("a tab that died while it was showing the app: the app is not started by itself", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "ending a page's process without unload needs CDP");
  await shared(context);
  await page.goto("/?user=keeps-stopping");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await kill(page);

  const back = await comeBack(context);
  await expect(back.locator(".k-splash")).toContainText(PAUSED, { timeout: 30_000 });
  await expect(back.locator("#potyro-realms iframe")).toHaveCount(0);
});

test("leaving the app's page and coming back with the Back button shows no notice", async ({ page, context }) => {
  await shared(context);
  await page.goto("/?user=keeps-stopping");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  // Another document, then back: restored from the back/forward cache where the engine keeps the
  // page, loaded again where it does not. Either way the page was put away, not lost.
  await page.goto("/robots.txt");
  expect(await page.evaluate(MARKS)).toEqual([]);
  await page.goBack();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await expect(page.getByText(PAUSED)).toHaveCount(0);
  expect(await page.evaluate(MARKS)).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem("potyro:sealed-open:off"))).toBeNull();
});
