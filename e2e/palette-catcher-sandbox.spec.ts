import { test, expect, type Frame, type Page } from "./console-guard";
import { packApp } from "./library-demos";
import { addPackage } from "./live-apps";

// apps/palette-catcher SHARED: added from this device with "I wrote this" unticked, so it runs sealed
// — its screen in a sandboxed frame — and a photo goes in through the host's camera capability. On
// Firefox for Android, in that frame, `createImageBitmap` refused a camera's JPEG and the app said
// "That file could not be read as a picture" (the owner, 2026-10-20); the app now decodes through an
// `<img>` when the bitmap path fails. The second test forces that path, in every engine this runs in.

test.use({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });

/** A 800×600 PNG: four vertical bands of known colour. */
async function bandsPng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 600;
    const g = c.getContext("2d")!;
    [[196, 98, 64], [143, 165, 128], [240, 230, 208], [32, 46, 86]].forEach(([r, gg, b], i) => {
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(i * 200, 0, 200, 600);
    });
    return c.toDataURL("image/png").split(",")[1]!;
  });
  return Buffer.from(b64, "base64");
}

async function sealedFrame(page: Page): Promise<Frame> {
  const el = page.locator(".k-sealed-view iframe");
  await expect(el).toHaveCount(1, { timeout: 60_000 });
  const frame = (await (await el.elementHandle())!.contentFrame())!;
  await expect(frame.getByRole("heading", { name: "Catch the colours of anything" })).toBeVisible({ timeout: 60_000 });
  return frame;
}

/** Choose a photo from the sealed frame: the host asks once for the camera, then opens its chooser. */
async function choosePhoto(page: Page, frame: Frame): Promise<void> {
  const png = await bandsPng(page);
  await frame.getByRole("button", { name: "Choose a photo" }).click();
  const consent = page.locator(".k-dialog", { hasText: "use the camera" });
  await expect(consent).toBeVisible({ timeout: 15_000 });
  const chooser = page.waitForEvent("filechooser");
  await consent.getByRole("button", { name: /^(Allow|Confirm|OK)$/ }).click();
  await (await chooser).setFiles({ name: "bands.png", mimeType: "image/png", buffer: png });
}

/** The chips' painted colours, as the browser computed them. */
const chipColours = (frame: Frame) =>
  frame.locator(".pc-work .pc-chip").evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));

test("sealed: a photo through the host's camera becomes a palette inside the sandboxed frame", async ({ page }) => {
  test.setTimeout(120_000);
  await addPackage(page, "palette-catcher", packApp("palette-catcher", "palette-catcher.app.ts"), false);
  const frame = await sealedFrame(page);
  await choosePhoto(page, frame);
  await expect(frame.locator(".pc-work .pc-chip")).toHaveCount(6, { timeout: 30_000 });
  expect(new Set(await chipColours(frame)).size).toBe(6);
  await expect(page.locator(".k-toast")).toHaveCount(0);
});

test("sealed, where createImageBitmap refuses the file (Firefox on Android): the photo still becomes a palette", async ({ page }) => {
  test.setTimeout(120_000);
  // In every frame, as that browser behaves: the bitmap path rejects, whatever it is given.
  await page.addInitScript(() => {
    self.createImageBitmap = () => Promise.reject(new DOMException("The source image could not be decoded.", "InvalidStateError"));
  });
  await addPackage(page, "palette-catcher", packApp("palette-catcher", "palette-catcher.app.ts"), false);
  const frame = await sealedFrame(page);
  await choosePhoto(page, frame);
  await expect(frame.locator(".pc-work .pc-chip")).toHaveCount(6, { timeout: 30_000 });
  expect(new Set(await chipColours(frame)).size).toBe(6);
  await expect(page.locator(".k-toast", { hasText: "could not be read" })).toHaveCount(0);
});
