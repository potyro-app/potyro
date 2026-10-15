import { test, expect } from "./console-guard";
import { openSource } from "./studio-helpers.js";

// Opening an app and reading its code must not bounce you somewhere else.
//
// The old Studio started its preview build with `void` and switched to the Preview tab when the build
// finished — so reaching for Source while the build ran put you back on Preview a second later, with
// nothing on screen to explain it. That is why `app-update-trusted.spec.ts` was flaky rather than
// broken: a fast machine won the race, a loaded one lost it.
//
// The Studio has no tabs to switch now (#261) — the code is a sheet you open — but the app still
// builds when the Studio opens, and on a wide screen it opens beside the conversation when it is
// ready. This holds the claim that matters: the build finishing does not take the code away.
// The CPU is throttled so the build is in flight when the code is opened, every time.

test("reading the source while the app is still building stays on the source", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CPU throttling is a CDP capability; the race itself is not browser-specific.");
  test.slow();

  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  // RELOAD first, so the store and the bundler are cold — the state the real flake happens in.
  await page.reload();
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });

  // Open the Studio — this starts the build — and go straight for the code, the way a person
  // checking what an app is made of does.
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  const studio = page.locator(".k-studio");
  const tools = await openSource(page, studio);
  const source = tools.getByRole("textbox", { name: "App source" });
  const sourceTab = tools.getByRole("tab", { name: "Source" });

  // Held over TIME rather than checked once: a single check right after the click passes trivially,
  // because nothing has had the chance to move yet.
  const until = Date.now() + 8_000;
  while (Date.now() < until) {
    await expect(sourceTab, "the build finished and took the code away").toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    await page.waitForTimeout(250);
  }
  await expect(source).toBeVisible();
  await expect(source).toHaveValue(/id: "groceries"/);

  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
});
