import { test, expect } from "./console-guard";
import { crc32, deflateSync } from "node:zlib";

// A local-only app gets a real database, not five megabytes of localStorage.
//
// `createSyncAccessHandle` is worker-only by specification, so the OPFS open every local app was
// meant to use failed on the main thread in every browser, and every one of them fell back to
// localStorage. That is roughly 5MB shared with everything else the browser remembers for this
// origin — which is why adding a photo from a phone camera came back as "the quota has been
// exceeded". SQLite runs in a worker now, and this pins the consequence rather than the mechanism:
// photos land somewhere that holds them, and they are still there after a reload.

const SOURCE = `import { defineApp } from "potyro";
export default defineApp({
  id: "album", name: "Album", icon: "📷", version: "1.0.0", schemaVersion: 1,
  entities: { shot: { label: "Shot", displayField: "name", fields: {
    name: { type: "text", required: true },
    photo: { type: "media", accept: "image/*" },
  } } },
  pages: [
    { id: "all", title: "Shots", view: { type: "list", entity: "shot", display: { primary: "name" } } },
  ],
});
`;

/** A megabyte of noise as a PNG: incompressible, so it cannot quietly shrink to nothing. */
function bigPng(): Buffer {
  const side = 700;
  const raw = Buffer.concat(
    Array.from({ length: side }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: side * 3 }, () => Math.floor(Math.random() * 256)))])),
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
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("photos in a local-only app outlive a reload, and do not fill localStorage", async ({ page }) => {
  test.slow();
  await page.addInitScript((source) => {
    localStorage.setItem(
      "potyro:user-apps",
      JSON.stringify([{ id: "album", name: "Album", source, trusted: true, updatedAt: new Date().toISOString() }]),
    );
  }, SOURCE);

  await page.goto("/?user=album");
  await expect(page.locator("h1").first()).toHaveText("Album", { timeout: 30_000 });

  const photo = { name: "shot.png", mimeType: "image/png", buffer: bigPng() };
  for (const name of ["First", "Second", "Third"]) {
    await page.getByRole("button", { name: /Add: Shot|Add Shot/i }).first().click();
    await page.getByLabel(/name/i).first().fill(name);
    await page.locator('input[type="file"]').first().setInputFiles(photo);
    // The picked file is read and scaled before it can be saved.
    await expect(page.locator(".k-media-thumb, .k-media img, img").first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });
    await page.goto("/?user=album");
    await expect(page.locator("h1").first()).toHaveText("Album", { timeout: 30_000 });
  }

  // Three of these would have been ~5MB of localStorage — the whole budget, and the next photo an
  // error. The bytes belong in the database instead.
  const localStorageKB = await page.evaluate(() => Math.round(JSON.stringify(localStorage).length / 1024));
  expect(localStorageKB).toBeLessThan(500);

  await page.reload();
  await expect(page.locator("h1").first()).toHaveText("Album", { timeout: 30_000 });
  await expect(page.locator(".k-list-row")).toHaveCount(3);
});
