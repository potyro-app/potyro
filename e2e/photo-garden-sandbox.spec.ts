import { test, expect, type Frame, type Page } from "./console-guard";
import { changed, needEsmSh, packApp, pixelsOf } from "./library-demos";
import { addPackage } from "./live-apps";

// apps/photo-garden SHARED (#388): added from this device with "I wrote this" unticked, so it runs
// sealed — its logic in the browser realm's Worker, its Studio in a sandboxed frame of its own
// (docs/22 §11). p5 reads `window` as it loads, which once made the add-app card refuse the app for
// the sealed box; the app now imports p5 when the Studio mounts. What is checked is the garden
// itself: p5's canvas inside the sealed frame, with specks moving on it.

test.use({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });

/** The Studio's frame, once p5 has drawn in it. */
async function studioFrame(page: Page): Promise<Frame> {
  const el = page.locator(".k-sealed-view iframe");
  await expect(el).toHaveCount(1, { timeout: 60_000 });
  const frame = await (await el.elementHandle())!.contentFrame();
  await expect.poll(async () => frame!.locator(".pg-stage canvas").count(), { timeout: 60_000 }).toBe(1);
  return frame!;
}

test("Photo Garden shared: the card does not refuse it for the sealed box, and p5 draws the garden inside the sealed frame", async ({ page }) => {
  test.setTimeout(150_000);
  await needEsmSh();
  await addPackage(page, "photo-garden", packApp("photo-garden", "photo-garden.app.ts"), false);
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");

  const frame = await studioFrame(page);
  expect(await frame.evaluate(() => self.origin)).toBe("null");
  await expect(frame.getByRole("heading", { name: "Grow a garden from a photo" })).toBeVisible();

  // The idle dusk garden is alive behind the welcome card: real pixels, changing.
  const canvas = frame.locator(".pg-stage canvas");
  const a = await pixelsOf(canvas);
  await page.waitForTimeout(700);
  expect(changed(a, await pixelsOf(canvas))).toBeGreaterThan(0.01);
  // Nothing fell back to the plain version, and the box stayed sealed.
  await expect(page.locator(".k-sealed-notice")).toHaveCount(0);
});
