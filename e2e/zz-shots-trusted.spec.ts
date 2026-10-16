// SCRATCH (uncommitted): screenshots for the papercuts PR.
import { test, expect } from "./console-guard";
import { packApp } from "./library-demos";
import { makeDemoLink, stranger } from "./share-demo";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

const OUT ="/tmp/claude-1000/-home-aivuk-appinator/fd384e0b-36a6-4cc9-9664-11de67510d7a/scratchpad/papercuts/shots";

test("1: what an app asks for — the Add an app card and the trust dialog", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 860 });
  for (const [app, entry] of [
    ["draw-guess", "draw-guess.app.ts"],
    ["earthquakes", "earthquakes.app.ts"],
  ] as const) {
    await page.goto("/");
    await page.getByRole("button", { name: "Add an app" }).click();
    const dialog = page.getByRole("dialog", { name: "Add an app" });
    const chooser = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: /From this device/ }).click();
    await (await chooser).setFiles({ name: `${app}.potyro-app.zip`, mimeType: "application/zip", buffer: packApp(app, entry) });
    const about = dialog.getByRole("region", { name: /About / });
    await expect(about).toBeVisible({ timeout: 30_000 });
    await about.screenshot({ path: `${OUT}/1-${app}-add-card.png` });
    await dialog.getByRole("button", { name: "Add app" }).click();
    await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 60_000 });
    await page.getByRole("button", { name: "Runs sealed: review" }).click();
    const trust = page.locator(".k-trustdialog");
    await expect(trust.getByRole("heading", { name: "Let it run as yours?" })).toBeVisible();
    await expect(trust.locator(".k-trust-caps li").first()).not.toHaveText("…");
    await trust.screenshot({ path: `${OUT}/1-${app}-trust-dialog.png` });
    await page.getByRole("button", { name: "Cancel" }).click();
  }
});

test.describe("2: Camera on and the stage", () => {
  test.use({
    viewport: { width: 412, height: 860 },
    hasTouch: true,
    permissions: ["camera"],
  });
  test("Mirror Monsters' stage starts under the sign", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Add an app" }).click();
    const dialog = page.getByRole("dialog", { name: "Add an app" });
    const chooser = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: /From this device/ }).click();
    await (await chooser).setFiles({ name: "mirror-monsters.potyro-app.zip", mimeType: "application/zip", buffer: packApp("mirror-monsters", "mirror-monsters.app.ts") });
    await expect(dialog.getByRole("region", { name: /About / })).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("checkbox", { name: /I wrote this/ }).check();
    await dialog.getByRole("button", { name: "Add app" }).click();
    await page.getByRole("button", { name: "Turn on the camera" }).click();
    await expect(page.getByTestId("camera-on")).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/2-mirror-monsters-camera-on.png` });
  });
});

test("4: Split's demo opens on its group", async ({ page, browser, baseURL }) => {
  const link = await makeDemoLink(page, "Split");
  const { context, page: viewer } = await stranger(browser, baseURL!, { viewport: { width: 412, height: 860 } });
  await viewer.goto(link);
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 15_000 });
  await expect(viewer.locator(".k-scope")).not.toHaveAttribute("data-empty", "true");
  await viewer.waitForTimeout(800);
  await viewer.screenshot({ path: `${OUT}/4-split-demo.png` });
  await context.close();
});
