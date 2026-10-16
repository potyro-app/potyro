import { test, expect } from "./console-guard";

// The sealed-screen device check (#267, docs/22 §5), as the owner runs it on a phone from the APK:
// no USB, no DevTools. `#probe=realm` or seven taps on "You" opens it; nothing happens otherwise. The
// verdict is the engine's own: in the headless shell, Firefox and WebKit a sandboxed frame shares the
// page's thread, in full Chromium it does not.

test.use({ viewport: { width: 412, height: 915 } });

const outOfProcess = (projectName: string) => projectName === "sandbox-chromium-full";

test("#probe=realm runs the check on screen and gives the verdict and the numbers to copy", async ({ page, context }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await page.goto("/#probe=realm");
  const dialog = page.getByRole("dialog", { name: "Sealed screens on this device" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Run the check" }).click();
  const verdict = dialog.locator(".k-probe-verdict");
  await expect(verdict).toBeVisible({ timeout: 40_000 });
  const freezes = outOfProcess(info.project.name) ? "no" : "yes";
  await expect(verdict).toHaveAttribute("data-freezes", freezes);
  const json = JSON.parse(await dialog.getByRole("textbox", { name: "Results" }).inputValue()) as Record<string, unknown>;
  expect(json.viewFreezesShell).toBe(freezes === "yes");
  expect(json.workerFreezesShell).toBe(false);
  expect(Number(json.shellSpinMaxGapMs)).toBeGreaterThan(2500);
  expect((json.hello as { origin: string }).origin).toBe("null");
  await expect(dialog.getByRole("button", { name: "Copy results" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  expect(page.url()).not.toContain("probe=realm");
});

test("the check is hidden: nothing without the link, seven taps on You open it", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(1000);
  await expect(page.getByRole("dialog", { name: "Sealed screens on this device" })).toHaveCount(0);
  await page.getByRole("button", { name: "You and your devices" }).first().click();
  const you = page.getByRole("dialog", { name: "You and your devices" });
  await expect(you).toBeVisible();
  const heading = you.getByRole("heading", { name: "You", exact: true });
  for (let i = 0; i < 6; i++) await heading.click();
  await expect(page.getByRole("dialog", { name: "Sealed screens on this device" })).toHaveCount(0);
  await heading.click();
  await expect(page.getByRole("dialog", { name: "Sealed screens on this device" })).toBeVisible();
});
