import { test, expect, type Page } from "./console-guard";
import { crc32, deflateSync } from "node:zlib";

// The photo field (#102). Plants' "Photo" is a tile that says "Add photo", not the browser's
// "Choose File | No file chosen". Pick an image and the tile shows it with a way to take it off
// again; the record page shows the same tile. Nothing visible in the form is a file input.

const PNG = Buffer.from(
  // 1×1 green PNG
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function openApp(page: Page, app: string, title: string): Promise<void> {
  await page.goto(`/?user=${app}`);
  await expect(page.locator("h1").first()).toHaveText(title, { timeout: 30_000 });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a photo field is a tile: add, see it, remove it, and it shows the same on the record", async ({ page }) => {
    await openApp(page, "plants", "Plants");
    await page.getByRole("button", { name: "Add: Plant" }).click();
    const form = page.locator(".k-form");
    await expect(form).toBeVisible();

    // The tile, and no file button in sight.
    const add = form.getByRole("button", { name: "Photo: add photo" });
    await expect(add).toBeVisible();
    await expect(form.locator("input[type=file]:visible")).toHaveCount(0);

    // Choosing a file fills the tile with the image itself.
    await form.locator("input[type=file]").setInputFiles({ name: "leaf.png", mimeType: "image/png", buffer: PNG });
    const tile = form.locator(".k-media-tile");
    await expect(tile).toBeVisible();
    await expect(tile.locator("img")).toHaveAttribute("src", /^blob:|^data:/);
    await expect(add).toHaveCount(0);

    // It can be taken off again.
    await form.getByRole("button", { name: "Remove: Photo" }).click();
    await expect(form.locator(".k-media-tile")).toHaveCount(0);
    await expect(add).toBeVisible();

    // Put it back, save, and the record page shows the same tile.
    await form.locator("input[type=file]").setInputFiles({ name: "leaf.png", mimeType: "image/png", buffer: PNG });
    await expect(form.locator(".k-media-tile img")).toBeVisible();
    await form.getByRole("textbox", { name: "Name" }).fill("E2E Photo Plant");
    await form.getByRole("button", { name: "Create" }).click();
    const detail = page.locator("article.k-detail");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".k-media-tile img")).toBeVisible();
    // Read-only there: nothing to remove from a record you are reading.
    await expect(detail.locator(".k-media-x")).toHaveCount(0);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("the tile offers the camera or the library", async ({ page }) => {
    await openApp(page, "plants", "Plants");
    await page.getByRole("button", { name: "Add: Plant" }).tap();
    const form = page.locator(".k-form");
    await form.getByRole("button", { name: "Photo: add photo" }).tap();
    // A phone with a camera gets the choice, as a sheet under the thumb.
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveText([/Take a photo/, /Choose from library/]);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });
});

test.describe("export carries the photos", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a photo is IN the exported bundle, not just referenced by it", async ({ page }) => {
    // The export wrote records, and a record's photo is a reference — `{key, mime}` — to bytes held
    // beside it. So exporting an app full of pictures produced a few kilobytes of pointers to
    // nothing, and importing it gave records whose images would not load. Measured before the fix:
    // a 1MB photo exported as a 3KB bundle.
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      delete w.showSaveFilePicker; // force the <a download> path so the file can be captured
    });
    // A real PNG of noise: incompressible, so its bytes cannot hide inside the zip's compression.
    const side = 400;
    const raw = Buffer.concat(
      Array.from({ length: side }, () =>
        Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: side * 3 }, () => Math.floor(Math.random() * 256)))]),
      ),
    );
    const chunk = (type: string, data: Buffer): Buffer => {
      const body = Buffer.concat([Buffer.from(type), data]);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body));
      return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(side, 0);
    ihdr.writeUInt32BE(side, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const noisy = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 1 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);

    await openApp(page, "plants", "Plants");
    await page.getByRole("button", { name: /Add: Plant|Add Plant/i }).first().click();
    await page.getByLabel(/name/i).first().fill("Fern");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "fern.png", mimeType: "image/png", buffer: noisy });
    await expect(page.locator(".k-media-thumb, .k-media img, img").first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
    await expect(page.getByText("Fern").first()).toBeVisible({ timeout: 30_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.getByRole("button", { name: "Export" }).first().click(),
    ]);
    const path = await download.path();
    const { readFileSync } = await import("node:fs");
    const bundle = readFileSync(path);

    // The bundle must contain the image bytes themselves. A bundle of pointers is a few KB; one
    // with a photo in it is not.
    expect(bundle.byteLength).toBeGreaterThan(20_000);
  });
});
