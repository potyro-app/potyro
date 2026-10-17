import { test, expect, type Page } from "./console-guard";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A page that sits on a picture (`background: { image }`) SHOWS the picture: as the page's ground,
// faded behind the top of the page under its content — never a block that pushes the content down.
//
// The bug (#368): the picture was asked for again on every render — the hook was keyed by `ctx`,
// which is a new object each time — so its `src` changed faster than it could load. This reads the
// ground's pixels: a photo there varies; the plain paper does not.

const PACK = fileURLToPath(new URL("../scripts/pack-app.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

function pack(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "backdrop-"));
  for (const f of ["backdrop.app.ts", "garden-flower.png"]) copyFileSync(join(FIXTURES, f), join(dir, f));
  execFileSync("node", [PACK, "backdrop.app.ts", "garden-flower.png", "-o", "out.zip"], { cwd: dir, env: { ...process.env, INIT_CWD: dir }, stdio: "pipe" });
  return readFileSync(join(dir, "out.zip"));
}

async function addMine(page: Page, zip: Buffer): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles([{ name: "backdrop.potyro-app.zip", mimeType: "application/zip", buffer: zip }]);
  await expect(dialog.getByRole("region", { name: /About / })).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("checkbox", { name: /I wrote this/ }).check();
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
}

/** How much a screenshot's colours vary (their standard deviation, over all three channels). */
async function spread(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d")!;
    g.drawImage(bmp, 0, 0);
    const { data } = g.getImageData(0, 0, bmp.width, bmp.height);
    let sum = 0;
    let sq = 0;
    const n = data.length / 4;
    let total = 0;
    for (let ch = 0; ch < 3; ch++) {
      sum = 0;
      sq = 0;
      for (let i = ch; i < data.length; i += 4) {
        sum += data[i]!;
        sq += data[i]! * data[i]!;
      }
      const mean = sum / n;
      total += Math.sqrt(Math.max(0, sq / n - mean * mean));
    }
    return total / 3;
  }, png.toString("base64"));
}

for (const scheme of ["light", "dark"] as const) {
  test(`a page's background picture is the ground behind its content (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 412, height: 915 });
    await addMine(page, pack());
    const ground = page.locator(".k-page-ground");
    const img = ground.locator("img");
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
    // The src holds still: the picture is not asked for over and over.
    const src = await img.getAttribute("src");
    await page.waitForTimeout(1_000);
    await expect(img).toHaveAttribute("src", src!);
    // The content is not pushed below the picture: it starts at the top, over it.
    const groundBox = (await ground.boundingBox())!;
    const content = (await page.locator(".k-main").boundingBox())!;
    expect(content.y).toBeLessThan(groundBox.y + groundBox.height / 2);
    await page.waitForTimeout(800);
    // The ground itself, read with the content set aside: a patch near its top, at the right.
    await page.locator(".k-main").evaluate((m: HTMLElement) => (m.style.visibility = "hidden"));
    const box = groundBox;
    const clip = { x: box.x + box.width * 0.62, y: box.y + box.height * 0.08, width: box.width * 0.34, height: box.height * 0.3 };
    const withPhoto = await spread(page, await page.screenshot({ clip, animations: "disabled" }));
    // The same patch with the photo taken out: the shade on the plain ground.
    await img.evaluate((i: HTMLImageElement) => (i.style.visibility = "hidden"));
    const without = await spread(page, await page.screenshot({ clip, animations: "disabled" }));
    expect(withPhoto).toBeGreaterThan(without + 8);
  });
}
