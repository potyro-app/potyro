import { test, expect } from "@playwright/test";

// Opening an app and reading its code must not bounce you back to the preview.
//
// `openSaved` starts `buildPreview` with `void`, and a successful build ended by switching to the
// Preview tab unconditionally. So the outcome depended on a race nobody had named: build finishes
// BEFORE you reach for Source and all is well; build finishes AFTER and the studio takes you back,
// a second later, with nothing on screen to explain it.
//
// That is why `app-update-trusted.spec.ts` was flaky rather than broken — it clicks Source
// immediately after picking an app, so a fast machine won the race and a loaded one lost it. It lost
// it in CI, where the whole suite shares a runner, and its failure looked like "the App source
// textbox does not exist" rather than anything about tabs.
//
// This test removes the luck. The CPU is throttled so the build is guaranteed to be in flight when
// Source is clicked, which is the losing side of the race every time.

test("reading the source while the preview is still building stays on the source", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CPU throttling is a CDP capability; the race itself is not browser-specific.");
  test.slow();

  await page.goto("/");
  await page.getByRole("button", { name: /New app/ }).click();
  const studio = page.locator(".k-studio");
  await expect(studio).toBeVisible();

  // Wait out the studio's own opening build (it renders the starter app preview-first), so what the
  // next click races is the build for the app being opened, not this one.
  await expect(studio.locator(".k-studio-building")).toHaveCount(0, { timeout: 60_000 });

  // Save the starter app so there is something in My Apps to re-open.
  await studio.getByRole("button", { name: "Save to My Apps" }).click();
  await expect(studio.getByRole("button", { name: "My App", exact: true })).toBeVisible({ timeout: 60_000 });

  // RELOAD before re-opening it, which is what makes this deterministic. Saving already opened that
  // app's store and warmed the bundler, so re-opening in the same page rebuilds in a few
  // milliseconds — far too fast to lose the race, and the first version of this test passed with the
  // bug still in place for exactly that reason. After a reload the store is cold (a fresh OPFS
  // SQLite open) and so is esbuild, which is the state the real flake happens in.
  await page.reload();
  await page.getByRole("button", { name: /New app/ }).click();
  await expect(studio).toBeVisible();
  await expect(studio.locator(".k-studio-building")).toHaveCount(0, { timeout: 60_000 });

  // And throttle, so a fast machine cannot rescue it either.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });

  // Re-open it — this is the `void buildPreview(...)` — and go straight for the code, the way a
  // person checking what an app is made of does.
  await studio.getByRole("button", { name: "My App", exact: true }).click();
  await studio.getByRole("tab", { name: "Source" }).click();

  const source = studio.getByRole("textbox", { name: "App source" });
  const sourceTab = studio.getByRole("tab", { name: "Source" });
  await expect(source).toBeVisible();

  // The assertion that matters, and it has to be held over TIME rather than checked once.
  //
  // There is no "the build finished" marker to wait on — `.k-studio-building` only renders when
  // there is no previous preview, so re-opening an app shows nothing at all — and a single check
  // right after the click passes trivially, because the flip has not happened yet. That is what made
  // the first two versions of this test pass with the bug still in. So: watch the tab for a window
  // comfortably longer than a throttled build, and fail the moment it moves on its own.
  const until = Date.now() + 8_000;
  while (Date.now() < until) {
    await expect(sourceTab, "the build finished and took the tab back to Preview").toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: 1_000 },
    );
    await page.waitForTimeout(250);
  }
  await expect(source).toBeVisible();

  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
});
